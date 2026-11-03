param([switch]$OwnerApproved,[Parameter(Mandatory=$true)][string]$SourceRevision,
  [Parameter(Mandatory=$true)][string]$ExpectedProbeSha256,[switch]$ReadOnlyWorker)
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
function ConvertTo-ProbePublicJson([string]$Line) {
  try {
    $public=$Line | ConvertFrom-Json
    $base=@('version','issue','nodeId','readOnly','observedAt')
    $failure=@('failedStage','failureReason')
    $success=@('goalIssue','administratorRoleActive','sourceRevision','previousRevision','exactMainCi','taskOwnerMatches','candidatesTruncated','listenerPortCount','serviceNodeCandidates')
    $names=@($public.PSObject.Properties.Name)
    $required=if($names -contains 'failureReason'){$base+$failure}else{$base+$success}
    if($names.Count -ne $required.Count){throw 'schema'}
    foreach($key in $required){if($names -notcontains $key){throw 'schema'}}
    if(($public.version -isnot [int] -and $public.version -isnot [long]) -or $public.version -ne 1 -or ($public.issue -isnot [int] -and $public.issue -isnot [long]) -or $public.issue -ne 1662 -or
      $public.nodeId -isnot [string] -or $public.nodeId -ne 'zbook' -or $public.readOnly -isnot [bool] -or -not $public.readOnly -or
      ($public.observedAt -isnot [string] -and $public.observedAt -isnot [datetime])){throw 'schema'}
    if($public.observedAt -is [string] -and $public.observedAt -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$'){throw 'schema'}
    $stamp=if($public.observedAt -is [datetime]){[datetimeoffset]$public.observedAt}else{[datetimeoffset]::Parse($public.observedAt)}
    if($names -contains 'failureReason'){
      $stages=@('approval','startup','same-owner','task','source','old-release','process-inventory','listeners','process-owner','process-command','complete')
      $reasons=@('OWNER_APPROVAL_REQUIRED','SCOPE_EXPIRED','SOURCE_REJECTED','OWNER_ADMIN_CONTEXT_REQUIRED','OWNER_BOUNDARY_REJECTED',
        'TASK_BOUNDARY_REJECTED','EXACT_MAIN_CI_REQUIRED','OLD_RELEASE_REJECTED','PROBE_ARTIFACT_REJECTED','READONLY_PROBE_FAILED')
      if($public.failedStage -isnot [string] -or $public.failedStage -notin $stages -or
        $public.failureReason -isnot [string] -or $public.failureReason -notin $reasons){throw 'schema'}
    }else{
      if(($public.goalIssue -isnot [int] -and $public.goalIssue -isnot [long]) -or $public.goalIssue -ne 1219 -or $public.sourceRevision -isnot [string] -or
        $public.sourceRevision -notmatch '^[a-f0-9]{40}$' -or $public.previousRevision -isnot [string] -or
        $public.previousRevision -ne 'ff761733c66f60a49e8c25c5ab0450a7a5e679c5'){throw 'schema'}
      foreach($key in @('administratorRoleActive','exactMainCi','taskOwnerMatches','candidatesTruncated')){
        if($public.$key -isnot [bool]){throw 'schema'}
      }
      if(-not $public.administratorRoleActive -or -not $public.exactMainCi -or -not $public.taskOwnerMatches -or
        ($public.listenerPortCount -isnot [int] -and $public.listenerPortCount -isnot [long]) -or $public.listenerPortCount -lt 0 -or $public.listenerPortCount -gt 4 -or
        $public.serviceNodeCandidates -isnot [array] -or $public.serviceNodeCandidates.Count -gt 32){throw 'schema'}
      $candidateKeys=@('instanceStable','ownerClass','ownerQueryClass','commandLineAvailable','configuredRootExact','configuredRootIgnoreCase','hostEntrypointObserved','directListenerPortCount')
      foreach($fact in $public.serviceNodeCandidates){
        $keys=@($fact.PSObject.Properties.Name)
        if($keys.Count -ne $candidateKeys.Count){throw 'schema'}
        foreach($key in $candidateKeys){if($keys -notcontains $key){throw 'schema'}}
        foreach($key in @('instanceStable','commandLineAvailable','configuredRootExact','configuredRootIgnoreCase','hostEntrypointObserved')){
          if($fact.$key -isnot [bool]){throw 'schema'}
        }
        if($fact.ownerClass -isnot [string] -or $fact.ownerClass -notin @('current-user','other','unavailable') -or
          $fact.ownerQueryClass -isnot [string] -or $fact.ownerQueryClass -notin @('success','access-denied','insufficient-privilege','unavailable','instance-replaced') -or
          ($fact.directListenerPortCount -isnot [int] -and $fact.directListenerPortCount -isnot [long]) -or $fact.directListenerPortCount -lt 0 -or $fact.directListenerPortCount -gt 4){throw 'schema'}
      }
    }
    $public.observedAt=$stamp.ToUniversalTime().ToString('o')
    return ($public | ConvertTo-Json -Depth 6 -Compress)
  }catch{throw 'DIAGNOSTIC_OUTPUT_REJECTED'}
}
function Invoke-ProbeChild([Diagnostics.ProcessStartInfo]$StartInfo,[datetimeoffset]$Until) {
  $result=@{TimedOut=$false;ChildStopped=$true;FailedStage='startup';ExitCode=1;Json=$null;FailureReason=$null}
  if([datetimeoffset]::UtcNow -ge $Until){$result.TimedOut=$true;return [pscustomobject]$result}
  $child=New-Object Diagnostics.Process
  $child.StartInfo=$StartInfo
  $started=$false; $total=0
  try {
    $started=$child.Start()
    if(-not $started){throw 'DIAGNOSTIC_START_FAILED'}
    $streams=@{}
    foreach($name in @('stdout','stderr')){
      $reader=if($name -eq 'stdout'){$child.StandardOutput}else{$child.StandardError}
      $characters=New-Object char[] 1024
      $streams[$name]=@{Reader=$reader;Characters=$characters;Text='';Ended=$false;Pending=$reader.ReadAsync($characters,0,1024)}
    }
    while($true){
      if([datetimeoffset]::UtcNow -ge $Until){$result.TimedOut=$true;break}
      foreach($stream in @('stdout','stderr')){
        $state=$streams[$stream]; $pending=$state.Pending
        if($null -ne $pending -and $pending.IsCompleted){
          $count=$pending.GetAwaiter().GetResult()
          $total+=$count
          if($total -gt 16384){throw 'DIAGNOSTIC_OUTPUT_REJECTED'}
          $lines=@()
          if($count -gt 0){$state.Text+=[string]::new($state.Characters,0,$count)}else{$state.Ended=$true}
          while(($newline=$state.Text.IndexOf("`n")) -ge 0){
            $lines+=$state.Text.Substring(0,$newline).TrimEnd([char]13)
            $state.Text=$state.Text.Substring($newline+1)
          }
          if($state.Ended -and $state.Text.Length){$lines+=$state.Text;$state.Text=''}
          foreach($line in $lines){
            # Never relay arbitrary stdout/stderr (including native errors).
            if($stream -eq 'stdout'){
              if($line -match '^PROBE_STAGE=(same-owner|task|source|old-release|process-inventory|listeners|process-owner|process-command|complete)$'){
                $result.FailedStage=$Matches[1]; Write-Host $line
              }elseif($line.StartsWith('{')){
                if($null -ne $result.Json){throw 'DIAGNOSTIC_OUTPUT_REJECTED'}
                $result.Json=ConvertTo-ProbePublicJson $line
              }
            }
          }
          $state.Pending=if($state.Ended){$null}else{$state.Reader.ReadAsync($state.Characters,0,1024)}
        }
      }
      if($child.HasExited -and $streams.stdout.Ended -and $streams.stderr.Ended){
        $result.ExitCode=$child.ExitCode
        if($null -eq $result.Json){$result.FailureReason='PROBE_RECEIPT_MISSING'}
        break
      }
      Start-Sleep -Milliseconds 100
    }
  } finally {
    # Only the exact Process handle created here, never service/PID/tree discovery.
    if($started -and -not $child.HasExited){
      try {$child.Kill()}catch{if(-not $child.HasExited){throw 'DIAGNOSTIC_STOP_UNCONFIRMED'}}
      if(-not $child.WaitForExit(2000)){throw 'DIAGNOSTIC_STOP_UNCONFIRMED'}
    }
    $child.Dispose()
  }
  return [pscustomobject]$result
}
function Probe-Stage([string]$Name){$script:stage=$Name;Write-Output ('PROBE_STAGE='+$Name)}
try {
  if(-not $OwnerApproved){throw 'OWNER_APPROVAL_REQUIRED'}
  Assert-ProbeTime
  if($ExpectedProbeSha256 -notmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedProbeSha256){throw 'PROBE_ARTIFACT_REJECTED'}
  if($env:OS -ne 'Windows_NT' -or $SourceRevision -notmatch '^[a-f0-9]{40}$'){throw 'SOURCE_REJECTED'}
  if(-not $ReadOnlyWorker){
    # The parent can bound a blocked Windows cmdlet; cooperative checks cannot.
    if($PSCommandPath.Contains('"')){throw 'PROBE_ARTIFACT_REJECTED'}
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=Join-Path $PSHOME 'powershell.exe'
    $info.Arguments='-NoProfile -ExecutionPolicy RemoteSigned -File "'+$PSCommandPath+'" -OwnerApproved -ReadOnlyWorker -SourceRevision '+$SourceRevision+' -ExpectedProbeSha256 '+$ExpectedProbeSha256
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $expiry=[datetimeoffset]::Parse('2026-10-02T11:18:17Z')
    if($expiry -lt $deadline){$deadline=$expiry}
    $receipt=Invoke-ProbeChild $info $deadline
    $stage=$receipt.FailedStage
    if($receipt.TimedOut){throw 'PROBE_TIMEOUT'}
    if($receipt.FailureReason){throw $receipt.FailureReason}
    Write-Output $receipt.Json
    exit $receipt.ExitCode
  }
  Probe-Stage 'same-owner'
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($identity)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'OWNER_ADMIN_CONTEXT_REQUIRED'}
  $production=Join-Path $env:USERPROFILE 'JARVIS\production'
  if((Get-Item -LiteralPath (Join-Path $env:USERPROFILE 'JARVIS')).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'OWNER_BOUNDARY_REJECTED'}
  $directory=Get-Item -LiteralPath $production
  if($directory.Attributes -band [IO.FileAttributes]::ReparsePoint -or
    (Sid-Value (Get-Acl -LiteralPath $production).Owner) -ne $identity.User.Value){throw 'OWNER_BOUNDARY_REJECTED'}
  Probe-Stage 'task'
  $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host'
  if((Sid-Value $task.Principal.UserId) -ne $identity.User.Value -or $task.Principal.RunLevel -ne 'Limited' -or
    $task.Principal.LogonType -ne 'Password' -or $task.Actions.Count -ne 1 -or $task.State -ne 'Running'){throw 'TASK_BOUNDARY_REJECTED'}
  Probe-Stage 'source'
  $main=Invoke-RestMethod -Uri 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main' -TimeoutSec 15
  $runs=Invoke-RestMethod -Uri ('https://api.github.com/repos/haji84/AI-/actions/runs?head_sha='+$SourceRevision+'&per_page=100') -TimeoutSec 15
  if($main.object.sha -ne $SourceRevision -or -not @($runs.workflow_runs | Where-Object {
    $_.name -eq 'CI' -and $_.event -eq 'push' -and $_.head_branch -eq 'main' -and $_.head_sha -eq $SourceRevision -and
    $_.status -eq 'completed' -and $_.conclusion -eq 'success'}).Count){throw 'EXACT_MAIN_CI_REQUIRED'}
  Probe-Stage 'old-release'
  $previousRevision='ff761733c66f60a49e8c25c5ab0450a7a5e679c5'
  $root=Join-Path $env:USERPROFILE ('JARVIS\releases\'+$previousRevision)
  if((Get-Item -LiteralPath (Join-Path $env:USERPROFILE 'JARVIS\releases')).Attributes -band [IO.FileAttributes]::ReparsePoint -or
    (Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint -or
    (Sid-Value (Get-Acl -LiteralPath $root).Owner) -ne $identity.User.Value){throw 'OWNER_BOUNDARY_REJECTED'}
  $manifest=Get-Content -LiteralPath (Join-Path $root 'jarvis-release.json') -Raw | ConvertFrom-Json
  if($manifest.commit -ne $previousRevision){throw 'OLD_RELEASE_REJECTED'}
  Probe-Stage 'process-inventory'
  # Inventory only public process relations; retrieve commands only for bounded
  # service-related Node instances. Retain flags only after instance/Owner rechecks.
  $all=@(Get-CimInstance Win32_Process -Property Name,ProcessId,ParentProcessId,CreationDate -OperationTimeoutSec 10)
  $ports=@(3000,8787,8790,8792)
  Probe-Stage 'listeners'
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
    Probe-Stage 'process-owner'
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
          Probe-Stage 'process-command'
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
  Probe-Stage 'complete'
  @{version=1;issue=1662;goalIssue=1219;nodeId='zbook';readOnly=$true;administratorRoleActive=$true;
    sourceRevision=$SourceRevision;previousRevision=$previousRevision;exactMainCi=$true;taskOwnerMatches=$true;
    candidatesTruncated=$truncated;listenerPortCount=@($listeners | Select-Object -ExpandProperty LocalPort -Unique).Count;
    serviceNodeCandidates=$facts;observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 6 -Compress
}catch{
  $known=@('OWNER_APPROVAL_REQUIRED','SCOPE_EXPIRED','SOURCE_REJECTED','OWNER_ADMIN_CONTEXT_REQUIRED',
    'OWNER_BOUNDARY_REJECTED','TASK_BOUNDARY_REJECTED','EXACT_MAIN_CI_REQUIRED','OLD_RELEASE_REJECTED','PROBE_ARTIFACT_REJECTED',
    'PROBE_TIMEOUT','PROBE_RECEIPT_MISSING','DIAGNOSTIC_START_FAILED','DIAGNOSTIC_OUTPUT_REJECTED','DIAGNOSTIC_STOP_UNCONFIRMED')
  $reason=if($_.Exception.Message -in $known){$_.Exception.Message}else{'READONLY_PROBE_FAILED'}
  @{version=1;issue=1662;nodeId='zbook';readOnly=$true;failedStage=$stage;failureReason=$reason;
    observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  exit 1
}
