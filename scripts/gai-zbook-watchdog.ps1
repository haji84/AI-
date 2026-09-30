param(
  [string]$RunnerRoot = 'C:\actions-runner',
  [string]$OllamaEndpoint = 'http://127.0.0.1:11434'
)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'GAIWorker'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$logPath = Join-Path $stateRoot 'zbook-watchdog.log'
$runnerHealthStatePath = Join-Path $stateRoot 'zbook-runner-health.json'
$runnerFailureThreshold = if ($env:GAI_RUNNER_FAILURE_THRESHOLD -match '^\d+$') { [int]$env:GAI_RUNNER_FAILURE_THRESHOLD } else { 2 }
$runnerSessionConflictGraceMinutes = if ($env:GAI_RUNNER_SESSION_CONFLICT_GRACE_MINUTES -match '^\d+$') { [Math]::Min([Math]::Max([int]$env:GAI_RUNNER_SESSION_CONFLICT_GRACE_MINUTES, 2), 30) } else { 10 }
$runnerSessionConflictStatePath = Join-Path $stateRoot 'zbook-runner-session-conflict.epoch'
$watchdogScriptPath = $PSCommandPath

function Write-GaiLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $logPath -Value $line
  Write-Host $line
}

function Ensure-HiddenScheduledTaskHost {
  $ps = (Get-Command powershell.exe).Source
  $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
  if (-not $watchdogScriptPath -or -not (Test-Path $wscript)) { return }

  $watchdogCommand = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -File `"$watchdogScriptPath`" -RunnerRoot `"$RunnerRoot`" -OllamaEndpoint `"$OllamaEndpoint`""
  $escapedWatchdogCommand = $watchdogCommand.Replace('"', '""')
  $launcherVbs = Join-Path $stateRoot 'gai-zbook-watchdog-launcher.vbs'
  $launcherContent = @(
    'Option Explicit',
    'Dim shell',
    'Set shell = CreateObject("WScript.Shell")',
    ('shell.Run "{0}", 0, False' -f $escapedWatchdogCommand)
  ) -join "`r`n"
  Set-Content -Path $launcherVbs -Value $launcherContent -Encoding Unicode
  $taskCommand = "`"$wscript`" //B //NoLogo `"$launcherVbs`""

  foreach ($taskName in @('GAI-ZBook-Runner-OnLogon', 'GAI-ZBook-Watchdog')) {
    try {
      $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      if (-not $task -or -not $task.Actions) { continue }
      $action = $task.Actions | Select-Object -First 1
      $alreadyHidden = ([string]$action.Execute -ieq $wscript) -and
        ([string]$action.Arguments -match '//B') -and
        ([string]$action.Arguments -match '//NoLogo')
      if ($alreadyHidden) { continue }

      $changeOutput = & schtasks.exe /Change /TN $taskName /TR $taskCommand 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-GaiLog "Migrated scheduled task $taskName to the hidden WScript launcher."
      } else {
        Write-GaiLog "Unable to migrate scheduled task ${taskName}: $($changeOutput -join ' ')"
      }
    } catch {
      Write-GaiLog "Scheduled task migration check failed for ${taskName}: $($_.Exception.Message)"
    }
  }
}

Ensure-HiddenScheduledTaskHost

function Get-ConsecutiveRunnerFailures {
  if (-not (Test-Path $runnerHealthStatePath)) { return 0 }
  try {
    $state = Get-Content -Raw -Path $runnerHealthStatePath | ConvertFrom-Json
    if ($null -ne $state.consecutiveFailures) {
      return [int]$state.consecutiveFailures
    }
  } catch {
    Write-GaiLog "Runner health state unreadable; resetting failure count: $($_.Exception.Message)"
  }
  return 0
}

