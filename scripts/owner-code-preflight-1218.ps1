# Fixed read-only acceptance preflight. Never invoke the credential reader or -Apply.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$script:PreflightRoot = Split-Path -Parent $PSScriptRoot
$script:LastSourceArtifact = $null

function Get-1218FileMetadata {
 param([string]$Path, [long]$Limit = 4194304)
 $result = [ordered]@{state='rejected-path';present=$false;sha256=$null;sizeBytes=$null}
 try {
  $windows=[IO.Path]::DirectorySeparatorChar -eq [char]92
  if (-not [IO.Path]::IsPathRooted($Path) -or $Path -match '^[\\/]{2}' -or
      ($windows -and $Path -notmatch '^[A-Za-z]:[\\/]') -or
      ($Path -match ':' -and $Path -notmatch '^[A-Za-z]:[\\/][^:]*$')) { return [pscustomobject]$result }
  $full=[IO.Path]::GetFullPath($Path)
  $root=[IO.Path]::GetPathRoot($full)
  if ($windows -and ($full -notmatch '^[A-Za-z]:\\' -or
      ([IO.DriveInfo]::new($root)).DriveType -ne [IO.DriveType]::Fixed)) { return [pscustomobject]$result }
  # Inspect every ancestor before descending; Test-Path on the full child could follow a network junction.
  $current=$root
  $parts=@($full.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar) | Where-Object { $_.Length -gt 0 })
  $item=Get-Item -LiteralPath $root -Force
  foreach ($part in $parts) {
   if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $result.state='reparse'; return [pscustomobject]$result }
   $current=Join-Path $current $part
   try { $item=Get-Item -LiteralPath $current -Force } catch {
    $result.state=if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) { 'missing' } else { 'unreadable' }
    return [pscustomobject]$result
   }
  }
  $result.present=$true
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $result.state='reparse'; return [pscustomobject]$result }
  if ($item -isnot [IO.FileInfo]) { $result.state='not-regular'; return [pscustomobject]$result }
  if ($item.Length -gt $Limit) { $result.state='oversize'; return [pscustomobject]$result }
  $result.state='regular'; $result.sizeBytes=$item.Length
  $result.sha256=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
 } catch { $result.state='unreadable' }
 return [pscustomobject]$result
}

function Get-1218ReviewedArtifacts {
 param([string]$Root)
 $pins=[ordered]@{
  'owner-code-windows.ps1'='e8f0fe68f5ca8c6d8f5056299c1e805e05663d6782e744a69692ee5512262f43'
  'read-jarvis-production-config.ps1'='252f057b933ddd16c8eec85507fd43b084cf9f0cdba1ded93746ad5e199cccb5'
  'rotate-jarvis-owner-code-windows.ps1'='3e8b032e408b7c41add4b4cbb8e34bf69eef31846e4c43e81c6252c1e6de0c00'
 }
 $artifacts=@()
 foreach ($name in $pins.Keys) {
  $file=Join-Path (Join-Path $Root 'scripts') $name
  $script:LastSourceArtifact=@{name=$name;state='unobserved';sha256=$null;expectedSha256=$pins[$name]}
  $meta=Get-1218FileMetadata $file -Limit 262144
  $script:LastSourceArtifact.state=$meta.state; $script:LastSourceArtifact.sha256=$meta.sha256
  if ($meta.state -ne 'regular' -or $meta.sha256 -cne $pins[$name]) { throw 'UNREVIEWED_SOURCE' }
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
  if (@($errors).Count -ne 0) { throw 'SOURCE_PARSE_FAILED' }
  $artifacts+=@{name=$name;sha256=$meta.sha256;astErrorCount=0;parameters=@($ast.ParamBlock.Parameters | ForEach-Object {$_.Name.VariablePath.UserPath})}
 }
 return $artifacts
}

function Invoke-1218PlanOnly {
 param([string]$Root)
 Get-1218ReviewedArtifacts $Root | Out-Null
 $rotation=Join-Path (Join-Path $Root 'scripts') 'rotate-jarvis-owner-code-windows.ps1'
 $binary=(Get-Process -Id $PID).Path
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$binary
 $info.Arguments='-NoLogo -NoProfile -NonInteractive -File "'+$rotation+'"'
 $info.UseShellExecute=$false; $info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
 $process=New-Object Diagnostics.Process
 $process.StartInfo=$info
 try {
  if (-not $process.Start()) { throw 'PLAN_START_FAILED' }
  $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(15000)) { $process.Kill(); $null=$process.WaitForExit(2000); throw 'PLAN_TIMEOUT' }
  $expected='PLAN ONLY: Owner-local credential rotation requires a separate, unexpired issue:1218 approval receipt. No credential or task was changed.'
  $matched=$process.ExitCode -eq 0 -and $stdout.Result.Trim() -ceq $expected -and $stderr.Result.Trim().Length -eq 0
  return [pscustomobject]@{exitCode=$process.ExitCode;noArguments=$true;expectedOutputMatched=$matched}
 } finally { if (-not $process.HasExited) { $process.Kill(); $null=$process.WaitForExit(2000) }; $process.Dispose() }
}

