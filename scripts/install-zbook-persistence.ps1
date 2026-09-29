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
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path $wscript)) {
  throw "Windows Script Host was not found at $wscript."
}

# PowerShell is a console application, so -WindowStyle Hidden can still produce
# a brief console flash while the process is being created. Launch it through
# WScript instead so the watchdog runs without creating a console window.
$watchdogCommand = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -File `"$persistedWatchdog`" -RunnerRoot `"$RunnerRoot`" -OllamaEndpoint `"$OllamaEndpoint`""
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

function Test-HiddenTaskHost([string]$TaskName) {
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task -or -not $task.Actions) { return $false }
    $action = $task.Actions | Select-Object -First 1
    return ([string]$action.Execute -ieq $wscript) -and
      ([string]$action.Arguments -match '//B') -and
      ([string]$action.Arguments -match '//NoLogo')
  } catch {
    return $false
  }
}

# User-scoped scheduled tasks recover the runner every five minutes after logon.
# An older task may have been created from an elevated interactive shell. A
# non-elevated runner cannot overwrite that task directly, so copy the new
# watchdog first and, on access denial, start the existing watchdog once. The
# elevated task then migrates only its own action to the hidden WScript launcher.
$taskRegistrationFailed = $false

& schtasks.exe /Create /TN 'GAI-ZBook-Runner-OnLogon' /TR $taskCommand /SC ONLOGON /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  $taskRegistrationFailed = $true
  Write-Warning 'Direct update of GAI-ZBook-Runner-OnLogon failed; attempting in-place self-migration.'
}

& schtasks.exe /Create /TN 'GAI-ZBook-Watchdog' /TR $taskCommand /SC MINUTE /MO 5 /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  $taskRegistrationFailed = $true
  Write-Warning 'Direct update of GAI-ZBook-Watchdog failed; attempting in-place self-migration.'
}

if ($taskRegistrationFailed) {
  & schtasks.exe /Run /TN 'GAI-ZBook-Watchdog' | Out-Host
  for ($i = 0; $i -lt 30; $i++) {
    if ((Test-HiddenTaskHost 'GAI-ZBook-Runner-OnLogon') -and (Test-HiddenTaskHost 'GAI-ZBook-Watchdog')) {
      $taskRegistrationFailed = $false
      break
    }
    Start-Sleep -Seconds 2
  }
}

if ($taskRegistrationFailed) {
  throw 'Failed to migrate the existing ZBook scheduled tasks to the hidden WScript launcher.'
}

# Add a Startup-folder fallback because user-scoped scheduled tasks can be
# disabled or delayed by local Windows policy. Use VBS here as well so logon
# recovery does not flash a console window.
$startupDir = [Environment]::GetFolderPath('Startup')
$startupVbs = Join-Path $startupDir 'GAI-ZBook-Runner.vbs'
Set-Content -Path $startupVbs -Value $launcherContent -Encoding Unicode
$legacyStartupCmd = Join-Path $startupDir 'GAI-ZBook-Runner.cmd'
Remove-Item -Path $legacyStartupCmd -Force -ErrorAction SilentlyContinue

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
  launcher = $launcherVbs
  taskHost = $wscript
  startupFallback = $startupVbs
  ollamaEndpoint = $OllamaEndpoint
  tasks = $taskList
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  requiresAdmin = $false
  requiresRunnerReregistrationToken = $false
  startsBeforeWindowsLogon = $false
} | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $stateRoot 'zbook-persistence.json')

Get-Content (Join-Path $stateRoot 'zbook-persistence.json')
