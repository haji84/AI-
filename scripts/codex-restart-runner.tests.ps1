$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('codex-restart-runner-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root | Out-Null
$global:restartRunner = @{ closes=0; kills=0; activations=0; badIdentity=$false }
$created = [datetime]'2026-09-18T10:00:00Z'
function Parent($id, $time) {
  [pscustomobject]@{ ProcessId=$id; CreationDate=$time; SessionId=1; ExecutablePath='C:\Program Files\WindowsApps\OpenAI.Codex_26.915.3509.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe'; CommandLine='"ChatGPT.exe"' }
}
$global:restartRunner.current = @(Parent 12345 $created)
function Get-CimInstance { param($ClassName, $Filter, $OperationTimeoutSec) @($global:restartRunner.current) }
function Get-Process {
  param($Id)
  if ($Id -eq $PID) { return [pscustomobject]@{ SessionId=1 } }
  $parent = @($global:restartRunner.current | Where-Object {$_.ProcessId -eq $Id})
  if (-not $parent.Count) { return }
  $time = $parent[0].CreationDate
  if ($global:restartRunner.badIdentity) { $time = $time.AddSeconds(1) }
  $process = [pscustomobject]@{ Handle=1; StartTime=$time }
  $process | Add-Member ScriptMethod CloseMainWindow { $global:restartRunner.closes++; $global:restartRunner.current=@(); return $true }
  $process | Add-Member ScriptMethod Kill { $global:restartRunner.kills++; $global:restartRunner.current=@() }
  $process | Add-Member ScriptMethod Dispose { }
  $process
}
function Get-AppxPackage { param($Name) [pscustomobject]@{PackageFamilyName='OpenAI.Codex_2p2nqsd0c76g0'} }
function Get-AppxPackageManifest { param($Package) [pscustomobject]@{ Package=@{Applications=@{Application=@(@{Id='App'})}} } }
function Start-Process {
  param($FilePath, $ArgumentList, $WindowStyle)
  if ($ArgumentList -ne 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App') { throw 'Wrong activation' }
  $global:restartRunner.activations++
  $global:restartRunner.current = @(Parent 23456 ([datetime]'2026-09-18T11:00:00Z'))
}
function Start-Sleep { param($Seconds) }
& "$PSScriptRoot/codex-recovery.ps1" -StateRoot $root -Action Pause
& "$PSScriptRoot/codex-recovery.ps1" -StateRoot $root -Action Restart
$state = Get-Content "$root/state.json" -Raw | ConvertFrom-Json
$status = Get-Content "$root/restart-status.json" -Raw | ConvertFrom-Json
if (-not $state.paused -or $state.processKey -notlike '23456:*' -or $status.result -ne 'restarted' -or -not $status.requestId) { throw 'FAIL: explicit restart must preserve pause and record verified new identity/request' }
if ($global:restartRunner.closes -ne 1 -or $global:restartRunner.activations -ne 1 -or $global:restartRunner.kills -ne 0) { throw 'FAIL: wrong lifecycle effects' }
$global:restartRunner.badIdentity = $true
& "$PSScriptRoot/codex-recovery.ps1" -StateRoot $root -Action Restart 2>$null
$failed = Get-Content "$root/restart-status.json" -Raw | ConvertFrom-Json
if ($failed.result -ne 'error' -or $failed.detail -notlike '*identity changed*' -or $failed.requestId -eq $status.requestId) { throw 'FAIL: PID reuse must fail with a fresh error record' }
if ($global:restartRunner.closes -ne 1 -or $global:restartRunner.activations -ne 1 -or $global:restartRunner.kills -ne 0) { throw 'FAIL: changed process identity must not be acted on' }
Write-Output 'PASS: restart runner pause preservation, lifecycle, fresh status and PID reuse rejection'
