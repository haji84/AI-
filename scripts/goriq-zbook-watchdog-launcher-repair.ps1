param([ValidateSet('plan','apply')][string]$Phase='plan')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$stage='source';$changed=$false;$restored=$false;$helperCreated=$false;$rollbackFailed=$false
$revision=$env:GORIQ_PC_APPROVED_REVISION
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedVbs='19D72ED50FE9630FE9390CF296D9A2426F0251D4CE9053BCAA33591DC1E6AB5B'
$expectedWatchdog='E5583739AFECB95DF465424AC836C25A2EBA3BA31F13991C921BA60B956AE7D7'
function Assert-WatchdogRecoveryApproval($approval,[datetimeoffset]$now) {
  if($approval.version -ne 1 -or $approval.issue -ne 1745 -or $approval.goalIssue -ne 1219 -or
    $approval.operation -ne 'zbook-watchdog-launcher-recovery' -or $approval.nodeId -ne 'zbook' -or
    ($approval.files -join '|') -cne 'gai-zbook-launcher-file.ps1|gai-zbook-watchdog.ps1|gai-zbook-watchdog-launcher.vbs' -or
    $approval.permissionsChanged -isnot [bool] -or $approval.permissionsChanged -or
    $approval.tasksChanged -isnot [bool] -or $approval.tasksChanged -or
    $now -lt [datetimeoffset]::Parse($approval.approvedAt) -or $now -ge [datetimeoffset]::Parse($approval.expiresAt) -or
    ([datetimeoffset]::Parse($approval.expiresAt)-[datetimeoffset]::Parse($approval.approvedAt)).TotalHours -gt 24){throw 'approval'}
}
function Replace-RecoveryBytes([string]$path,[byte[]]$bytes) {
  $temporary=Join-Path (Split-Path -Parent $path) ('.goriq-1745-'+[guid]::NewGuid().ToString('N')+'.tmp')
  try {
    $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    [IO.File]::Replace($temporary,$path,[NullString]::Value)
  }finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
}
function Assert-RecoveryNativePath([string]$path) {
  if(-not ('Goriq1745Path' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Goriq1745Path {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint length, uint flags);
}
'@
  }
  $stream=[IO.File]::OpenRead($path)
  try {
    $buffer=New-Object Text.StringBuilder 4096
    $length=[Goriq1745Path]::GetFinalPathNameByHandle($stream.SafeFileHandle.DangerousGetHandle(),$buffer,4096,0)
    if($length -eq 0 -or $length -ge 4096 -or $buffer.ToString() -ine ('\\?\'+[IO.Path]::GetFullPath($path))){throw 'native-view'}
  }finally{$stream.Dispose()}
}
try {
  if($env:OS -ne 'Windows_NT' -or $revision -notmatch '^[a-f0-9]{40}$' -or (Get-Location).Path -ine $source -or
    (& git rev-parse HEAD).Trim() -ne $revision){throw 'source'}
  & git diff --quiet HEAD -- .
  if($LASTEXITCODE -ne 0){throw 'source'}
  & node (Join-Path $PSScriptRoot 'goriq-pc-approved-source.mjs')
  if($LASTEXITCODE -ne 0){throw 'main-ci'}
  $approval=Get-Content (Join-Path $source 'docs\authorizations\1745-zbook-watchdog-launcher-recovery.json') -Raw | ConvertFrom-Json
  Assert-WatchdogRecoveryApproval $approval ([datetimeoffset]::UtcNow)
  . (Join-Path $PSScriptRoot 'gai-zbook-launcher-file.ps1')
  $stage='native-baseline'
  $stateRoot=Join-Path $env:LOCALAPPDATA 'GAIWorker'
  $watchdog=Join-Path $stateRoot 'gai-zbook-watchdog.ps1'
  $launcher=Join-Path $stateRoot 'gai-zbook-watchdog-launcher.vbs'
  $helper=Join-Path $stateRoot 'gai-zbook-launcher-file.ps1'
  Assert-RecoveryNativePath $watchdog
  Assert-RecoveryNativePath $launcher
  if(Test-Path -LiteralPath $helper){throw 'unexpected-helper'}
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $acls=@{}
  foreach($path in @($stateRoot,$watchdog,$launcher)){
    if((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'native-path'}
    $acl=Get-Acl -LiteralPath $path
    $owner=if($acl.Owner -match '^S-1-'){$acl.Owner}else{([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value}
    if($owner -ne $identity.User.Value){throw 'native-owner'}
    $acls[$path]=$acl.Sddl
  }
  if((Get-FileHash $launcher -Algorithm SHA256).Hash -ne $expectedVbs -or
    (Get-FileHash $watchdog -Algorithm SHA256).Hash -ne $expectedWatchdog){throw 'baseline-hash'}
  $launcherBefore=[IO.File]::ReadAllBytes($launcher)
  $watchdogBefore=[IO.File]::ReadAllBytes($watchdog)
  $text=[IO.File]::ReadAllText($launcher)
  $lines=@($text -split '\r?\n' | Where-Object {$_ -ne ''})
  if($lines.Count -ne 8 -or ($lines[0..3] -join "`n") -cne ($lines[4..7] -join "`n") -or
    $lines[0] -cne 'Option Explicit' -or $lines[1] -cne 'Dim shell' -or
    -not $lines[3].Contains($watchdog)){throw 'duplicate-shape'}
  $nextLauncher=($lines[0..3] -join "`r`n")+"`r`n"
  $taskXml=@{}
  foreach($name in @('GAI-ZBook-Runner-OnLogon','GAI-ZBook-Runner-Supervisor','GAI-ZBook-Watchdog')){
    $task=Get-ScheduledTask -TaskName $name
    $owner=[string]$task.Principal.UserId
    if($owner -notmatch '^S-1-'){$owner=([Security.Principal.NTAccount]$owner).Translate([Security.Principal.SecurityIdentifier]).Value}
    if($owner -ne $identity.User.Value -or $task.Principal.RunLevel -ne 'Limited' -or $task.Principal.LogonType -ne 'Interactive' -or
      $task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ine (Join-Path $env:SystemRoot 'System32\wscript.exe') -or
      -not $task.Actions[0].Arguments.Contains($launcher) -or $task.Actions[0].Arguments -notmatch '//B' -or
      $task.Actions[0].Arguments -notmatch '//NoLogo' -or -not $task.Settings.Enabled){throw 'task-baseline'}
    $taskXml[$name]=Export-ScheduledTask -TaskName $name
  }
  if(@(Get-Process -Name 'Runner.Listener','Runner.Worker' -ErrorAction SilentlyContinue).Count){throw 'runner-already-active'}
  $receipt=@{version=1;issue=1745;nodeId='zbook';phase=$Phase;revision=$revision;readOnly=($Phase -eq 'plan');duplicateConfirmed=$true;taskCount=3;tasksUnchanged=$true;permissionsUnchanged=$true;observedAt=[datetimeoffset]::UtcNow.ToString('o')}
  if($Phase -eq 'plan'){$receipt | ConvertTo-Json -Compress;exit 0}
  $stage='backup'
  $backupRoot=Join-Path $stateRoot ('recovery-1745\'+$revision)
  if(Test-Path -LiteralPath $backupRoot){throw 'backup-already-exists'}
  New-Item -ItemType Directory -Path $backupRoot | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $backupRoot 'launcher-before.vbs'),$launcherBefore)
  [IO.File]::WriteAllBytes((Join-Path $backupRoot 'watchdog-before.ps1'),$watchdogBefore)
  $taskXml | ConvertTo-Json | Set-Content (Join-Path $backupRoot 'tasks-before.json') -Encoding UTF8
  if((Get-FileHash (Join-Path $backupRoot 'launcher-before.vbs') -Algorithm SHA256).Hash -ne $expectedVbs -or
    (Get-FileHash (Join-Path $backupRoot 'watchdog-before.ps1') -Algorithm SHA256).Hash -ne $expectedWatchdog){throw 'backup-mismatch'}
  Assert-WatchdogRecoveryApproval $approval ([datetimeoffset]::UtcNow)
  foreach($name in $taskXml.Keys){if((Export-ScheduledTask -TaskName $name) -cne $taskXml[$name]){throw 'baseline-changed'}}
  if((Get-FileHash $launcher -Algorithm SHA256).Hash -ne $expectedVbs -or (Get-FileHash $watchdog -Algorithm SHA256).Hash -ne $expectedWatchdog){throw 'baseline-changed'}
  $stage='restore-launcher'
  $helperBytes=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'gai-zbook-launcher-file.ps1'))
  $file=[IO.File]::Open($helper,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $helperCreated=$true
  try{$file.Write($helperBytes,0,$helperBytes.Length);$file.Flush($true)}finally{$file.Dispose()}
  $changed=$true
  Replace-RecoveryBytes $watchdog ([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'gai-zbook-watchdog.ps1')))
  Write-GaiLauncherFile $launcher $nextLauncher
  $stage='verify-publication'
  foreach($path in $acls.Keys){if((Get-Acl -LiteralPath $path).Sddl -cne $acls[$path]){throw 'acl-changed'}}
  foreach($name in $taskXml.Keys){if((Export-ScheduledTask -TaskName $name) -cne $taskXml[$name]){throw 'task-changed'}}
  foreach($path in @($watchdog,$launcher,$helper)){Assert-RecoveryNativePath $path}
  foreach($name in @('gai-zbook-watchdog.ps1','gai-zbook-launcher-file.ps1')){
    if((Get-FileHash (Join-Path $stateRoot $name) -Algorithm SHA256).Hash -ne
      (Get-FileHash (Join-Path $PSScriptRoot $name) -Algorithm SHA256).Hash){throw 'writer-mismatch'}
  }
  if([IO.File]::ReadAllText($launcher) -cne $nextLauncher){throw 'launcher-mismatch'}
  $receipt.publicationVerified=$true;$receipt.backupRetained=$true;$receipt.watchdogRecoveryVerified=$false
  $receipt.observedAt=[datetimeoffset]::UtcNow.ToString('o')
  $receipt | ConvertTo-Json -Compress
}catch{
  $reason=$_.Exception.Message
  if($changed){
    try{
      Replace-RecoveryBytes $watchdog $watchdogBefore
      Replace-RecoveryBytes $launcher $launcherBefore
      $restored=((Get-FileHash $watchdog -Algorithm SHA256).Hash -eq $expectedWatchdog -and (Get-FileHash $launcher -Algorithm SHA256).Hash -eq $expectedVbs)
      $rollbackFailed=-not $restored
    }catch{$rollbackFailed=$true}
  }
  $known=@('source','main-ci','approval','unexpected-helper','native-path','native-view','native-owner','baseline-hash','duplicate-shape','task-baseline','runner-already-active','backup-already-exists','backup-mismatch','baseline-changed','acl-changed','task-changed','launcher-mismatch','writer-mismatch')
  if($reason -notin $known){$reason='recovery-failed'}
  @{version=1;issue=1745;phase=$Phase;failedStage=$stage;reason=$reason;changed=$changed;helperRetained=$helperCreated;restored=$restored;rollbackFailed=$rollbackFailed;watchdogRecoveryVerified=$false;observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  exit 1
}