function Set-ConsecutiveRunnerFailures([int]$Count) {
  [ordered]@{
    consecutiveFailures = $Count
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 $runnerHealthStatePath
}

function Test-OllamaApi {
  try {
    Invoke-RestMethod -Uri "$OllamaEndpoint/api/tags" -Method Get -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Resolve-OllamaExe {
  $cmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
  )
  return ($candidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
}

function Get-LatestRunnerLog {
  $diagRoot = Join-Path $RunnerRoot '_diag'
  return Get-ChildItem -Path $diagRoot -Filter 'Runner_*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
}

function Test-LatestRunnerSessionConflict {
  $latestLog = Get-LatestRunnerLog
  if (-not $latestLog) { return $false }

  try {
    $tail = @(Get-Content -Path $latestLog.FullName -Tail 160 -ErrorAction Stop)
    $lastConflict = -1
    $lastReady = -1
    for ($i = 0; $i -lt $tail.Count; $i++) {
      if ($tail[$i] -match 'TaskAgentSessionConflictException|A session for this runner already exists|HTTP Status:\s*Conflict') {
        $lastConflict = $i
      }
      if ($tail[$i] -match 'Listening for Jobs|Session created') {
        $lastReady = $i
      }
    }
    return $lastConflict -gt $lastReady
  } catch {
    Write-GaiLog "Runner session-conflict probe unavailable: $($_.Exception.Message)"
    return $false
  }
}

function Test-RunnerSessionConflictGrace {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $since = 0
  if (Test-Path $runnerSessionConflictStatePath) {
    try {
      $rawSince = (Get-Content -Raw -Path $runnerSessionConflictStatePath).Trim()
      if ($rawSince -match '^\d+$') { $since = [long]$rawSince }
    } catch {
      $since = 0
    }
  }

  $latestLog = Get-LatestRunnerLog
  $recentConflict = $false
  if ($latestLog -and (Test-LatestRunnerSessionConflict)) {
    $recentConflict = $latestLog.LastWriteTimeUtc -gt (Get-Date).ToUniversalTime().AddMinutes(-2)
  }

  if ($recentConflict -and $since -le 0) {
    $since = $now
    Set-Content -Path $runnerSessionConflictStatePath -Value ([string]$since) -Encoding ASCII
  }

  if ($since -gt 0) {
    if (($now - $since) -lt ($runnerSessionConflictGraceMinutes * 60)) {
      return $true
    }
    # Keep the expired marker until a real healthy session clears it so fresh
    # 409 log writes cannot re-arm another full cooldown.
    return $false
  }

  return $false
}

function Test-RunnerConnection {
  $listeners = @(Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return $false }

  if (Test-LatestRunnerSessionConflict) { return $false }

  # A healthy self-hosted listener maintains at least one established outbound
  # connection to GitHub's runner service. Merely seeing Runner.Listener is not
  # sufficient because a stale/disconnected process can survive indefinitely.
  try {
    foreach ($listener in $listeners) {
      $connections = @(Get-NetTCPConnection -OwningProcess $listener.Id -State Established -ErrorAction Stop)
      if ($connections.Count -gt 0) { return $true }
    }
  } catch {
    Write-GaiLog "TCP health probe unavailable: $($_.Exception.Message)"
  }

  # Fallback: accept a listener only when its diagnostic log has been updated
  # recently. This avoids killing a working runner on hosts where
  # Get-NetTCPConnection is unavailable while still recovering stale sessions.
  $latestLog = Get-LatestRunnerLog
  if ($latestLog -and $latestLog.LastWriteTimeUtc -gt (Get-Date).ToUniversalTime().AddMinutes(-10)) {
    return $true
  }
  return $false
}

function Stop-StaleRunner {
  $workers = @(Get-Process -Name 'Runner.Worker' -ErrorAction SilentlyContinue)
  if ($workers.Count -gt 0) {
    Write-GaiLog 'Runner.Worker is active; refusing to recycle the GitHub runner.'
    return $false
  }

  Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Write-GaiLog "Stopping stale Runner.Listener process pid=$($_.Id)."
      Stop-Process -Id $_.Id -Force -ErrorAction Stop
    } catch {
      Write-GaiLog "Unable to stop stale Runner.Listener pid=$($_.Id): $($_.Exception.Message)"
    }
  }
  return $true
}

function Start-GitHubRunner {
  $runCmd = Join-Path $RunnerRoot 'run.cmd'
  if (-not (Test-Path $runCmd)) {
    Write-GaiLog "Runner start skipped because $runCmd does not exist."
    return $false
  }

  Write-GaiLog 'Starting GitHub runner.'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'run.cmd' -WorkingDirectory $RunnerRoot -WindowStyle Hidden
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 5
    if (Test-RunnerConnection) { return $true }
  }
  return $false
}

$activeRunnerWorkers = @(Get-Process -Name 'Runner.Worker' -ErrorAction SilentlyContinue)
$runnerProtectedByActiveJob = $activeRunnerWorkers.Count -gt 0
$runnerConnectionHealthy = Test-RunnerConnection
$runnerSessionConflictGrace = (-not $runnerProtectedByActiveJob) -and (-not $runnerConnectionHealthy) -and (Test-RunnerSessionConflictGrace)
$runnerHealthy = $runnerConnectionHealthy -or $runnerProtectedByActiveJob
$runnerRecoveryDeferred = $false
$consecutiveRunnerFailures = Get-ConsecutiveRunnerFailures

