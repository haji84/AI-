param(
  [ValidateSet('Check', 'Status', 'Pause', 'Resume')][string]$Action = 'Check',
  [string]$StateRoot = (Join-Path $env:USERPROFILE 'CodexRecovery')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'codex-recovery.psm1') -Force
New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
$statePath = Join-Path $StateRoot 'state.json'
$statusPath = Join-Path $StateRoot 'status.json'
$logPath = Join-Path $StateRoot 'recovery.log'
$lock = $null
function Save-Json($Value, [string]$Path) {
  $temp = "$Path.new"
  [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temp, $Path, [System.Management.Automation.Language.NullString]::Value) }
  else { [IO.File]::Move($temp, $Path) }
}
function Write-Status([string]$Result, [string]$Detail) {
  $status = @{ checkedAt = [datetime]::UtcNow.ToString('o'); result = $Result; detail = $Detail }
  Save-Json $status $statusPath
  # Bound log size; keep one previous segment.
  if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 1MB) {
    [IO.File]::Copy($logPath, "$logPath.previous", $true)
    [IO.File]::WriteAllText($logPath, '')
  }
  Add-Content -LiteralPath $logPath -Value "$($status.checkedAt) $Result $Detail"
  $status | ConvertTo-Json -Compress
}
try {
  try { $lock = [IO.File]::Open((Join-Path $StateRoot 'recovery.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
  catch [IO.IOException] { Write-Output 'Another recovery check/control operation owns the lock.'; exit 0 }
  $state = @{ attempts = 0; paused = $false; runningSince = $null; processKey = $null }
  if (Test-Path $statePath) {
    $loaded = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $state = @{}
    foreach ($property in $loaded.PSObject.Properties) { $state[$property.Name] = $property.Value }
  }
  # Validate persistent state before any action. Corruption must never reset the budget.
  $null = Get-CodexRecoveryDecision $state $false $null ([datetime]::UtcNow)
  if ($Action -eq 'Status') {
    $state | ConvertTo-Json
    if (Test-Path $statusPath) { Get-Content -LiteralPath $statusPath -Raw }
    exit 0
  }
  if ($Action -in @('Pause', 'Resume')) {
    $state.paused = ($Action -eq 'Pause')
    if ($Action -eq 'Resume') { $state.attempts = 0; $state.runningSince = $null; $state.processKey = $null }
    Save-Json $state $statePath
    Write-Status $Action 'Owner control applied.'
    exit 0
  }
  if ($state.paused) { Write-Status 'paused' 'Monitoring paused by owner.'; exit 0 }
  $sessionId = (Get-Process -Id $PID).SessionId
  if ($sessionId -eq 0) { throw 'Interactive user session required; refusing service-session launch.' }
  $processes = @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe' OR Name='Codex.exe'" -OperationTimeoutSec 10)
  $running = @($processes | Where-Object { Test-CodexDesktopProcess $_ $sessionId })
  # Unknown paths/command lines are not evidence that the desktop is absent.
  $unknown = @($processes | Where-Object { $_.SessionId -eq $sessionId -and (-not $_.ExecutablePath -or -not $_.CommandLine) })
  if ($running.Count -eq 0 -and $unknown.Count -gt 0) { throw 'Desktop process probe inconclusive; refusing duplicate launch.' }
  $key = $null
  if ($running.Count -gt 0) { $key = "$($running[0].ProcessId):$($running[0].CreationDate.ToUniversalTime().ToString('o'))" }
  $decision = Get-CodexRecoveryDecision $state ($running.Count -gt 0) $key ([datetime]::UtcNow)
  Save-Json $decision.state $statePath
  if ($decision.action -eq 'launch') {
    Write-Status 'launching' "Recovery attempt $($decision.state.attempts)/3; stability required for five minutes."
    $packages = @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' })
    if ($packages.Count -ne 1) { throw 'Expected exactly one installed OpenAI.Codex package.' }
    $manifest = Get-AppxPackageManifest -Package $packages[0] -ErrorAction Stop
    $apps = @($manifest.Package.Applications.Application | Where-Object { $_.Id -eq 'App' })
    if ($apps.Count -ne 1) { throw 'Codex App entry missing from installed package manifest.' }
    # Stable Windows app identity survives package-version updates. No internal CLI invocation.
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App' -WindowStyle Hidden
    Write-Status 'launch-requested' 'Windows activation requested; next scheduled check verifies the desktop process.'
  } else {
    Write-Status $decision.action "attempts=$($decision.state.attempts)/3; desktopParents=$($running.Count)"
    if ($decision.action -eq 'blocked') { exit 2 }
  }
} catch {
  if ($lock) { Write-Status 'error' $_.Exception.Message }
  Write-Error $_ -ErrorAction Continue
  exit 1
} finally {
  if ($lock) { $lock.Dispose() }
}
