param(
  [string]$RunnerRoot = 'C:\actions-runner',
  [string]$OllamaEndpoint = 'http://127.0.0.1:11434'
)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'GAIWorker'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$logPath = Join-Path $stateRoot 'zbook-watchdog.log'
$runnerHealthStatePath = Join-Path $stateRoot 'zbook-runner-health.json'
$runnerFailureThreshold = 3

function Write-GaiLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $logPath -Value $line
  Write-Host $line
}

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

function Test-RunnerConnection {
  $listeners = @(Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return $false }

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
  $diagRoot = Join-Path $RunnerRoot '_diag'
  $latestLog = Get-ChildItem -Path $diagRoot -Filter 'Runner_*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
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
$runnerHealthy = $runnerConnectionHealthy -or $runnerProtectedByActiveJob
$runnerRecoveryDeferred = $false
$consecutiveRunnerFailures = Get-ConsecutiveRunnerFailures

if ($runnerProtectedByActiveJob) {
  if (-not $runnerConnectionHealthy) {
    Write-GaiLog 'GitHub runner connection probe is unhealthy, but Runner.Worker is active. Skipping recycle.'
  }
  if ($consecutiveRunnerFailures -ne 0) {
    Set-ConsecutiveRunnerFailures 0
    $consecutiveRunnerFailures = 0
  }
} elseif ($runnerConnectionHealthy) {
  if ($consecutiveRunnerFailures -ne 0) {
    Set-ConsecutiveRunnerFailures 0
    $consecutiveRunnerFailures = 0
  }
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
  runnerHealthMode = 'active-job-or-established-tcp-or-recent-diag'
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
