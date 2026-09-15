param(
  [string]$RepoRoot = (Get-Location).Path,
  [switch]$AtStartup
)

$ErrorActionPreference = 'Stop'
$TaskName = 'JARVIS Remote Host'

if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
  throw "Repository root not found: $RepoRoot"
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw 'pnpm is required'
}

if ($AtStartup) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'AtStartup mode requires an elevated PowerShell. Re-run explicitly as Administrator.'
  }
}

$quotedRoot = $RepoRoot.Replace("'", "''")
$command = "Set-Location '$quotedRoot'; pnpm jarvis:remote:host"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`""
$trigger = if ($AtStartup) { New-ScheduledTaskTrigger -AtStartup } else { New-ScheduledTaskTrigger -AtLogOn }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed '$TaskName'."
if ($AtStartup) {
  Write-Host 'Mode: startup. This was an explicit Administrator operation.'
} else {
  Write-Host 'Mode: user logon. For unattended boot before logon, rerun in an elevated PowerShell with -AtStartup.'
}
