param([switch]$OwnerApproved,[Parameter(Mandatory=$true)][string]$SourceRevision,
  [Parameter(Mandatory=$true)][string]$ExpectedProbeSha256)
# Manual same-Owner read-only probe. Never self-elevate or change permissions.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$stage='approval'
$deadline=[datetimeoffset]::UtcNow.AddMinutes(5)
function Assert-ProbeTime {
  if([datetimeoffset]::UtcNow -ge [datetimeoffset]::Parse('2026-10-02T11:18:17Z') -or [datetimeoffset]::UtcNow -ge $deadline){throw 'SCOPE_EXPIRED'}
}
function Same-Instance($left,$right) {
  return ($null -ne $left -and $null -ne $right -and $null -ne $left.CreationDate -and $null -ne $right.CreationDate -and
    $left.ProcessId -eq $right.ProcessId -and $left.Name -ieq $right.Name -and $left.CreationDate -eq $right.CreationDate)
}
function Sid-Value($value) {
  if([string]$value -match '^S-1-'){return ([Security.Principal.SecurityIdentifier][string]$value).Value}
  return ([Security.Principal.NTAccount][string]$value).Translate([Security.Principal.SecurityIdentifier]).Value
}
try {
  if(-not $OwnerApproved){throw 'OWNER_APPROVAL_REQUIRED'}
  Assert-ProbeTime
  if($ExpectedProbeSha256 -notmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedProbeSha256){throw 'PROBE_ARTIFACT_REJECTED'}
  if($env:OS -ne 'Windows_NT' -or $SourceRevision -notmatch '^[a-f0-9]{40}$'){throw 'SOURCE_REJECTED'}
  $stage='same-owner'
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($identity)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'OWNER_ADMIN_CONTEXT_REQUIRED'}
  $production=Join-Path $env:USERPROFILE 'JARVIS\production'
  if((Get-Item -LiteralPath (Join-Path $env:USERPROFILE 'JARVIS')).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'OWNER_BOUNDARY_REJECTED'}
  $directory=Get-Item -LiteralPath $production
  if($directory.Attributes -band [IO.FileAttributes]::ReparsePoint -or
    (Sid-Value (Get-Acl -LiteralPath $production).Owner) -ne $identity.User.Value){throw 'OWNER_BOUNDARY_REJECTED'}
  $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host'
  if((Sid-Value $task.Principal.UserId) -ne $identity.User.Value -or $task.Principal.RunLevel -ne 'Limited' -or
    $task.Principal.LogonType -ne 'Password' -or $task.Actions.Count -ne 1 -or $task.State -ne 'Running'){throw 'TASK_BOUNDARY_REJECTED'}
  $stage='source'
  $main=Invoke-RestMethod -Uri 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main' -TimeoutSec 15
  $runs=Invoke-RestMethod -Uri ('https://api.github.com/repos/haji84/AI-/actions/runs?head_sha='+$SourceRevision+'&per_page=100') -TimeoutSec 15
  if($main.object.sha -ne $SourceRevision -or -not @($runs.workflow_runs | Where-Object {
    $_.name -eq 'CI' -and $_.event -eq 'push' -and $_.head_branch -eq 'main' -and $_.head_sha -eq $SourceRevision -and
    $_.status -eq 'completed' -and $_.conclusion -eq 'success'}).Count){throw 'EXACT_MAIN_CI_REQUIRED'}
  $previousRevision='ff761733c66f60a49e8c25c5ab0450a7a5e679c5'
  $root=Join-Path $env:USERPROFILE ('JARVIS\releases\'+$previousRevision)
  if((Get-Item -LiteralPath (Join-Path $env:USERPROFILE 'JARVIS\releases')).Attributes -band [IO.FileAttributes]::ReparsePoint -or
    (Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint -or
    (Sid-Value (Get-Acl -LiteralPath $root).Owner) -ne $identity.User.Value){throw 'OWNER_BOUNDARY_REJECTED'}
  $manifest=Get-Content -LiteralPath (Join-Path $root 'jarvis-release.json') -Raw | ConvertFrom-Json
  if($manifest.commit -ne $previousRevision){throw 'OLD_RELEASE_REJECTED'}
  $stage='process-observation'
  # Inventory only public process relations; retrieve commands only for bounded
  # service-related Node instances. Retain flags only after instance/Owner rechecks.
  $all=@(Get-CimInstance Win32_Process -Property Name,ProcessId,ParentProcessId,CreationDate -OperationTimeoutSec 10)
  $ports=@(3000,8787,8790,8792)
  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)
  $ids=@(); $truncated=$false
  foreach($listener in $listeners){
    $ancestorId=[int]$listener.OwningProcess; $seen=@()
    for($i=0;$i -lt 16;$i++){
      if($ancestorId -eq 0 -or $seen -contains $ancestorId){break}
      $seen+=$ancestorId
      $entry=@($all | Where-Object {[int]$_.ProcessId -eq $ancestorId})
      if($entry.Count -ne 1){break}
      if($entry[0].Name -ieq 'node.exe' -and $ids -notcontains $ancestorId){$ids+=$ancestorId}
      $ancestorId=[int]$entry[0].ParentProcessId
    }
    if($i -eq 16){$truncated=$true}
  }
  if($ids.Count -gt 32){$truncated=$true}
  $facts=@()
  foreach($processId in @($ids | Select-Object -First 32)){
    Assert-ProbeTime
    $original=@($all | Where-Object {[int]$_.ProcessId -eq $processId})[0]
    $entry=Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId) -Property Name,ProcessId,CreationDate -OperationTimeoutSec 10
    $ownerClass='unavailable'; $queryClass='instance-replaced'; $command=$null
    $instanceStable=Same-Instance $original $entry
    if($instanceStable){
      $owner=Invoke-CimMethod -InputObject $entry -MethodName GetOwnerSid -OperationTimeoutSec 10
      $queryClass=switch([int]$owner.ReturnValue){0 {'success'} 2 {'access-denied'} 3 {'insufficient-privilege'} default {'unavailable'}}
      if($owner.ReturnValue -eq 0){
        $ownerClass=if($owner.Sid -eq $identity.User.Value){'current-user'}else{'other'}
        if($ownerClass -eq 'current-user'){
          Assert-ProbeTime
          $withCommand=Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId) -Property Name,ProcessId,CreationDate,CommandLine -OperationTimeoutSec 10
          $instanceStable=Same-Instance $original $withCommand
          if($instanceStable){
            $checkedOwner=Invoke-CimMethod -InputObject $withCommand -MethodName GetOwnerSid -OperationTimeoutSec 10
            $after=Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId) -Property Name,ProcessId,CreationDate -OperationTimeoutSec 10
            $instanceStable=(Same-Instance $original $after) -and $checkedOwner.ReturnValue -eq 0 -and $checkedOwner.Sid -eq $identity.User.Value
          }
          if($instanceStable){$command=$withCommand.CommandLine}else{$ownerClass='unavailable';$queryClass='instance-replaced'}
        }
      }
    }
    $direct=@($listeners | Where-Object {[int]$_.OwningProcess -eq $processId} | Select-Object -ExpandProperty LocalPort -Unique)
    $facts+=@{instanceStable=$instanceStable;ownerClass=$ownerClass;ownerQueryClass=$queryClass;commandLineAvailable=[bool]$command;
      configuredRootExact=[bool]($command -and $command.Contains($root));
      configuredRootIgnoreCase=[bool]($command -and $command.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0);
      hostEntrypointObserved=[bool]($command -and $command.IndexOf('jarvis-remote-host.mjs',[StringComparison]::OrdinalIgnoreCase) -ge 0);
      directListenerPortCount=$direct.Count}
  }
  Assert-ProbeTime
  @{version=1;issue=1662;goalIssue=1219;nodeId='zbook';readOnly=$true;administratorRoleActive=$true;
    sourceRevision=$SourceRevision;previousRevision=$previousRevision;exactMainCi=$true;taskOwnerMatches=$true;
    candidatesTruncated=$truncated;listenerPortCount=@($listeners | Select-Object -ExpandProperty LocalPort -Unique).Count;
    serviceNodeCandidates=$facts;observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 6 -Compress
}catch{
  $known=@('OWNER_APPROVAL_REQUIRED','SCOPE_EXPIRED','SOURCE_REJECTED','OWNER_ADMIN_CONTEXT_REQUIRED',
    'OWNER_BOUNDARY_REJECTED','TASK_BOUNDARY_REJECTED','EXACT_MAIN_CI_REQUIRED','OLD_RELEASE_REJECTED','PROBE_ARTIFACT_REJECTED')
  $reason=if($_.Exception.Message -in $known){$_.Exception.Message}else{'READONLY_PROBE_FAILED'}
  @{version=1;issue=1662;nodeId='zbook';readOnly=$true;failedStage=$stage;failureReason=$reason;
    observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  exit 1
}
