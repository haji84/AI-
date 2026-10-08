# Publish complete launcher bytes; no task registration, ACL or process changes.
# ReplaceFile may set SE_DACL_AUTO_INHERITED without changing any ACE, owner,
# group or protection. Compare all other descriptor fields exactly.
function Get-GaiComparableFileSddl([string]$sddl) {
  $descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($sddl)
  $flags=$descriptor.ControlFlags -band (-bnot [Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited)
  $comparable=[Security.AccessControl.RawSecurityDescriptor]::new([Security.AccessControl.ControlFlags]$flags,$descriptor.Owner,$descriptor.Group,$descriptor.SystemAcl,$descriptor.DiscretionaryAcl)
  return $comparable.GetSddlForm([Security.AccessControl.AccessControlSections]::All)
}
function Invoke-GaiNativeFileReplace([string]$temporary,[string]$target,[string]$backup) {
  [IO.File]::Replace($temporary,$target,$backup)
}
function Invoke-GaiSafeFileReplace([string]$temporary,[string]$target) {
  $original=[Convert]::ToBase64String([IO.File]::ReadAllBytes($target))
  $originalAcl=(Get-Acl -LiteralPath $target).Sddl
  $authority=Get-GaiComparableFileSddl $originalAcl
  $oldSecurity=[Security.AccessControl.RawSecurityDescriptor]::new($originalAcl)
  $newSecurity=[Security.AccessControl.RawSecurityDescriptor]::new((Get-Acl -LiteralPath $temporary).Sddl)
  if($oldSecurity.Owner.Value -ne $newSecurity.Owner.Value -or $oldSecurity.Group.Value -ne $newSecurity.Group.Value){
    [IO.File]::Delete($temporary)
    throw 'LAUNCHER_REPLACEMENT_AUTHORITY_MISMATCH'
  }
  $backup=Join-Path (Split-Path -Parent $target) ('.gai-replace-'+[guid]::NewGuid().ToString('N')+'.bak')
  try { Invoke-GaiNativeFileReplace $temporary $target $backup }
  catch {
    $restored=$false
    try {
      # ERROR_UNABLE_TO_MOVE_REPLACEMENT_2 can leave the old file at backup.
      if(-not [IO.File]::Exists($target) -and [IO.File]::Exists($backup)){[IO.File]::Move($backup,$target)}
      $restored=([IO.File]::Exists($target) -and
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -ceq $original -and
        (Get-GaiComparableFileSddl (Get-Acl -LiteralPath $target).Sddl) -ceq $authority)
    }catch{$restored=$false}
    if(-not $restored){throw 'LAUNCHER_REPLACEMENT_FAILED_RECOVERY_REQUIRED'}
    # Delete only this call's staging files after the original is verified intact.
    if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}
    if([IO.File]::Exists($backup)){[IO.File]::Delete($backup)}
    throw
  }
  if([IO.File]::Exists($backup)){[IO.File]::Delete($backup)}
}
function Write-GaiLauncherFile([string]$path,[string]$content) {
  $target=[IO.Path]::GetFullPath($path)
  $directory=Split-Path -Parent $target
  if(-not (Test-Path -LiteralPath $directory -PathType Container)){throw 'LAUNCHER_DIRECTORY_REQUIRED'}
  if((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'LAUNCHER_REPARSE_PATH'}
  if(Test-Path -LiteralPath $target){
    if((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'LAUNCHER_REPARSE_PATH'}
  }
  $hash=[Security.Cryptography.SHA256]::Create()
  try {$key=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($target.ToUpperInvariant())))).Replace('-','')} finally {$hash.Dispose()}
  $mutex=[Threading.Mutex]::new($false,('Global\GaiLauncher-'+$key))
  $held=$false
  try {
    try {$held=$mutex.WaitOne(5000)} catch [Threading.AbandonedMutexException] {$held=$true}
    if(-not $held){throw 'LAUNCHER_PUBLICATION_BUSY'}
  $bytes=[byte[]]([Text.Encoding]::Unicode.GetPreamble()+[Text.Encoding]::Unicode.GetBytes($content))
  if([IO.File]::Exists($target) -and [Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -ceq [Convert]::ToBase64String($bytes)){return}
  $temporary=Join-Path $directory ('.gai-launcher-'+[guid]::NewGuid().ToString('N')+'.tmp')
  $replacementStarted=$false
  try {
    $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
    if([IO.File]::Exists($target)){$replacementStarted=$true;Invoke-GaiSafeFileReplace $temporary $target}
    else {[IO.File]::Move($temporary,$target)}
  } finally {
    # Only this invocation's newly created, fixed-directory temporary is removed.
    if(-not $replacementStarted -and [IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}
  }
  } finally { if($held){$mutex.ReleaseMutex()};$mutex.Dispose() }
}
