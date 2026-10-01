param([ValidateSet('plan','apply')][string]$Phase='plan')
# Existing installation refresh only. No task registration, permissions, schema or network changes.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$stage='source'; $stopped=$false; $switched=$false; $restored=$false; $pointersRestored=$false
$taskName='JARVIS Remote Host'
$ports=@(3000,8787,8790,8792)
$revision=$env:GORIQ_PC_APPROVED_REVISION
$source=(Get-Location).Path
$production=Join-Path $env:USERPROFILE 'JARVIS\production'
$configPath=Join-Path $production 'config.dpapi'
$launcherPath=Join-Path $production 'launch-current.ps1'
$releaseRoot=Join-Path $env:USERPROFILE ('JARVIS\releases\'+$revision)
$backupRoot=Join-Path $production ('runtime-refresh\'+$revision)
$node=(Get-Command node.exe -ErrorAction Stop).Source

function Assert-Approval {
  $approval=Get-Content -LiteralPath (Join-Path $source 'docs\authorizations\1662-pc-enrollment.json') -Raw | ConvertFrom-Json
  $now=[datetimeoffset]::UtcNow
  if($approval.issue -ne 1662 -or $approval.goalIssue -ne 1219 -or $now -lt [datetimeoffset]::Parse($approval.approvedAt) -or
    $now -ge [datetimeoffset]::Parse($approval.expiresAt) -or
    @($approval.targets | Where-Object {$_.nodeId -eq 'zbook' -and $_.platform -eq 'windows'}).Count -ne 1){throw 'approval'}
}
function Test-KnownReadOnlyRights([long]$rights) {
  # ReadAndExecute plus Synchronize only. Reject generic and unknown bits.
  return ($rights -gt 0 -and ($rights -band (-bnot [long]0x1200A9)) -eq 0)
}
function Test-NativeAllowSid([string]$ruleSid,[long]$rights) {
  if($ruleSid -in @($identity.User.Value,'S-1-5-18')){return $true}
  # Read-only existing-installation diagnostics may inspect an unchanged OS
  # administrator ACE or known read-only rights to finish diagnosis. Apply
  # retains its strict owner/SYSTEM boundary for every additional principal.
  return ($Phase -eq 'plan' -and ($ruleSid -eq 'S-1-5-32-544' -or (Test-KnownReadOnlyRights $rights)))
}
function Assert-NativeFile([string]$path) {
  $item=Get-Item -LiteralPath $path -ErrorAction Stop
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'path'}
  $owner=(Get-Acl -LiteralPath $path).Owner
  if($owner -match '^S-1-'){$sid=([Security.Principal.SecurityIdentifier]$owner).Value}
  else{$sid=([Security.Principal.NTAccount]$owner).Translate([Security.Principal.SecurityIdentifier]).Value}
  if($sid -ne $identity.User.Value){throw 'owner'}
  foreach($rule in (Get-Acl -LiteralPath $path).Access){
    $ruleSid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if($rule.AccessControlType -eq 'Allow' -and -not (Test-NativeAllowSid $ruleSid ([long]$rule.FileSystemRights))){throw 'private-acl'}
  }
}
function Native-File-Facts([string]$label,[string]$path) {
  try{
    $item=Get-Item -LiteralPath $path -ErrorAction Stop
    $acl=Get-Acl -LiteralPath $path
    if($acl.Owner -match '^S-1-'){$ownerSid=([Security.Principal.SecurityIdentifier]$acl.Owner).Value}
    else{$ownerSid=([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value}
    $ownerClass=if($ownerSid -eq $identity.User.Value){'current-user'}elseif($ownerSid -eq 'S-1-5-32-544'){'administrators'}elseif($ownerSid -eq 'S-1-5-18'){'system'}else{'other'}
    $onlyApproved=$true; $additionalClasses=@(); $additionalEntries=@()
    foreach($rule in $acl.Access){
      $ruleSid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if($rule.AccessControlType -eq 'Allow' -and $ruleSid -notin @($identity.User.Value,'S-1-5-18')){
        $onlyApproved=$false
        $additionalClasses+=if($ruleSid -eq 'S-1-5-32-544'){'builtin-administrators'}else{'other'}
        $principalClass=switch($ruleSid){
          'S-1-5-32-544' {'builtin-administrators'}
          'S-1-3-0' {'creator-owner'}
          'S-1-3-4' {'owner-rights'}
          'S-1-5-32-545' {'builtin-users'}
          'S-1-5-11' {'authenticated-users'}
          'S-1-1-0' {'everyone'}
          'S-1-15-2-1' {'all-application-packages'}
          'S-1-15-2-2' {'all-restricted-application-packages'}
          default {'other'}
        }
        # Public permission categories only; never emit account names or unknown SIDs.
        # 0xD0156 covers write/append/attributes/delete/change-permissions/take-ownership.
        $additionalEntries+=@{principalClass=$principalClass;inherited=[bool]$rule.IsInherited;
          inheritanceOnly=[bool]($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly);
          canModifyOrDelete=[bool]([long]$rule.FileSystemRights -band 0xD0156);
          knownReadOnlyRights=(Test-KnownReadOnlyRights ([long]$rule.FileSystemRights))}
      }
    }
    return @{surface=$label;exists=$true;reparsePoint=[bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint);
      ownerClass=$ownerClass;onlyCurrentUserAndSystemAllowed=$onlyApproved;
      additionalAllowClasses=@($additionalClasses | Sort-Object -Unique);
      additionalAllowEntries=$additionalEntries;
      nonOsAdditionalAllowPresent=($additionalClasses -contains 'other')}
  }catch{return @{surface=$label;unavailable=$true}}
}
function Inspect-State([string]$operation) {
  $inputValue=@{current=$current; previousRevision=$current.commit; releaseRoot=$releaseRoot; operation=$operation} | ConvertTo-Json -Depth 20 -Compress
  $receipt=$inputValue | & $node (Join-Path $source 'scripts\goriq-pc-runtime-state.ts') 2>$null
  if($LASTEXITCODE -ne 0){throw 'state'}
  return ($receipt | ConvertFrom-Json)
}
function Get-OwnedTree([string]$root,[bool]$requireHealthy=$true) {
  $all=@(Get-CimInstance Win32_Process)
  $hosts=@($all | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -and
    $_.CommandLine.Contains($root) -and $_.CommandLine.Contains('jarvis-remote-host.mjs')})
  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)
  if(-not $requireHealthy -and $hosts.Count -eq 0 -and $listeners.Count -eq 0){return @()}
  if($hosts.Count -ne 1){throw 'host'}
  $ids=@([int]$hosts[0].ProcessId)
  do {
    $added=@($all | Where-Object {$ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId})
    $ids+=@($added | ForEach-Object {[int]$_.ProcessId})
  } while($added.Count -gt 0)
  $tree=@($all | Where-Object {$ids -contains [int]$_.ProcessId})
  foreach($p in $tree){
    $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.User.Value){throw 'process-owner'}
  }
  if(($requireHealthy -and @($listeners.LocalPort | Select-Object -Unique).Count -ne 4) -or
    @($listeners | Where-Object {$ids -notcontains [int]$_.OwningProcess}).Count){throw 'listeners'}
  return $tree
}
function Same-Bytes([byte[]]$left,[byte[]]$right) {
  if($left.Length -ne $right.Length){return $false}
  for($i=0;$i -lt $left.Length;$i++){if($left[$i] -ne $right[$i]){return $false}}
  return $true
}
function Stop-OwnedTree($tree) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
  # Stop only preidentified descendants still carrying the same PID AND creation timestamp.
  foreach($p in @($tree | Sort-Object ProcessId -Descending)){
    $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ProcessId) -ErrorAction SilentlyContinue
    if($null -eq $live){continue}
    if($live.CreationDate -ne $p.CreationDate -or $live.CommandLine -cne $p.CommandLine){throw 'process-replaced'}
    $owner=Invoke-CimMethod -InputObject $live -MethodName GetOwnerSid
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.User.Value){throw 'process-owner'}
    $result=Invoke-CimMethod -InputObject $live -MethodName Terminate
    if($result.ReturnValue -ne 0){throw 'process-permission'}
  }
  for($i=0;$i -lt 10;$i++){
    if(-not (Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)){return}
    Start-Sleep -Seconds 1
  }
  throw 'ports-busy'
}
function Replace-Bytes([string]$path,[byte[]]$bytes) {
  $temporary=$path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
  $stream=New-Object IO.FileStream($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  [IO.File]::Replace($temporary,$path,$null)
}
function Wait-Health([string]$sha) {
  for($i=0;$i -lt 45;$i++){
    try {
      $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
      $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)
      if($health.ok -eq $true -and $health.runtimeRevision -eq $sha -and
        (Get-ScheduledTask -TaskName $taskName).State -eq 'Running' -and
        @($listeners.LocalPort | Select-Object -Unique).Count -eq 4){return}
    }catch{}
    Start-Sleep -Seconds 1
  }
  throw 'health'
}
try {
  if($env:OS -ne 'Windows_NT' -or $revision -notmatch '^[a-f0-9]{40}$' -or
    ((& git rev-parse HEAD).Trim()) -ne $revision){throw 'source'}
  & $node (Join-Path $source 'scripts\goriq-pc-approved-source.mjs')
  if($LASTEXITCODE -ne 0){throw 'main-ci'}
  Assert-Approval
  $stage='installation'
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  if($Phase -eq 'plan'){
    @{version=1;nodeId='zbook';phase='plan';readOnly=$true;nativePrerequisites=@(
      (Native-File-Facts 'production-directory' $production),(Native-File-Facts 'protected-config' $configPath),
      (Native-File-Facts 'native-launcher' $launcherPath))} | ConvertTo-Json -Depth 7 -Compress
  }
  $stage='production-directory'; Assert-NativeFile $production
  $stage='protected-config'; Assert-NativeFile $configPath
  $stage='native-launcher'; Assert-NativeFile $launcherPath
  $stage='existing-task'
  $task=Get-ScheduledTask -TaskName $taskName
  $taskXml=Export-ScheduledTask -TaskName $taskName
  $principal=[string]$task.Principal.UserId
  if($principal -ne $identity.User.Value){$principal=([Security.Principal.NTAccount]$principal).Translate([Security.Principal.SecurityIdentifier]).Value}
  if($principal -ne $identity.User.Value -or $task.Principal.RunLevel -ne 'Limited' -or
    $task.Principal.LogonType -ne 'Password' -or $task.Actions.Count -ne 1 -or $task.State -ne 'Running'){throw 'task'}
  $stage='compatibility-launcher'
  $compat=Join-Path $env:LOCALAPPDATA 'JARVIS\production\launch-current.ps1'
  if($task.Actions[0].Execute -notmatch '(?i)\\WindowsPowerShell\\v1\.0\\powershell\.exe$' -or
    -not $task.Actions[0].Arguments.Contains($compat) -or $task.Actions[0].Arguments -notmatch '(?i)RemoteSigned' -or
    -not ([IO.File]::ReadAllText($compat)).Contains($launcherPath)){throw 'compatibility-launcher'}
  $stage='existing-dpapi'
  $configBytes=[IO.File]::ReadAllBytes($configPath)
  $secure=ConvertTo-SecureString ([IO.File]::ReadAllText($configPath).Trim())
  $plain=(New-Object Management.Automation.PSCredential('config',$secure)).GetNetworkCredential().Password
  $current=$plain | ConvertFrom-Json
  $stage='existing-release'
  $oldRoot=[IO.Path]::GetFullPath($current.releaseRoot)
  if($current.version -ne 1 -or $current.commit -notmatch '^[a-f0-9]{40}$' -or
    $oldRoot -ine (Join-Path $env:USERPROFILE ('JARVIS\releases\'+$current.commit)) -or $oldRoot -ieq $releaseRoot){throw 'release'}
  Assert-NativeFile $oldRoot
  $stage='existing-manifest'
  $oldManifest=Get-Content -LiteralPath (Join-Path $oldRoot 'jarvis-release.json') -Raw | ConvertFrom-Json
  if($oldManifest.commit -ne $current.commit){throw 'manifest'}
  $stage='native-launcher-shape'
  $launcherBytes=[IO.File]::ReadAllBytes($launcherPath)
  $launcher=[IO.File]::ReadAllText($launcherPath)
  # Preserve the entire established launcher including its existing local environment.
  # Only exact native release-root literals are replaced; unfamiliar launchers fail closed.
  if(-not $launcher.Contains($oldRoot)){throw 'launcher-shape'}
  $nextLauncher=$launcher.Replace($oldRoot,$releaseRoot)
  $stage='existing-process-tree'
  $tree=Get-OwnedTree $oldRoot
  $stage='readonly-state'
  $before=Inspect-State 'inspect'
  $receipt=@{version=1;issue=1662;goalIssue=1219;nodeId='zbook';phase=$Phase;revision=$revision;
    previousRevision=$current.commit;schemaCompatible=$before.schemaCompatible;quiescent=$before.quiescent;
    androidCount=$before.androidCount;identityCount=$before.identityCount;identityDigest=$before.identityDigest;
    taskUnchanged=$true;nativeLauncherSupported=$true;readOnly=($Phase -eq 'plan');observedAt=[datetimeoffset]::UtcNow.ToString('o')}
  if($Phase -eq 'plan'){$receipt | ConvertTo-Json -Compress;exit 0}
  $stage='build'
  if(Test-Path -LiteralPath $releaseRoot){throw 'immutable-release-exists'}
  New-Item -ItemType Directory -Path $releaseRoot | Out-Null
  $archive=Join-Path $releaseRoot 'source.tar'
  & git archive --format=tar ('--output='+$archive) $revision
  if($LASTEXITCODE -ne 0){throw 'archive'}
  & tar -xf $archive -C $releaseRoot
  if($LASTEXITCODE -ne 0){throw 'archive-extract'}
  Push-Location $releaseRoot
  try {
    if((& node --version).Trim() -ne 'v24.19.0' -or (& pnpm --version).Trim() -ne '11.19.0'){throw 'toolchain'}
    & pnpm install --frozen-lockfile
    if($LASTEXITCODE -ne 0){throw 'install'}
    & pnpm build
    if($LASTEXITCODE -ne 0){throw 'build'}
    $manifestJson=@{version=1;commit=$revision;issue=1662;builtAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'jarvis-release.json'),$manifestJson,(New-Object Text.UTF8Encoding($false)))
  }finally{Pop-Location}
  $stage='prepare'
  Assert-Approval
  & $node (Join-Path $source 'scripts\goriq-pc-approved-source.mjs')
  if($LASTEXITCODE -ne 0){throw 'main-ci'}
  if(-not (Same-Bytes $configBytes ([IO.File]::ReadAllBytes($configPath))) -or
    -not (Same-Bytes $launcherBytes ([IO.File]::ReadAllBytes($launcherPath))) -or
    (Export-ScheduledTask -TaskName $taskName) -cne $taskXml){throw 'baseline-changed'}
  $prepared=Inspect-State 'prepare'
  $next=$plain | ConvertFrom-Json
  $next.commit=$revision;$next.releaseRoot=$releaseRoot
  $candidate=$next | ConvertTo-Json -Depth 20 -Compress
  $candidate | & $node (Join-Path $releaseRoot 'scripts\validate-jarvis-production-config.mjs') $releaseRoot $production
  if($LASTEXITCODE -ne 0){throw 'candidate'}
  [IO.File]::WriteAllBytes((Join-Path $backupRoot 'config-before.dpapi'),$configBytes)
  # Launcher is local protected data too: capture encrypted, not an Actions artifact.
  $launcher | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString |
    Set-Content -LiteralPath (Join-Path $backupRoot 'launcher-before.dpapi')
  $encoded=$candidate | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
  $stage='quiesce'
  $tree=Get-OwnedTree $oldRoot
  $stopped=$true
  Stop-OwnedTree $tree
  $quiescent=Inspect-State 'inspect'
  if($quiescent.identityDigest -ne $prepared.identityDigest -or $quiescent.fleetDigest -ne $prepared.fleetDigest -or $quiescent.tasksDigest -ne $prepared.tasksDigest -or
    $quiescent.compassDigest -ne $prepared.compassDigest){throw 'state-changed'}
  Assert-Approval
  $stage='activate';$switched=$true
  Replace-Bytes $configPath ([Text.Encoding]::UTF8.GetBytes($encoded))
  # PowerShell 5.1 requires UTF8 BOM to preserve existing Unicode path/environment literals.
  Replace-Bytes $launcherPath ([byte[]]([Text.Encoding]::UTF8.GetPreamble()+[Text.Encoding]::UTF8.GetBytes($nextLauncher)))
  Start-ScheduledTask -TaskName $taskName
  $stage='verify'
  Wait-Health $revision
  $candidateTree=Get-OwnedTree $releaseRoot
  $after=Inspect-State 'inspect'
  if($after.identityDigest -ne $quiescent.identityDigest -or $after.fleetDigest -ne $quiescent.fleetDigest -or $after.tasksDigest -ne $quiescent.tasksDigest -or
    $after.schemaDigest -ne $quiescent.schemaDigest -or $after.compassDigest -ne $quiescent.compassDigest -or
    (Export-ScheduledTask -TaskName $taskName) -cne $taskXml){throw 'verification'}
  $receipt.runtimeExact=$true;$receipt.identityPreserved=$true;$receipt.schemaPreserved=$true
  $receipt.observedAt=[datetimeoffset]::UtcNow.ToString('o')
  $receipt | ConvertTo-Json -Compress
}catch {
  $safeReasons=@('approval','path','owner','private-acl','task','compatibility-launcher','release','manifest','launcher-shape',
    'host','process-owner','listeners','process-replaced','process-permission','ports-busy','source','main-ci','state',
    'immutable-release-exists','archive','archive-extract','toolchain','install','build','baseline-changed','candidate','state-changed',
    'health','verification','rollback-listeners')
  $failureReason=if($safeReasons -contains $_.Exception.Message){$_.Exception.Message}else{'unexpected-prerequisite-error'}
  if($stopped){
    try {
      if($switched){
        try {
          $rollbackTree=Get-OwnedTree $releaseRoot $false
          Stop-OwnedTree $rollbackTree
        } finally {
          # Even an unidentifiable orphan may not strand the approved runtime pointers.
          # Do not kill unknown owners or start the old task while those listeners remain.
          Replace-Bytes $configPath $configBytes
          Replace-Bytes $launcherPath $launcherBytes
          $pointersRestored=$true
        }
      }
      if(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue){throw 'rollback-listeners'}
      Start-ScheduledTask -TaskName $taskName
      # Old code lacks runtimeRevision. Require old owned service tree, healthy Broker, unchanged config and task.
      for($i=0;$i -lt 30;$i++){
        try{
          $oldHealth=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
          $null=Get-OwnedTree $oldRoot
          if($oldHealth.ok -eq $true -and (Export-ScheduledTask -TaskName $taskName) -ceq $taskXml -and
            (Same-Bytes $configBytes ([IO.File]::ReadAllBytes($configPath))) -and
            (Same-Bytes $launcherBytes ([IO.File]::ReadAllBytes($launcherPath)))){$restored=$true;break}
        }catch{}
        Start-Sleep -Seconds 1
      }
    }catch{}
  }
  # Never print exception/config/process/task command lines. Retain current DB and all protected backups.
  @{version=1;issue=1662;nodeId='zbook';phase=$Phase;failedStage=$stage;failureReason=$failureReason;restored=$restored;pointersRestored=$pointersRestored;
    databaseRestored=$false;knownFailure='PC_RUNTIME_REFRESH_FAILED';observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  exit 1
}finally{$plain=$null;$candidate=$null;$encoded=$null;$secure=$null;$current=$null;$next=$null}
