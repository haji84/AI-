param(
  [string]$RunnerRoot = 'C:\actions-runner',
  [string]$OllamaEndpoint = 'http://127.0.0.1:11434'
)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'GAIWorker'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$logPath = Join-Path $stateRoot 'zbook-watchdog.log'

function Write-GaiLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $logPath -Value $line
  Write-Host $line
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
  $names = @('Runner.Listener', 'Runner.Worker')
  foreach ($name in $names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        Write-GaiLog "Stopping stale $name process pid=$($_.Id)."
        Stop-Process -Id $_.Id -Force -ErrorAction Stop
      } catch {
        Write-GaiLog "Unable to stop stale $name pid=$($_.Id): $($_.Exception.Message)"
      }
    }
  }
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

$runnerHealthy = Test-RunnerConnection
if (-not $runnerHealthy) {
  Write-GaiLog 'GitHub runner connection is unhealthy. Recycling listener.'
  Stop-StaleRunner
  Start-Sleep -Seconds 2
  $runnerHealthy = Start-GitHubRunner
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
  runnerHealthMode = 'established-tcp-or-recent-diag'
  ollamaEndpoint = $OllamaEndpoint
  ollamaHealthy = $ollamaHealthy
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$status | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $stateRoot 'zbook-watchdog-status.json')
if (-not $runnerHealthy) { Write-GaiLog 'WARNING: GitHub runner is still unavailable after recovery attempt.' }
if (-not $ollamaHealthy) { Write-GaiLog 'WARNING: Ollama is still unavailable after recovery attempt.' }

if (-not $runnerHealthy) { exit 2 }
