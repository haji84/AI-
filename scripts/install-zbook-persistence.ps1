param(
  [string]$RunnerRoot = 'C:\actions-runner',
  [string]$OllamaEndpoint = 'http://127.0.0.1:11434'
)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'GAIWorker'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

$sourceWatchdog = Join-Path $PSScriptRoot 'gai-zbook-watchdog.ps1'
$persistedWatchdog = Join-Path $stateRoot 'gai-zbook-watchdog.ps1'
Copy-Item -Force $sourceWatchdog $persistedWatchdog

if (-not (Test-Path (Join-Path $RunnerRoot 'run.cmd'))) {
  throw "GitHub runner was not found at $RunnerRoot."
}

$ps = (Get-Command powershell.exe).Source
$taskCommand = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -File `"$persistedWatchdog`" -RunnerRoot `"$RunnerRoot`" -OllamaEndpoint `"$OllamaEndpoint`""

# User-scoped scheduled tasks recover the runner every five minutes after logon.
& schtasks.exe /Create /TN 'GAI-ZBook-Runner-OnLogon' /TR $taskCommand /SC ONLOGON /F | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Failed to create the ZBook logon task.' }

& schtasks.exe /Create /TN 'GAI-ZBook-Watchdog' /TR $taskCommand /SC MINUTE /MO 5 /F | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Failed to create the ZBook watchdog task.' }

# Add a Startup-folder fallback because user-scoped scheduled tasks can be
# disabled or delayed by local Windows policy. This is intentionally user
# scoped and does not require an administrator token or runner re-registration.
$startupDir = [Environment]::GetFolderPath('Startup')
$startupCmd = Join-Path $startupDir 'GAI-ZBook-Runner.cmd'
$startupContent = @(
  '@echo off',
  'start "GAI ZBook Watchdog" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + ('"{0}"' -f $persistedWatchdog) + ' -RunnerRoot ' + ('"{0}"' -f $RunnerRoot) + ' -OllamaEndpoint ' + ('"{0}"' -f $OllamaEndpoint)
) -join "`r`n"
Set-Content -Path $startupCmd -Value $startupContent -Encoding ASCII

# Run the watchdog immediately so installation is also a live health test.
& $ps -NoProfile -ExecutionPolicy Bypass -File $persistedWatchdog -RunnerRoot $RunnerRoot -OllamaEndpoint $OllamaEndpoint
if ($LASTEXITCODE -ne 0) { throw 'Initial ZBook watchdog execution failed.' }

$taskList = @('GAI-ZBook-Runner-OnLogon', 'GAI-ZBook-Watchdog') | ForEach-Object {
  $name = $_
  $raw = & schtasks.exe /Query /TN $name /FO LIST 2>&1
  [ordered]@{ name = $name; query = ($raw -join "`n") }
}

[ordered]@{
  mode = 'user-scheduled-task-plus-startup-fallback'
  runnerRoot = $RunnerRoot
  watchdog = $persistedWatchdog
  startupFallback = $startupCmd
  ollamaEndpoint = $OllamaEndpoint
  tasks = $taskList
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  requiresAdmin = $false
  requiresRunnerReregistrationToken = $false
  startsBeforeWindowsLogon = $false
} | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $stateRoot 'zbook-persistence.json')

Get-Content (Join-Path $stateRoot 'zbook-persistence.json')
