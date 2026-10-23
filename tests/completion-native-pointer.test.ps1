Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Import-Fixture([string]$relative,[string[]]$names){
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot ('..\'+$relative)),[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'fixture-parse'}
 foreach($name in $names){
  $def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
  if($null -eq $def){throw 'fixture-function'}
  Invoke-Expression ($def.Extent.Text.Replace(('function '+$name),('function script:'+$name)))
 }
}
Import-Fixture 'scripts/goriq-completion-native-activate.ps1' @('Write-CompletionBytes','Write-CompletionPointer','Assert-CompletionNative','Read-CompletionIntent','Save-CompletionIntent','Get-CompletionByteHash')
Import-Fixture 'scripts/goriq-zbook-acl-boundary-repair.ps1' @('Write-BoundaryBackup')
Import-Fixture 'scripts/goriq-zbook-fixed-acl-repair.ps1' @('Initialize-FixedNative','Get-FixedBytes','Get-FixedHash','Get-FixedRecord','Assert-FixedRecord')
Import-Fixture 'scripts/goriq-pc-runtime-refresh-windows.ps1' @('Same-Bytes')
# Runtime/state guards have separate tests. This fixture exercises actual Windows files/ACL/IDs.
function Assert-CompletionState {}
function Assert-StoppedInstallation {}
function Assert-FixedExpiry {}
Initialize-FixedNative
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('goriq-1858-pointer-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$targets=@($null,$null,$null);$pointerRecords=@();$old=@();$ids=@()
$previousLocal=$env:LOCALAPPDATA;$env:LOCALAPPDATA=$fixture
$SourceRevision='a'*40;$backupId=[guid]::NewGuid().ToString('N');$recovering=$false;$records=@();$wanted=@()
$originalWriter=${function:Write-CompletionBytes}
try{
 foreach($name in @('config.dpapi','launch-current.ps1')){
  $path=Join-Path $fixture $name
  [IO.File]::WriteAllText($path,'original fixture')
  $acl=Get-Acl -LiteralPath $path -Audit
  $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
  $acl.SetAuditRuleProtection($true,$true)
  $audit=New-Object Security.AccessControl.FileSystemAuditRule([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.AccessControl.FileSystemRights]::WriteData,[Security.AccessControl.AuditFlags]::Success)
  $acl.AddAuditRule($audit)
  Set-Acl -LiteralPath $path -AclObject $acl
  if(@((Get-Acl -LiteralPath $path -Audit).Audit | Where-Object {-not $_.IsInherited}).Count -eq 0){throw 'nonempty-explicit-sacl-required'}
  $entry=[pscustomobject]@{path=$path;directory=$false};$targets+=,$entry
  $h=[GoriqFixedAclNative]::Open($path,$false,$false)
  try{$record=Get-FixedRecord $entry $h;$pointerRecords+=,$record;$old+=,$record;$ids+=,$record.identity}finally{$h.Dispose()}
 }
 $records=@($null,$null,$null,$old[0],$old[1]);$wanted=@($null,$null,$null,$old[0].descriptor,$old[1].descriptor)
 Write-CompletionPointer 3 ([Text.Encoding]::UTF8.GetBytes('new fixture'))
 # Simulate loss of the parent's pointer state; the durable intent is readable.
 $intent=Read-CompletionIntent 3 $false
 if($intent.hash -cne $pointerRecords[0].hash -or $intent.identity -cne $ids[0]){throw 'durable-intent-missing'}
 if($pointerRecords[0].identity -cne $ids[0] -or $pointerRecords[0].descriptor -cne $old[0].descriptor){throw 'held-object-not-preserved'}
 $recovering=$true
 Write-CompletionPointer 3 ([Text.Encoding]::UTF8.GetBytes('original fixture'))
 if($pointerRecords[0].hash -cne $old[0].hash -or $pointerRecords[0].descriptor -cne $old[0].descriptor){throw 'pointer-recovery-failed'}
 foreach($partial in @($true,$false)){
  $backupId=[guid]::NewGuid().ToString('N');$recovering=$false
  function Write-CompletionBytes($stream,[byte[]]$bytes){
   if($partial){$stream.Position=0;$stream.WriteByte(42);$stream.Flush($true)}else{& $originalWriter $stream $bytes}
   # Verify another writer cannot race outcome reconciliation.
   $opened=$false
   try{$other=New-Object IO.FileStream($targets[3].path,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite);$opened=$true;$other.Dispose()}catch{}
   if($opened){throw 'fixture-writer-was-allowed'}
   throw 'fixture-after-write'
  }
  $failed=$false
  try{Write-CompletionPointer 3 ([Text.Encoding]::UTF8.GetBytes('longer replacement fixture'))}catch{if($_.Exception.Message -ne 'fixture-after-write'){throw};$failed=$true}
  if(-not $failed){throw 'fault-not-injected'}
  Set-Item -LiteralPath function:Write-CompletionBytes -Value $originalWriter
  $recovering=$true
  Write-CompletionPointer 3 ([Text.Encoding]::UTF8.GetBytes('original fixture'))
  if($pointerRecords[0].identity -cne $ids[0] -or $pointerRecords[0].hash -cne $old[0].hash -or $pointerRecords[0].descriptor -cne $old[0].descriptor){throw 'fault-recovery-failed'}
 }
 # A write by a different actor is not accepted as our expected pointer state.
 [IO.File]::WriteAllText($targets[4].path,'unexpected writer')
 $rejected=$false;try{Write-CompletionPointer 4 ([Text.Encoding]::UTF8.GetBytes('new fixture'))}catch{$rejected=$true}
 if(-not $rejected -or [IO.File]::ReadAllText($targets[4].path) -cne 'unexpected writer'){throw 'drift-not-rejected-before-write'}
 $h=[GoriqFixedAclNative]::Open($targets[3].path,$false,$false)
 try{$rejected=$false;try{Assert-CompletionNative $h $targets[4].path}catch{$rejected=$true};if(-not $rejected){throw 'native-alias-accepted'}}finally{$h.Dispose()}
 Write-Output 'Completion real pointer partial/post-write recovery, explicit SACL preservation, writer lock/drift and native alias refusal PASS'
}finally{
 $env:LOCALAPPDATA=$previousLocal
 if([IO.Path]::GetFullPath($fixture) -notlike ([IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\goriq-1858-pointer-*')){throw 'cleanup-boundary'}
 Remove-Item -LiteralPath $fixture -Recurse -Force
}