function New-1218FailureReport {
 param([string]$Stage, [string]$ReasonCode, [int]$FailureLine=0)
 if ($Stage -notin @('platform','source-artifacts','identity','configuration-metadata','installed-artifacts','prior-workspace-artifacts','plan-only')) { $Stage='unknown' }
 if ($ReasonCode -notin @('WINDOWS_REQUIRED','UNREVIEWED_SOURCE','SOURCE_PARSE_FAILED','PLAN_START_FAILED','PLAN_TIMEOUT')) { $ReasonCode='PREFLIGHT_RUNTIME_ERROR' }
 return @{schemaVersion=1;issue=1218;readOnly=$true;complete=$false;failedStage=$Stage;reasonCode=$ReasonCode;failureLine=$FailureLine;languageMode=[string]$ExecutionContext.SessionState.LanguageMode;sourceArtifact=$script:LastSourceArtifact;actualDpapiUsed=$false;secretDisplayed=$false;clipboardAccessed=$false;credentialGenerated=$false;serviceOrTaskMutation=$false;databaseOpened=$false;originalAcceptanceConditionsPassed=0}
}

function Invoke-1218NativePreflight {
 $stage='platform'
 try {
  if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
  $stage='source-artifacts'
  $artifacts=@(Get-1218ReviewedArtifacts $script:PreflightRoot)
  $stage='identity'
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $sid=$identity.User.Value
  $stage='configuration-metadata'
  $config=$env:JARVIS_PRODUCTION_CONFIG; $origin='environment-override'
  if (-not $config) {
   $config=Join-Path $env:USERPROFILE 'JARVIS\production\config.dpapi'; $origin='owner-profile'
   if ((Get-1218FileMetadata $config).state -eq 'missing') { $config=Join-Path $env:LOCALAPPDATA 'JARVIS\production\config.dpapi'; $origin='legacy-localappdata' }
  }
  $meta=Get-1218FileMetadata $config
  $configOwner=$null
  if ($meta.state -eq 'regular') { try { $acl=Get-Acl -LiteralPath $config; $configOwner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value } catch {} }
  $stage='installed-artifacts'
  $installed=@(); $taskReadable=$false
  try {
   $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host' -ErrorAction Stop
   $actions=@($task.Actions)
   if ($actions.Count -eq 1 -and $actions[0].WorkingDirectory) {
    $root=[string]$actions[0].WorkingDirectory; $taskReadable=$true
    foreach ($source in $artifacts) { $installedMeta=Get-1218FileMetadata (Join-Path (Join-Path $root 'scripts') $source.name) -Limit 262144; $installed+=@{name=$source.name;state=$installedMeta.state;sha256=$installedMeta.sha256;matchesReviewedSource=($installedMeta.state -eq 'regular' -and $installedMeta.sha256 -ceq $source.sha256)} }
   }
  } catch {}
  $stage='prior-workspace-artifacts'
  $priorWorkspace=@()
  if ($env:GITHUB_WORKSPACE -and $env:GITHUB_WORKSPACE -ne $script:PreflightRoot) {
   foreach ($source in $artifacts) {
    $prior=Get-1218FileMetadata (Join-Path (Join-Path $env:GITHUB_WORKSPACE 'scripts') $source.name) -Limit 262144
    $priorWorkspace+=@{name=$source.name;state=$prior.state;sha256=$prior.sha256;matchesReviewedSource=($prior.state -eq 'regular' -and $prior.sha256 -ceq $source.sha256)}
   }
  }
  $stage='plan-only'
  $plan=Invoke-1218PlanOnly $script:PreflightRoot
  $revision=$env:GITHUB_SHA
  if ($revision -notmatch '^[a-f0-9]{40}$') { $revision=$null }
  [ordered]@{schemaVersion=1;issue=1218;sourceRevision=$revision;readOnly=$true;complete=[bool]$plan.expectedOutputMatched;languageMode=[string]$ExecutionContext.SessionState.LanguageMode;priorWorkspaceArtifacts=$priorWorkspace;actualWindowsSid=$sid;isSystem=$identity.IsSystem;processSessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;environmentUserInteractive=[Environment]::UserInteractive;desktopInputControl='UNVERIFIED';sourceArtifacts=$artifacts;installedArtifacts=$installed;installedTaskReadable=$taskReadable;encryptedConfiguration=@{origin=$origin;state=$meta.state;sha256=$meta.sha256;ownerSid=$configOwner;ownerIsExecutingUser=($null -ne $configOwner -and $configOwner -ceq $sid)};rotationPlan=$plan;actualDpapiUsed=$false;secretDisplayed=$false;clipboardAccessed=$false;credentialGenerated=$false;serviceOrTaskMutation=$false;databaseOpened=$false;originalAcceptanceConditionsPassed=0} | ConvertTo-Json -Depth 8 -Compress
  if (-not $plan.expectedOutputMatched) { exit 1 }
 } catch { New-1218FailureReport -Stage $stage -ReasonCode ([string]$_.Exception.Message) -FailureLine ([int]$_.InvocationInfo.ScriptLineNumber) | ConvertTo-Json -Depth 8 -Compress; exit 1 }
}
if ($MyInvocation.InvocationName -ne '.') { Invoke-1218NativePreflight }
