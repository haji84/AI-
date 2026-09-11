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

$runnerHealthy = $false
if (Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue) {
  $runnerHealthy = $true
} else {
  $runCmd = Join-Path $RunnerRoot 'run.cmd'
  if (Test-Path $runCmd) {
    Write-GaiLog 'Runner.Listener not found. Starting GitHub runner.'
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'run.cmd' -WorkingDirectory $RunnerRoot -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $runnerHealthy = [bool](Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue)
  } else {
    Write-GaiLog "Runner start skipped because $runCmd does not exist."
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
  ollamaEndpoint = $OllamaEndpoint
  ollamaHealthy = $ollamaHealthy
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$status | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $stateRoot 'zbook-watchdog-status.json')
if (-not $runnerHealthy) { Write-GaiLog 'WARNING: GitHub runner is still unavailable after recovery attempt.' }
if (-not $ollamaHealthy) { Write-GaiLog 'WARNING: Ollama is still unavailable after recovery attempt.' }
