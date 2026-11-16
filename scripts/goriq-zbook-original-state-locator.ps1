# Metadata only. Never open a state file or decrypt production configuration.
$ErrorActionPreference = 'Stop'
$MaxVolumes = 32
$MaxCandidates = 512
$BudgetSeconds = 45

function Get-GoriqLocationMetadata {
  param([string]$LiteralPath)
  try {
    if ([string]::IsNullOrWhiteSpace($LiteralPath) -or $LiteralPath.Length -gt 2048 -or
        $LiteralPath -match '[\x00-\x1f]' -or $LiteralPath -match '^\\\\' -or
        ($env:OS -eq 'Windows_NT' -and $LiteralPath -notmatch '^[A-Za-z]:\\[^:]*$')) {
      return @{status='UNSAFE_PATH'}
    }
    $full = [IO.Path]::GetFullPath($LiteralPath)
    $root = [IO.Path]::GetPathRoot($full)
    if ($env:OS -eq 'Windows_NT') {
      $drive = [IO.DriveInfo]::new($root)
      if ($drive.DriveType -notin @([IO.DriveType]::Fixed,[IO.DriveType]::Removable)) { return @{status='NONLOCAL_VOLUME'} }
      if (-not $drive.IsReady) { return @{status='NOT_READY'} }
    }
    $parts = @($full.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries))
    $cursor = $root
    # Inspect every ancestor before descending. This is metadata, not a content
    # authorization: a concurrent rename can still invalidate the observation.
    for ($i = -1; $i -lt $parts.Count; $i++) {
      if ($i -ge 0) { $cursor = [IO.Path]::Combine($cursor, $parts[$i]) }
      $attributes = [IO.File]::GetAttributes($cursor)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return @{status='REPARSE_REFUSED'} }
      $directory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
      if ($i -lt ($parts.Count - 1) -and -not $directory) { return @{status='NOT_DIRECTORY'} }
    }
    if ($directory) { return @{status='DIRECTORY'} }
    $info = [IO.FileInfo]::new($full)
    return @{status='FILE';bytes=$info.Length}
  } catch {
    $errorType = $_.Exception
    while ($errorType.InnerException) { $errorType = $errorType.InnerException }
    if ($errorType -is [UnauthorizedAccessException] -or $errorType -is [Security.SecurityException]) { return @{status='INACCESSIBLE'} }
    if ($errorType -is [IO.FileNotFoundException] -or $errorType -is [IO.DirectoryNotFoundException]) { return @{status='MISSING'} }
    return @{status='UNKNOWN'}
  }
}

