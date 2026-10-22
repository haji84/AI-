param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE 'CodexRecovery'),
  [switch]$RepairExistingTask
)
$ErrorActionPreference = 'Stop'
$taskName = 'Codex Desktop Recovery'
$restartName = 'Codex Desktop Restart'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'Install from the signed-in desktop account.' }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and -not $RepairExistingTask) { throw 'Recovery task already exists; inspect it before replacing.' }
if ($existing -and $existing.Description -notlike 'Issue #869:*') { throw 'Refusing to replace an unrelated task.' }
$existingRestart = Get-ScheduledTask -TaskName $restartName -ErrorAction SilentlyContinue
if ($existingRestart -and (-not $RepairExistingTask -or $existingRestart.Description -notlike 'Issue #869:*')) { throw 'Refusing to replace existing restart task without matching repair scope.' }
foreach ($old in @($existing, $existingRestart)) {
  if ($old) {
    $ownerSid = $old.Principal.UserId
    if ($ownerSid -notlike 'S-1-*') { $ownerSid = ([Security.Principal.NTAccount]::new($ownerSid)).Translate([Security.Principal.SecurityIdentifier]).Value }
    if ($ownerSid -ne $identity.User.Value -or [int]$old.Principal.RunLevel -ne 0 -or [int]$old.Principal.LogonType -ne 3) { throw 'Existing task principal differs; refusing repair.' }
  }
}
if ($existingRestart -and (@($existingRestart.Triggers | Where-Object { $_ }).Count -gt 0 -or [Xml.XmlConvert]::ToTimeSpan($existingRestart.Settings.ExecutionTimeLimit).TotalSeconds -ne 120 -or [int]$existingRestart.Settings.MultipleInstances -ne 2)) { throw 'Existing restart task settings differ; refusing repair.' }
# MSIX redirects LocalAppData writes into a private package cache invisible to Task Scheduler.
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$appDataRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'AppData'))
if ($InstallRoot -eq $appDataRoot -or $InstallRoot.StartsWith($appDataRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Install outside AppData to avoid MSIX file virtualization.' }
if ($InstallRoot -match '["\r\n%]') { throw 'Unsupported install path.' }
$package = @(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' })
if ($package.Count -ne 1) { throw 'Installed Codex desktop package not found for this user.' }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$payload = @('codex-recovery.ps1', 'codex-recovery.psm1', 'CodexRecoveryLauncher.exe')
foreach ($name in $payload) {
  if ((Test-Path (Join-Path $InstallRoot $name)) -and (-not $RepairExistingTask -or -not $existing)) { throw "Refusing to overwrite existing file: $name" }
}
$stage = Join-Path $InstallRoot ('install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($name in @('codex-recovery.ps1', 'codex-recovery.psm1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage $name) }
Add-Type -Path (Join-Path $PSScriptRoot 'codex-recovery-launcher.cs') -OutputAssembly (Join-Path $stage 'CodexRecoveryLauncher.exe') -OutputType WindowsApplication
$backup = Join-Path $stage 'previous'
New-Item -ItemType Directory -Path $backup | Out-Null
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $InstallRoot 'codex-recovery.ps1'
$launcher = Join-Path $InstallRoot 'CodexRecoveryLauncher.exe'
$action = New-ScheduledTaskAction -Execute $launcher -Argument 'Check' -WorkingDirectory $InstallRoot
$restartAction = New-ScheduledTaskAction -Execute $launcher -Argument 'Restart' -WorkingDirectory $InstallRoot
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $identity.Name),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 45) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Issue #869: Codex desktop presence recovery, minute checks, bounded retries, no AI task resubmission.'
$restartSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 120) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$restartTask = New-ScheduledTask -Action $restartAction -Settings $restartSettings -Principal $principal -Description 'Issue #869: Explicit owner-requested Codex desktop restart. No recurring trigger; no AI task resubmission.'
$installLock = $null
$changedTasks = @()
$newTasks = @()
$controls = @('Pause recovery.cmd', 'Resume recovery.cmd', 'Status recovery.cmd')
try {
  foreach ($old in @($existing, $existingRestart)) {
    if ($old) {
      Export-ScheduledTask -TaskName $old.TaskName | Set-Content (Join-Path $backup ($old.TaskName + '.xml'))
      Disable-ScheduledTask -TaskName $old.TaskName | Out-Null
      $changedTasks += $old
      for ($i = 0; $i -lt 15 -and (Get-ScheduledTask -TaskName $old.TaskName).State -eq 'Running'; $i++) { Start-Sleep -Seconds 1 }
      if ((Get-ScheduledTask -TaskName $old.TaskName).State -eq 'Running') { throw 'Existing task still running; retry update after it completes.' }
    }
  }
  $installLock = [IO.File]::Open((Join-Path $InstallRoot 'recovery.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  foreach ($name in ($payload + $controls)) {
    $destination = Join-Path $InstallRoot $name
    if (Test-Path $destination) { Copy-Item -LiteralPath $destination -Destination (Join-Path $backup $name) }
  }
  foreach ($name in $payload) { Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $InstallRoot $name) -Force }
  foreach ($control in @('Pause', 'Resume', 'Status')) {
    $cmd = "@echo off`r`n`"$psExe`" -NoProfile -ExecutionPolicy RemoteSigned -File `"$script`" -StateRoot `"$InstallRoot`" -Action $control`r`npause`r`n"
    Set-Content -LiteralPath (Join-Path $InstallRoot "$control recovery.cmd") -Value $cmd -Encoding ASCII
  }
  if ($existing) { Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null }
  else { Register-ScheduledTask -TaskName $taskName -InputObject $task | Out-Null; $newTasks += $taskName }
  if ($existingRestart) { Set-ScheduledTask -TaskName $restartName -Action $restartAction | Out-Null }
  else { Register-ScheduledTask -TaskName $restartName -InputObject $restartTask | Out-Null; $newTasks += $restartName }
  $installLock.Dispose(); $installLock = $null
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  Enable-ScheduledTask -TaskName $restartName | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output "Installed silent recovery and on-demand restart for $($identity.Name) at $InstallRoot. Backup: $backup"
} catch {
  foreach ($created in $newTasks) { Disable-ScheduledTask -TaskName $created | Out-Null }
  foreach ($name in ($payload + $controls)) {
    if (Test-Path (Join-Path $backup $name)) { Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $InstallRoot $name) -Force }
  }
  foreach ($old in $changedTasks) {
    Set-ScheduledTask -TaskName $old.TaskName -Action $old.Actions | Out-Null
    if ($old.Settings.Enabled) { Enable-ScheduledTask -TaskName $old.TaskName | Out-Null }
    else { Disable-ScheduledTask -TaskName $old.TaskName | Out-Null }
  }
  # Retain newly copied, inactive files and backup records for diagnosis; never delete owner data.
  throw
} finally { if ($installLock) { $installLock.Dispose() } }
