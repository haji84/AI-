Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Load only pure validation/publication functions; never execute the native repair body.
$script=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-watchdog-launcher-repair.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($script,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'repair-parse-error'}
foreach($name in @('Assert-WatchdogRecoveryApproval','Replace-RecoveryBytes','Assert-RecoveryNativePath')){
  $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if(-not $function){throw 'missing-repair-function'}
  . ([scriptblock]::Create($function.Extent.Text))
}
$json=Get-Content (Join-Path $PSScriptRoot '..\docs\authorizations\1745-zbook-watchdog-launcher-recovery.json') -Raw
$approval=$json | ConvertFrom-Json
$now=[datetimeoffset]::Parse($approval.approvedAt).AddMinutes(1)
Assert-WatchdogRecoveryApproval $approval $now
$cases=@(
  {param($a) $a.issue=1662},
  {param($a) $a.nodeId='macbook'},
  {param($a) $a.operation='other'},
  {param($a) $a.permissionsChanged=$true},
  {param($a) $a.permissionsChanged='false'},
  {param($a) $a.tasksChanged=$true},
  {param($a) $a.files+=@('unrelated.ps1')},
  {param($a) $a.expiresAt=([datetimeoffset]::Parse($a.approvedAt).AddDays(2)).ToString('o')}
)
foreach($case in $cases){
  $candidate=$json | ConvertFrom-Json
  & $case $candidate
  $rejected=$false
  try{Assert-WatchdogRecoveryApproval $candidate $now}catch{$rejected=$true}
  if(-not $rejected){throw 'invalid-approval-accepted'}
}
foreach($instant in @(([datetimeoffset]::Parse($approval.approvedAt).AddSeconds(-1)),([datetimeoffset]::Parse($approval.expiresAt)))){
  $rejected=$false;try{Assert-WatchdogRecoveryApproval $approval $instant}catch{$rejected=$true}
  if(-not $rejected){throw 'out-of-window-approval-accepted'}
}
$root=Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\tmp'))) ('watchdog-repair-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$target=Join-Path $root 'fixture.bin'
[IO.File]::WriteAllBytes($target,[byte[]](1,2,3))
$acl=(Get-Acl -LiteralPath $target).Sddl
Assert-RecoveryNativePath $target
Replace-RecoveryBytes $target ([byte[]](4,5,6))
if([Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -cne 'BAUG' -or (Get-Acl -LiteralPath $target).Sddl -cne $acl){throw 'replace-bytes-or-acl'}
$lock=[IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{
  $rejected=$false;try{Replace-RecoveryBytes $target ([byte[]](7,8,9))}catch{$rejected=$_.Exception.InnerException -is [IO.IOException]}
  if(-not $rejected){throw 'locked-recovery-target-accepted'}
}finally{$lock.Dispose()}
if([Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -cne 'BAUG'){throw 'locked-target-damaged'}
Replace-RecoveryBytes $target ([byte[]](1,2,3))
if([Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -cne 'AQID'){throw 'rollback-bytes-mismatch'}
if(@(Get-ChildItem $root -Filter '.goriq-1745-*.tmp').Count){throw 'recovery-temporary-left-behind'}
Write-Host 'Recovery scope/expiry rejection, native path, byte publication and rollback fixtures PASS.'
exit 0
