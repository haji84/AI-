# Publish complete launcher bytes; no task registration, ACL or process changes.
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
  try {
    $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
    if([IO.File]::Exists($target)){[IO.File]::Replace($temporary,$target,[NullString]::Value)}
    else {[IO.File]::Move($temporary,$target)}
  } finally {
    # Only this invocation's newly created, fixed-directory temporary is removed.
    if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}
  }
  } finally { if($held){$mutex.ReleaseMutex()};$mutex.Dispose() }
}