if ($runnerProtectedByActiveJob) {
  Remove-Item -Path $runnerSessionConflictStatePath -Force -ErrorAction SilentlyContinue
  if (-not $runnerConnectionHealthy) {
    Write-GaiLog 'GitHub runner connection probe is unhealthy, but Runner.Worker is active. Skipping recycle.'
  }
  if ($consecutiveRunnerFailures -ne 0) {
    Set-ConsecutiveRunnerFailures 0
    $consecutiveRunnerFailures = 0
  }
} elseif ($runnerConnectionHealthy) {
  Remove-Item -Path $runnerSessionConflictStatePath -Force -ErrorAction SilentlyContinue
  if ($consecutiveRunnerFailures -ne 0) {
    Set-ConsecutiveRunnerFailures 0
    $consecutiveRunnerFailures = 0
  }
} elseif ($runnerSessionConflictGrace) {
  $runnerRecoveryDeferred = $true
  if ($consecutiveRunnerFailures -ne 0) {
    Set-ConsecutiveRunnerFailures 0
    $consecutiveRunnerFailures = 0
  }
  Write-GaiLog "GitHub runner broker session conflict is retrying; deferring recycle for up to $runnerSessionConflictGraceMinutes minutes."
} else {
  $consecutiveRunnerFailures++
  Set-ConsecutiveRunnerFailures $consecutiveRunnerFailures

  if ($consecutiveRunnerFailures -lt $runnerFailureThreshold) {
    $runnerRecoveryDeferred = $true
    Write-GaiLog "GitHub runner connection is unhealthy ($consecutiveRunnerFailures/$runnerFailureThreshold). Deferring recycle until the failure threshold is reached."
  } else {
    Write-GaiLog "GitHub runner connection is unhealthy for $consecutiveRunnerFailures consecutive checks. Recycling idle listener."
    if (Stop-StaleRunner) {
      Start-Sleep -Seconds 2
      $runnerConnectionHealthy = Start-GitHubRunner
      $runnerHealthy = $runnerConnectionHealthy
      if ($runnerHealthy) {
        Set-ConsecutiveRunnerFailures 0
        $consecutiveRunnerFailures = 0
      }
    } else {
      $activeRunnerWorkers = @(Get-Process -Name 'Runner.Worker' -ErrorAction SilentlyContinue)
      $runnerProtectedByActiveJob = $activeRunnerWorkers.Count -gt 0
      $runnerHealthy = $runnerProtectedByActiveJob
      $runnerRecoveryDeferred = $runnerProtectedByActiveJob
    }
  }
}

$ollamaHealthy = Test-OllamaApi
if (-not $ollamaHealthy) {
  $ollamaExe = Resolve-OllamaExe
  if ($ollamaExe) {
    Write-GaiLog 'Ollama API unavailable. Starting ollama serve.'
    Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden
    for ($i = 0; $i -lt 15; $i++) {
      Start-Sleep -Seconds 2
      if (Test-OllamaApi) { $ollamaHealthy = $true; break }
    }
  } else {
    Write-GaiLog 'Ollama executable is not installed yet.'
  }
}

$status = [ordered]@{
  workerId = 'zbook'
  runnerRoot = $RunnerRoot
  runnerHealthy = $runnerHealthy
  runnerConnectionHealthy = $runnerConnectionHealthy
  runnerSessionConflictGrace = $runnerSessionConflictGrace
  runnerSessionConflictGraceMinutes = $runnerSessionConflictGraceMinutes
  runnerHealthMode = 'active-job-or-established-tcp-or-recent-diag-or-session-conflict-grace'
  activeRunnerWorkers = $activeRunnerWorkers.Count
  runnerProtectedByActiveJob = $runnerProtectedByActiveJob
  consecutiveRunnerFailures = $consecutiveRunnerFailures
  runnerRecoveryDeferred = $runnerRecoveryDeferred
  ollamaEndpoint = $OllamaEndpoint
  ollamaHealthy = $ollamaHealthy
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$status | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $stateRoot 'zbook-watchdog-status.json')
if (-not $runnerHealthy -and $runnerRecoveryDeferred) { Write-GaiLog 'WARNING: GitHub runner health check failed; recovery is deferred to avoid interrupting active work or reacting to a transient failure.' }
if (-not $runnerHealthy -and -not $runnerRecoveryDeferred) { Write-GaiLog 'WARNING: GitHub runner is still unavailable after recovery attempt.' }
if (-not $ollamaHealthy) { Write-GaiLog 'WARNING: Ollama is still unavailable after recovery attempt.' }

if (-not $runnerHealthy -and -not $runnerRecoveryDeferred) { exit 2 }
