param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE 'CodexRecovery'),
  [switch]$RepairExistingTask
)
$ErrorActionPreference = 'Stop'
$taskName = 'Codex Desktop Recovery'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'Install from the signed-in desktop account.' }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and -not $RepairExistingTask) { throw 'Recovery task already exists; inspect it before replacing.' }
if ($existing -and $existing.Description -notlike 'Issue #869:*') { throw 'Refusing to replace an unrelated task.' }
# MSIX redirects LocalAppData writes into a private package cache invisible to Task Scheduler.
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$appDataRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'AppData'))
if ($InstallRoot.StartsWith($appDataRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Install outside AppData to avoid MSIX file virtualization.' }
$package = @(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' })
if ($package.Count -ne 1) { throw 'Installed Codex desktop package not found for this user.' }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
foreach ($name in @('codex-recovery.ps1', 'codex-recovery.psm1')) {
  $destination = Join-Path $InstallRoot $name
  if (Test-Path $destination) { throw "Refusing to overwrite existing file: $destination" }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $destination
}
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $InstallRoot 'codex-recovery.ps1'
if ($InstallRoot -match '["\r\n%]') { throw 'Unsupported install path.' }
foreach ($control in @('Pause', 'Resume', 'Status')) {
  $cmd = "@echo off`r`n`"$psExe`" -NoProfile -ExecutionPolicy RemoteSigned -File `"$script`" -StateRoot `"$InstallRoot`" -Action $control`r`npause`r`n"
  Set-Content -LiteralPath (Join-Path $InstallRoot "$control recovery.cmd") -Value $cmd -Encoding ASCII
}
$action = New-ScheduledTaskAction -Execute $psExe -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$script`" -StateRoot `"$InstallRoot`"" -WorkingDirectory $InstallRoot
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $identity.Name),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 45) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Issue #869: Codex desktop presence recovery, minute checks, bounded retries, no AI task resubmission.'
if ($existing) { Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null }
else { Register-ScheduledTask -TaskName $taskName -InputObject $task | Out-Null }
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed $taskName for $($identity.Name) at $InstallRoot"