function New-GoriqOriginalLocationCandidates {
  param([string]$ProfilePath, [string]$CheckoutPath, [string]$TaskWorkingDirectory,
        [string]$LocalAppData, [string[]]$DriveRoots)
  $roots = [Collections.Generic.List[object]]::new()
  $roots.Add(@{label='profile';path=$ProfilePath})
  $roots.Add(@{label='checkout';path=$CheckoutPath})
  foreach ($suffix in @('JARVIS','JARVIS-AI-')) {
    if ($ProfilePath) { $roots.Add(@{label=('profile-'+$suffix.ToLowerInvariant());path=[IO.Path]::Combine($ProfilePath,$suffix)}) }
  }
  if ($ProfilePath) { $roots.Add(@{label='profile-production';path=[IO.Path]::Combine($ProfilePath,'JARVIS','production')}) }
  if ($TaskWorkingDirectory) {
    $roots.Add(@{label='task-working-directory';path=$TaskWorkingDirectory})
    try { $roots.Add(@{label='task-parent';path=[IO.Path]::GetDirectoryName($TaskWorkingDirectory.TrimEnd('\','/'))}) } catch { }
  }
  if ($LocalAppData) {
    $roots.Add(@{label='local-bridge-state';path=[IO.Path]::Combine($LocalAppData,'GAIWorker','goal-1218-bridge-state')})
    $roots.Add(@{label='local-bridge-workspace';path=[IO.Path]::Combine($LocalAppData,'GAIWorker','goal-1218-workspace')})
  }
  $number = 0
  foreach ($drive in @($DriveRoots | Select-Object -First $MaxVolumes)) {
    $number++
    if ([string]::IsNullOrWhiteSpace($drive)) { continue }
    foreach ($suffix in @('GORIQ','JARVIS','JARVIS-AI-','AI-','.goriq','.goriq-handoff','workspace')) {
      $roots.Add(@{label=('volume-{0:d2}-{1}' -f $number,$suffix.Replace('.','hidden-').ToLowerInvariant());path=[IO.Path]::Combine($drive,$suffix)})
    }
  }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $rows = [Collections.Generic.List[object]]::new()
  $leaves = @(
    @('compass-default','.jarvis','compass.db'),
    @('compass-standalone','.compass','compass.db'),
    @('compass-configured-default','.jarvis','jarvis.db.compass.sqlite'),
    @('persistent-compass','.goriq','state','compass.db'),
    @('persistent-configured-compass','.goriq','state','jarvis.db.compass.sqlite'),
    @('persistent-jobs','.goriq','state','self-development','jobs.json'),
    @('persistent-changes','.goriq','state','self-development','change-sets.json'),
    @('state-compass','state','compass.db'),
    @('state-configured-compass','state','jarvis.db.compass.sqlite'),
    @('bridge-compass','compass.sqlite'),
    @('compass-adjacent','compass.db'),
    @('compass-configured-adjacent','jarvis.db.compass.sqlite'),
    @('jobs','self-development','jobs.json'),
    @('changes','self-development','change-sets.json'),
    @('default-jobs','.jarvis','self-development','jobs.json'),
    @('default-changes','.jarvis','self-development','change-sets.json'),
    @('standalone-jobs','.compass','self-development','jobs.json'),
    @('standalone-changes','.compass','self-development','change-sets.json'),
    @('backup-catalog','jarvis.db.state-backups'),
    @('nov3-retention','.goriq-handoff','1219-20261103')
    @('nov3-retention-adjacent','1219-20261103')
  )
  # Visit every fixed root before expanding leaves: a later attached disk must
  # not disappear behind the candidate cap consumed by an earlier disk.
  foreach ($entry in $roots) {
    if ([string]::IsNullOrWhiteSpace($entry.path)) { continue }
    if ($seen.Add($entry.path)) { $rows.Add($entry) }
  }
  foreach ($leaf in $leaves) {
    foreach ($entry in $roots) {
      if ([string]::IsNullOrWhiteSpace($entry.path)) { continue }
      $p = $entry.path
      for ($i=1; $i -lt $leaf.Count; $i++) { $p = [IO.Path]::Combine($p,$leaf[$i]) }
      if ($rows.Count -ge $MaxCandidates) { return $rows.ToArray() }
      if ($seen.Add($p)) { $rows.Add(@{label=($entry.label+'-'+$leaf[0]);path=$p}) }
    }
  }
  return $rows.ToArray()
}

function New-GoriqOriginalLocationReport {
  param([object[]]$Volumes, [object[]]$Candidates, [string]$SourceRevision, [string]$RunId)
  $started = [Diagnostics.Stopwatch]::StartNew()
  $rows = [Collections.Generic.List[object]]::new()
  foreach ($candidate in @($Candidates | Select-Object -First $MaxCandidates)) {
    if ($started.Elapsed.TotalSeconds -ge $BudgetSeconds) { break }
    $metadata = Get-GoriqLocationMetadata -LiteralPath $candidate.path
    $row = [ordered]@{label=$candidate.label;status=$metadata.status}
    if ($metadata.status -eq 'FILE') { $row.bytes=$metadata.bytes }
    $rows.Add($row)
  }
  $volumeRows = @($Volumes | Select-Object -First $MaxVolumes | ForEach-Object {
    @{id=$_.id;driveLetter=$(if ($_.driveLetter -cmatch '^[A-Z]$') {$_.driveLetter} else {'UNKNOWN'});driveType=$_.driveType;ready=$_.ready;mediaType='UNKNOWN'}
  })
  return [ordered]@{
    version=1;mode='ORIGINAL_LOCATION_METADATA_ONLY';readOnly=$true;contentsRead=$false
    goalId='goal-fcc81c97e09153f7';jobId='rotation-recovery-37'
    sourceRevision=$SourceRevision;runId=$RunId;checkedAt=[DateTime]::UtcNow.ToString('o')
    originalGoalRecovered=$false;originalMatch='NOT_INSPECTED';originalAbsent='NOT_ESTABLISHED'
    configuredProductionPath='UNAVAILABLE_WITHOUT_DECRYPTION'
    coverage='READY_LOCAL_DRIVE_LETTERS_AND_FIXED_KNOWN_PATHS_ONLY'
    directoryMountedVolumes='NOT_ENUMERATED';recursiveSearch=$false
    maxVolumes=$MaxVolumes;maxCandidates=$MaxCandidates;budgetSeconds=$BudgetSeconds
    budgetScope='CANDIDATE_METADATA';hardJobTimeoutMinutes=5
    candidateLimitReached=($Candidates.Count -ge $MaxCandidates);volumeLimitReached=($Volumes.Count -ge $MaxVolumes)
    status=$(if ($rows.Count -lt $Candidates.Count) {'BUDGET_EXHAUSTED'} elseif ($Candidates.Count -ge $MaxCandidates -or $Volumes.Count -ge $MaxVolumes) {'LIMIT_REACHED'} else {'METADATA_ONLY_COMPLETE'})
    volumes=$volumeRows;candidates=$rows.ToArray()
  }
}

function Invoke-GoriqOriginalLocationInspection {
  if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_REPOSITORY -ne 'haji84/AI-' -or
      $env:GITHUB_ACTOR -ne 'haji84' -or $env:GITHUB_EVENT_NAME -ne 'workflow_dispatch' -or
      $env:GITHUB_REF -ne 'refs/heads/main' -or $env:RUNNER_NAME -ne 'ZBook' -or
      $env:GITHUB_SHA -notmatch '^[a-f0-9]{40}$' -or $env:GITHUB_RUN_ID -notmatch '^\d+$') {
    throw 'ORIGINAL_LOCATION_CONTEXT_REFUSED'
  }
  # A workflow/source CI gate precedes this call. No script parameters or
  # arbitrary pathname/command inputs are accepted by the entry point.
  $env:PSModulePath = [IO.Path]::Combine($PSHOME,'Modules')
  $taskDirectory = ''
  try {
    $task = ScheduledTasks\Get-ScheduledTask -TaskName 'JARVIS Remote Host' -ErrorAction Stop
    if ($task.Actions.Count -gt 0) { $taskDirectory = [string]$task.Actions[0].WorkingDirectory }
  } catch { }
  $volumes = [Collections.Generic.List[object]]::new()
  $driveRoots = [Collections.Generic.List[string]]::new()
  foreach ($drive in @([IO.DriveInfo]::GetDrives() | Sort-Object Name)) {
    if ($volumes.Count -ge $MaxVolumes) { break }
    # Exclude network/CD/unknown drives before querying readiness.
    if ($drive.DriveType -notin @([IO.DriveType]::Fixed,[IO.DriveType]::Removable)) { continue }
    $ready = $false
    try { $ready = $drive.IsReady } catch { }
    $id = 'volume-{0:d2}' -f ($volumes.Count+1)
    $volumes.Add(@{id=$id;driveLetter=$drive.Name.Substring(0,1).ToUpperInvariant();driveType=[string]$drive.DriveType;ready=$ready})
    if ($ready) { $driveRoots.Add($drive.RootDirectory.FullName) } else { $driveRoots.Add('') }
  }
  $candidates = @(New-GoriqOriginalLocationCandidates -ProfilePath $env:USERPROFILE -CheckoutPath (Get-Location).Path -TaskWorkingDirectory $taskDirectory -LocalAppData $env:LOCALAPPDATA -DriveRoots $driveRoots.ToArray())
  New-GoriqOriginalLocationReport -Volumes $volumes.ToArray() -Candidates $candidates -SourceRevision $env:GITHUB_SHA -RunId $env:GITHUB_RUN_ID | ConvertTo-Json -Depth 12 -Compress
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-GoriqOriginalLocationInspection }
