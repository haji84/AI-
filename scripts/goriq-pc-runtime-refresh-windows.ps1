param([ValidateSet('plan','apply')][string]$Phase='plan')
# Existing installation refresh. Approved new-release Owner normalization only; no task, DACL, schema or network changes.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$stage='source'; Write-Host ('REFRESH_STAGE='+$stage); $stopped=$false; $switched=$false; $restored=$false; $pointersRestored=$false; $baselineRestored=$false; $baselineStopped=$false
$taskName='JARVIS Remote Host'
$ports=@(3000,8787,8790,8792)
$revision=$env:GORIQ_PC_APPROVED_REVISION
$source=(Get-Location).Path
$installationRoot=Join-Path $env:USERPROFILE 'JARVIS'
$production=Join-Path $installationRoot 'production'
$configPath=Join-Path $production 'config.dpapi'
$launcherPath=Join-Path $production 'launch-current.ps1'
$releaseRoot=Join-Path $env:USERPROFILE ('JARVIS\releases\'+$revision)
$backupRoot=Join-Path $production ('runtime-refresh\'+$revision)
$node=(Get-Command node.exe -ErrorAction Stop).Source

function Assert-Approval {
  $approval=Get-Content -LiteralPath (Join-Path $source 'docs\authorizations\1662-zbook-runtime-refresh.json') -Raw | ConvertFrom-Json
  $now=[datetimeoffset]::UtcNow
  if($approval.version -ne 1 -or $approval.operation -ne 'zbook-runtime-refresh' -or $approval.targets.Count -ne 1 -or $approval.issue -ne 1662 -or $approval.goalIssue -ne 1219 -or $now -lt [datetimeoffset]::Parse($approval.approvedAt) -or
    $now -ge [datetimeoffset]::Parse($approval.expiresAt) -or
    ([datetimeoffset]::Parse($approval.expiresAt)-[datetimeoffset]::Parse($approval.approvedAt)).TotalHours -gt 24 -or
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
function Runtime-Process-Facts([string]$root) {
  try {
    $all=@(Get-CimInstance Win32_Process -OperationTimeoutSec 15)
    $nodes=@($all | Where-Object {$_.Name -ieq 'node.exe'})
    $roles=@($nodes | Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf('jarvis-remote-host.mjs',[StringComparison]::OrdinalIgnoreCase) -ge 0})
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)
    $administratorRoleActive=$null
    try {$principal=New-Object Security.Principal.WindowsPrincipal($identity);$administratorRoleActive=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}catch{}
    $candidates=@()
    foreach($p in @($nodes | Select-Object -First 32)){
      $ownerClass='unavailable'; $ownerQueryClass='unavailable'
      try {
        $owner=Invoke-CimMethod -OperationTimeoutSec 15 -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop
        $ownerQueryClass=switch([int]$owner.ReturnValue){0 {'success'} 2 {'access-denied'} 3 {'insufficient-privilege'} default {'unavailable'}}
        if($owner.ReturnValue -eq 0){$ownerClass=if($owner.Sid -eq $identity.User.Value){'current-user'}elseif($owner.Sid -eq 'S-1-5-18'){'system'}else{'other'}}
      }catch{}
      $ancestor=$p; $seen=@(); $launcherAncestor=$false
      for($i=0;$i -lt 16;$i++){
        if($seen -contains [int]$ancestor.ProcessId){break}
        $seen+=([int]$ancestor.ProcessId)
        if($ancestor.CommandLine -and ($ancestor.CommandLine.IndexOf($launcherPath,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or
          $ancestor.CommandLine.IndexOf($compat,[StringComparison]::OrdinalIgnoreCase) -ge 0)){$launcherAncestor=$true;break}
        $parent=@($all | Where-Object {[int]$_.ProcessId -eq [int]$ancestor.ParentProcessId})
        if($parent.Count -ne 1){break}
        $ancestor=$parent[0]
      }
      $ids=@([int]$p.ProcessId)
      do {
        $added=@($all | Where-Object {$ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId})
        $ids+=@($added | ForEach-Object {[int]$_.ProcessId})
      }while($added.Count -gt 0)
      $candidatePorts=@($listeners | Where-Object {$ids -contains [int]$_.OwningProcess} | Select-Object -ExpandProperty LocalPort -Unique)
      $directPorts=@($listeners | Where-Object {[int]$_.OwningProcess -eq [int]$p.ProcessId} | Select-Object -ExpandProperty LocalPort -Unique)
      $candidates+=@{ownerClass=$ownerClass;ownerQueryClass=$ownerQueryClass;commandLineAvailable=[bool]$p.CommandLine;
        hostEntrypointObserved=[bool]($p.CommandLine -and $p.CommandLine.IndexOf('jarvis-remote-host.mjs',[StringComparison]::OrdinalIgnoreCase) -ge 0);
        configuredRootExact=[bool]($p.CommandLine -and $p.CommandLine.Contains($root));
        configuredRootIgnoreCase=[bool]($p.CommandLine -and $p.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0);
        launcherAncestorObserved=$launcherAncestor;directListenerPortCount=$directPorts.Count;ownedTreeListenerPortCount=$candidatePorts.Count}
    }
    return @{nodeProcessCount=$nodes.Count;nodeMissingCommandLineCount=@($nodes | Where-Object {-not $_.CommandLine}).Count;
      hostRoleCandidateCount=$roles.Count;listenerPortCount=@($listeners | Select-Object -ExpandProperty LocalPort -Unique).Count;
      candidatesTruncated=($nodes.Count -gt 32);administratorRoleActive=$administratorRoleActive;candidates=$candidates}
  }catch{return @{unavailable=$true}}
}
function Get-LiveListeners {
  # A failed query is not evidence of an empty installation. Query all Listen
  # entries before filtering so an absent service port is not a cmdlet error.
  try {
    return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$ports -contains [int]$_.LocalPort})
  }catch{throw 'listener-query'}
}
function Assert-StoppedInstallation {
  if((Get-ScheduledTask -TaskName $taskName).State -ne 'Ready' -or
    (Export-ScheduledTask -TaskName $taskName) -cne $taskXml){throw 'stopped-installation'}
  if(@(Get-LiveListeners).Count){throw 'stopped-installation'}
  try{$all=@(Get-CimInstance Win32_Process -OperationTimeoutSec 15 -ErrorAction Stop)}catch{throw 'process-query'}
  foreach($p in $all){
    # Unavailable Node command lines cannot prove that an orphan is unrelated.
    if($p.Name -ieq 'node.exe' -and -not $p.CommandLine){throw 'stopped-installation'}
    if($p.CommandLine -and
      ($p.CommandLine.IndexOf($installationRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or
       $p.CommandLine -match '(?i)jarvis-(remote-host|broker|remote-gateway|private-worker-ingress)\.(mjs|ts)')){
      throw 'stopped-installation'
    }
  }
  # Fence changes occurring during inventory enumeration.
  if(@(Get-LiveListeners).Count -or (Get-ScheduledTask -TaskName $taskName).State -ne 'Ready' -or
    (Export-ScheduledTask -TaskName $taskName) -cne $taskXml){throw 'stopped-installation'}
}
function Assert-State-Preserved($left,$right) {
  foreach($field in @('schemaDigest','identityDigest','fleetDigest','tasksDigest','pcTasksDigest','compassDigest')){
    if(-not $left.$field -or -not $right.$field -or $left.$field -cne $right.$field){throw 'state-changed'}
  }
}
function Assert-StoppedRollback {
  Assert-StoppedInstallation
  if(-not (Same-Bytes $configBytes ([IO.File]::ReadAllBytes($configPath))) -or
    -not (Same-Bytes $launcherBytes ([IO.File]::ReadAllBytes($launcherPath)))){throw 'baseline-changed'}
  Assert-State-Preserved $before (Inspect-State 'inspect')
}
function Get-OwnedTree([string]$root,[bool]$requireHealthy=$true,[int[]]$requiredPorts=$ports) {
  try{$all=@(Get-CimInstance Win32_Process -OperationTimeoutSec 15 -ErrorAction Stop)}catch{throw 'process-query'}
  $hosts=@($all | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -and
    $_.CommandLine.Contains($root) -and $_.CommandLine.Contains('jarvis-remote-host.mjs')})
  $listeners=@(Get-LiveListeners)
  if(-not $requireHealthy -and $hosts.Count -eq 0 -and $listeners.Count -eq 0){Assert-StoppedInstallation;return @()}
  if($hosts.Count -ne 1){throw 'host'}
  $ids=@([int]$hosts[0].ProcessId)
  do {
    $added=@($all | Where-Object {$ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId})
    $ids+=@($added | ForEach-Object {[int]$_.ProcessId})
  } while($added.Count -gt 0)
  # The native/compat PowerShell launcher is a parent, not a host descendant.
  # Permit only proven same-owner launcher ancestors; reject every other
  # installation process outside this tree, including listener-free orphans.
  $launcherAncestors=@(); $ancestor=$hosts[0]; $seen=@($ids)
  for($i=0;$i -lt 16;$i++){
    $parent=@($all | Where-Object {[int]$_.ProcessId -eq [int]$ancestor.ParentProcessId})
    if($parent.Count -ne 1 -or $seen -contains [int]$parent[0].ProcessId){break}
    $ancestor=$parent[0]; $seen+=([int]$ancestor.ProcessId)
    if($ancestor.Name -ieq 'powershell.exe' -and $ancestor.CommandLine -and
      ($ancestor.CommandLine.IndexOf($launcherPath,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or
       $ancestor.CommandLine.IndexOf($compat,[StringComparison]::OrdinalIgnoreCase) -ge 0)){
      $owner=Invoke-CimMethod -OperationTimeoutSec 15 -InputObject $ancestor -MethodName GetOwnerSid
      if($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.User.Value){throw 'process-owner'}
      $launcherAncestors+=([int]$ancestor.ProcessId)
    }
  }
  foreach($p in $all){
    if($p.Name -ieq 'node.exe' -and -not $p.CommandLine){throw 'stopped-installation'}
    if($ids -notcontains [int]$p.ProcessId -and $launcherAncestors -notcontains [int]$p.ProcessId -and
      $p.CommandLine -and ($p.CommandLine.IndexOf($installationRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or
       $p.CommandLine -match '(?i)jarvis-(remote-host|broker|remote-gateway|private-worker-ingress)\.(mjs|ts)')){
      throw 'stopped-installation'
    }
  }
  $tree=@($all | Where-Object {$ids -contains [int]$_.ProcessId})
  foreach($p in $tree){
    $owner=Invoke-CimMethod -OperationTimeoutSec 15 -InputObject $p -MethodName GetOwnerSid
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.User.Value){throw 'process-owner'}
  }
  $observedPorts=@($listeners | Select-Object -ExpandProperty LocalPort -Unique)
  if(($requireHealthy -and ($observedPorts.Count -ne $requiredPorts.Count -or
      @($requiredPorts | Where-Object {$observedPorts -notcontains $_}).Count)) -or
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
    $live=Get-CimInstance Win32_Process -OperationTimeoutSec 15 -Filter ('ProcessId='+$p.ProcessId) -ErrorAction SilentlyContinue
    if($null -eq $live){continue}
    if($live.CreationDate -ne $p.CreationDate -or $live.CommandLine -cne $p.CommandLine){throw 'process-replaced'}
    $owner=Invoke-CimMethod -OperationTimeoutSec 15 -InputObject $live -MethodName GetOwnerSid
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.User.Value){throw 'process-owner'}
    $result=Invoke-CimMethod -OperationTimeoutSec 15 -InputObject $live -MethodName Terminate
    if($result.ReturnValue -ne 0){throw 'process-permission'}
  }
  for($i=0;$i -lt 10;$i++){
    if(@(Get-LiveListeners).Count -eq 0){Assert-StoppedInstallation;return}
    Start-Sleep -Seconds 1
  }
  throw 'ports-busy'
}
function Replace-Bytes([string]$path,[byte[]]$bytes) {
  $targetAcl=Get-Acl -LiteralPath $path
  $sections=[Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access
  $securityBefore=$targetAcl.GetSecurityDescriptorSddlForm($sections)
  $temporary=$path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
  # Elevated creation may default to Administrators ownership. Preserve the
  # original boundary before writing any protected content or replacing it.
  $stream=New-Object IO.FileStream($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $stream.Dispose()
  Set-Acl -LiteralPath $temporary -AclObject $targetAcl
  if((Get-Acl -LiteralPath $temporary).GetSecurityDescriptorSddlForm($sections) -cne $securityBefore){throw 'replacement-security'}
  $stream=New-Object IO.FileStream($temporary,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  # PS5.1 casts $null to an empty string for this .NET string parameter.
  [IO.File]::Replace($temporary,$path,[NullString]::Value)
  if((Get-Acl -LiteralPath $path).GetSecurityDescriptorSddlForm($sections) -cne $securityBefore){throw 'replacement-security'}
}
function Restore-ReleaseDirectoryOwner([string]$path,[Security.Principal.SecurityIdentifier]$owner){
  if(-not ('GoriqDirectoryOwnerNative' -as [type])){
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GoriqDirectoryOwnerNative {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
  public static extern uint SetNamedSecurityInfoW(string path, uint objectType,
    uint securityInfo, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
}
'@
  }
  $bytes=New-Object byte[] $owner.BinaryLength
  $owner.GetBinaryForm($bytes,0)
  $pointer=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try{
    [Runtime.InteropServices.Marshal]::Copy($bytes,0,$pointer,$bytes.Length)
    # SE_FILE_OBJECT=1; OWNER_SECURITY_INFORMATION=1 ONLY. No ACL propagation.
    $result=[GoriqDirectoryOwnerNative]::SetNamedSecurityInfoW($path,1,1,$pointer,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
    if($result -ne 0){throw 'OWNER_WRITE_FAILED'}
  }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)}
}
function New-OwnedReleaseDirectory([string]$path,[Security.Principal.SecurityIdentifier]$owner) {
  if(Test-Path -LiteralPath $path){throw 'immutable-release-exists'}
  $null=New-Item -ItemType Directory -Path $path
  $acl=Get-Acl -LiteralPath $path
  $dacl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
  Restore-ReleaseDirectoryOwner $path $owner
  $after=Get-Acl -LiteralPath $path
  if($after.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $owner.Value -or
    $after.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $dacl){throw 'release-security'}
}
function Wait-Health([string]$sha) {
  for($i=0;$i -lt 45;$i++){
    try {
      $state=Inspect-State 'inspect'
      if($state.privateAddressAssigned -isnot [bool]){throw 'private-address-query'}
      $assigned=[bool]$state.privateAddressAssigned
      $required=if($assigned){$ports}else{@(3000,8787,8790)}
      $listeners=@(Get-LiveListeners)
      $observed=@($listeners | Select-Object -ExpandProperty LocalPort -Unique)
      $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
      $gateway=Invoke-RestMethod -Uri 'http://127.0.0.1:8790/health' -TimeoutSec 2
      $dashboard=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2
      if($health.ok -ne $true -or $health.runtimeRevision -ne $sha -or $gateway.ok -ne $true -or
        $dashboard.status -ne 'ok' -or (Get-ScheduledTask -TaskName $taskName).State -ne 'Running' -or
        $observed.Count -ne $required.Count -or @($required | Where-Object {$observed -notcontains $_}).Count){throw 'health'}
      $null=Get-OwnedTree $releaseRoot $true $required
      $confirmation=Inspect-State 'inspect'
      if($confirmation.privateAddressAssigned -isnot [bool] -or $confirmation.privateAddressAssigned -ne $assigned){throw 'private-address-query'}
      return @{coreServicesReady=$true;privateIngressReady=$assigned;
        serviceRecoveryVerified=$assigned;activationState=$(if($assigned){'ready'}else{'network-waiting'})}
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
  $stage='installation'; Write-Host ('REFRESH_STAGE='+$stage)
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principalContext=New-Object Security.Principal.WindowsPrincipal($identity)
  if($Phase -eq 'apply' -and -not $principalContext.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'owner-admin-context'}
  if($Phase -eq 'plan'){
    @{version=1;nodeId='zbook';phase='plan';readOnly=$true;nativePrerequisites=@(
      (Native-File-Facts 'production-directory' $production),(Native-File-Facts 'protected-config' $configPath),
      (Native-File-Facts 'native-launcher' $launcherPath))} | ConvertTo-Json -Depth 7 -Compress
  }
  $stage='production-directory'; Write-Host ('REFRESH_STAGE='+$stage); Assert-NativeFile $production
  $stage='protected-config'; Write-Host ('REFRESH_STAGE='+$stage); Assert-NativeFile $configPath
  $stage='native-launcher'; Write-Host ('REFRESH_STAGE='+$stage); Assert-NativeFile $launcherPath
  $stage='existing-task'; Write-Host ('REFRESH_STAGE='+$stage)
  $task=Get-ScheduledTask -TaskName $taskName
  $taskXml=Export-ScheduledTask -TaskName $taskName
  $principal=[string]$task.Principal.UserId
  if($principal -ne $identity.User.Value){$principal=([Security.Principal.NTAccount]$principal).Translate([Security.Principal.SecurityIdentifier]).Value}
  if($principal -ne $identity.User.Value -or $task.Principal.RunLevel -ne 'Limited' -or
    $task.Principal.LogonType -ne 'Password' -or $task.Actions.Count -ne 1 -or $task.State -notin @('Running','Ready')){throw 'task'}
  $stage='compatibility-launcher'; Write-Host ('REFRESH_STAGE='+$stage)
  $compat=Join-Path $env:LOCALAPPDATA 'JARVIS\production\launch-current.ps1'
  if($task.Actions[0].Execute -notmatch '(?i)\\WindowsPowerShell\\v1\.0\\powershell\.exe$' -or
    -not $task.Actions[0].Arguments.Contains($compat) -or $task.Actions[0].Arguments -notmatch '(?i)RemoteSigned' -or
    -not ([IO.File]::ReadAllText($compat)).Contains($launcherPath)){throw 'compatibility-launcher'}
  $stage='existing-dpapi'; Write-Host ('REFRESH_STAGE='+$stage)
  $configBytes=[IO.File]::ReadAllBytes($configPath)
  $secure=ConvertTo-SecureString ([IO.File]::ReadAllText($configPath).Trim())
  $plain=(New-Object Management.Automation.PSCredential('config',$secure)).GetNetworkCredential().Password
  $current=$plain | ConvertFrom-Json
  $stage='existing-release'; Write-Host ('REFRESH_STAGE='+$stage)
  $oldRoot=[IO.Path]::GetFullPath($current.releaseRoot)
  if($current.version -ne 1 -or $current.commit -notmatch '^[a-f0-9]{40}$' -or
    $oldRoot -ine (Join-Path $env:USERPROFILE ('JARVIS\releases\'+$current.commit)) -or $oldRoot -ieq $releaseRoot){throw 'release'}
  Assert-NativeFile (Join-Path $env:USERPROFILE 'JARVIS\releases')
  Assert-NativeFile $oldRoot
  $stage='existing-manifest'; Write-Host ('REFRESH_STAGE='+$stage)
  $oldManifest=Get-Content -LiteralPath (Join-Path $oldRoot 'jarvis-release.json') -Raw | ConvertFrom-Json
  if($oldManifest.commit -ne $current.commit){throw 'manifest'}
  $stage='native-launcher-shape'; Write-Host ('REFRESH_STAGE='+$stage)
  $launcherBytes=[IO.File]::ReadAllBytes($launcherPath)
  $launcher=[IO.File]::ReadAllText($launcherPath)
  # Preserve the entire established launcher including its existing local environment.
  # Only exact native release-root literals are replaced; unfamiliar launchers fail closed.
  if(-not $launcher.Contains($oldRoot)){throw 'launcher-shape'}
  $nextLauncher=$launcher.Replace($oldRoot,$releaseRoot)
  if($Phase -eq 'plan'){
    # Read-only facts are diagnostic, never authority to stop/select a process.
    @{version=1;nodeId='zbook';phase='plan';readOnly=$true;runtimeProcessFacts=(Runtime-Process-Facts $oldRoot)} | ConvertTo-Json -Depth 7 -Compress
    $stage='readonly-state'; Write-Host ('REFRESH_STAGE='+$stage); $before=Inspect-State 'inspect'
    # Public metadata was already sanitized by the state helper; use a fixed
    # field allowlist so later process failures cannot hide this prerequisite.
    @{version=1;nodeId='zbook';phase='plan';readOnly=$true;runtimeStateFacts=@{
      schemaCompatible=$before.schemaCompatible;quiescent=$before.quiescent;androidCount=$before.androidCount;
      identityCount=$before.identityCount;identityDigest=$before.identityDigest;previousRevision=$before.previousRevision;
      revision=$before.revision;observedAt=$before.observedAt}} | ConvertTo-Json -Depth 4 -Compress
  }
  $stage='existing-process-tree'; Write-Host ('REFRESH_STAGE='+$stage)
  $baselineStopped=($task.State -eq 'Ready')
  if($baselineStopped){Assert-StoppedInstallation;$tree=@()}else{$tree=Get-OwnedTree $oldRoot}
  if($Phase -eq 'apply'){$stage='readonly-state'; Write-Host ('REFRESH_STAGE='+$stage); $before=Inspect-State 'inspect'}
  $receipt=@{version=1;issue=1662;goalIssue=1219;nodeId='zbook';phase=$Phase;revision=$revision;
    previousRevision=$current.commit;schemaCompatible=$before.schemaCompatible;quiescent=$before.quiescent;
    androidCount=$before.androidCount;identityCount=$before.identityCount;identityDigest=$before.identityDigest;
    taskUnchanged=$true;nativeLauncherSupported=$true;baselineStopped=$baselineStopped;readOnly=($Phase -eq 'plan');observedAt=[datetimeoffset]::UtcNow.ToString('o')}
  if($Phase -eq 'plan'){$receipt | ConvertTo-Json -Compress;exit 0}
  $stage='toolchain'; Write-Host ('REFRESH_STAGE='+$stage)
  if((& node --version).Trim() -ne 'v24.19.0' -or (& pnpm --version).Trim() -ne '11.19.0'){throw 'toolchain'}
  $stage='build'; Write-Host ('REFRESH_STAGE='+$stage)
  if(Test-Path -LiteralPath $releaseRoot){throw 'immutable-release-exists'}
  New-OwnedReleaseDirectory $releaseRoot $identity.User
  Assert-NativeFile $releaseRoot
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
  $stage='prepare'; Write-Host ('REFRESH_STAGE='+$stage)
  Assert-Approval
  & $node (Join-Path $source 'scripts\goriq-pc-approved-source.mjs')
  if($LASTEXITCODE -ne 0){throw 'main-ci'}
  if(-not (Same-Bytes $configBytes ([IO.File]::ReadAllBytes($configPath))) -or
    -not (Same-Bytes $launcherBytes ([IO.File]::ReadAllBytes($launcherPath))) -or
    (Export-ScheduledTask -TaskName $taskName) -cne $taskXml){throw 'baseline-changed'}
  if($baselineStopped){Assert-StoppedInstallation}else{$null=Get-OwnedTree $oldRoot}
  $prepared=Inspect-State 'prepare'
  Assert-State-Preserved $before $prepared
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
  $stage='quiesce'; Write-Host ('REFRESH_STAGE='+$stage)
  if($baselineStopped){Assert-StoppedInstallation;$stopped=$true}else{
    $tree=Get-OwnedTree $oldRoot
    $stopped=$true
    Stop-OwnedTree $tree
  }
  $quiescent=Inspect-State 'inspect'
  Assert-State-Preserved $prepared $quiescent
  Assert-StoppedInstallation
  Assert-Approval
  $stage='activate'; Write-Host ('REFRESH_STAGE='+$stage);$switched=$true
  Replace-Bytes $configPath ([Text.Encoding]::UTF8.GetBytes($encoded))
  # PowerShell 5.1 requires UTF8 BOM to preserve existing Unicode path/environment literals.
  Replace-Bytes $launcherPath ([byte[]]([Text.Encoding]::UTF8.GetPreamble()+[Text.Encoding]::UTF8.GetBytes($nextLauncher)))
  Start-ScheduledTask -TaskName $taskName
  $stage='verify'; Write-Host ('REFRESH_STAGE='+$stage)
  $readiness=Wait-Health $revision
  $after=Inspect-State 'inspect'
  Assert-State-Preserved $quiescent $after
  if($after.privateAddressAssigned -isnot [bool] -or
    $after.privateAddressAssigned -ne $readiness.privateIngressReady){throw 'verification'}
  $required=if($readiness.privateIngressReady){$ports}else{@(3000,8787,8790)}
  $null=Get-OwnedTree $releaseRoot $true $required
  if((Export-ScheduledTask -TaskName $taskName) -cne $taskXml){throw 'verification'}
  foreach($key in $readiness.Keys){$receipt[$key]=$readiness[$key]}
  $receipt.runtimeExact=$true;$receipt.identityPreserved=$true;$receipt.schemaPreserved=$true
  $receipt.observedAt=[datetimeoffset]::UtcNow.ToString('o')
  Write-Host 'REFRESH_STAGE=complete'
  $receipt | ConvertTo-Json -Compress
}catch {
  $safeReasons=@('approval','path','owner','private-acl','task','compatibility-launcher','release','manifest','launcher-shape',
    'host','process-owner','listeners','process-replaced','process-permission','ports-busy','source','main-ci','state',
    'immutable-release-exists','archive','archive-extract','toolchain','install','build','baseline-changed','candidate','state-changed',
    'health','verification','rollback-listeners','owner-admin-context','replacement-security','release-security',
    'listener-query','process-query','stopped-installation','private-address-query')
  $failureReason=if($safeReasons -contains $_.Exception.Message){$_.Exception.Message}else{'unexpected-prerequisite-error'}
  if($stopped){
    Write-Host 'REFRESH_STAGE=rollback'
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
      Assert-StoppedInstallation
      if($baselineStopped){
        Assert-StoppedRollback
        $baselineRestored=$true
      }else{
      Start-ScheduledTask -TaskName $taskName
      # Old code lacks runtimeRevision. Require old owned service tree, healthy Broker, unchanged config and task.
      for($i=0;$i -lt 30;$i++){
        try{
          $oldHealth=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
          $null=Get-OwnedTree $oldRoot
          if($oldHealth.ok -eq $true -and (Export-ScheduledTask -TaskName $taskName) -ceq $taskXml -and
            (Same-Bytes $configBytes ([IO.File]::ReadAllBytes($configPath))) -and
            (Same-Bytes $launcherBytes ([IO.File]::ReadAllBytes($launcherPath)))){
            Assert-State-Preserved $before (Inspect-State 'inspect')
            $restored=$true;$baselineRestored=$true;break}
        }catch{}
        Start-Sleep -Seconds 1
      }
      }
    }catch{}
  }
  # Never print exception/config/process/task command lines. Retain current DB and all protected backups.
  @{version=1;issue=1662;nodeId='zbook';phase=$Phase;failedStage=$stage;failureReason=$failureReason;restored=$restored;pointersRestored=$pointersRestored;
    databaseRestored=$false;baselineRestored=$baselineRestored;serviceRecoveryVerified=$restored;knownFailure='PC_RUNTIME_REFRESH_FAILED';observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  exit 1
}finally{$plain=$null;$candidate=$null;$encoded=$null;$secure=$null;$current=$null;$next=$null}
