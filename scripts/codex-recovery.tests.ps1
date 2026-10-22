$ErrorActionPreference = 'Stop'
if (-not (Test-Path "$PSScriptRoot/codex-recovery.psm1")) { throw 'FAIL: recovery implementation is missing' }
Import-Module "$PSScriptRoot/codex-recovery.psm1" -Force
$now = [datetime]'2026-09-18T12:00:00Z'
$count = 0
function Assert-Equal($actual, $expected, $name) {
  if ($actual -ne $expected) { throw "FAIL $name : expected $expected, got $actual" }
  $script:count++
}
function State { @{ attempts = 0; paused = $false; runningSince = $null; processKey = $null } }
$s = State
$d = Get-CodexRecoveryDecision $s $false $null $now
Assert-Equal $d.action 'launch' 'missing app launches'
Assert-Equal $d.state.attempts 1 'attempt persisted before launch'
1..2 | ForEach-Object { $d = Get-CodexRecoveryDecision $d.state $false $null $now }
Assert-Equal $d.state.attempts 3 'three attempts allowed'
$d = Get-CodexRecoveryDecision $d.state $false $null $now
Assert-Equal $d.action 'blocked' 'fourth attempt blocked'
$s = State; $s.paused = $true
Assert-Equal (Get-CodexRecoveryDecision $s $false $null $now).action 'paused' 'pause prevents launch'
$s = State
$d = Get-CodexRecoveryDecision $s $true '100:created' $now
Assert-Equal $d.action 'healthy' 'healthy app not relaunched'
$s.attempts = 2
$d = Get-CodexRecoveryDecision $s $true '100:created' $now
Assert-Equal $d.state.attempts 2 'brief recovery does not reset budget'
$d = Get-CodexRecoveryDecision $d.state $true '100:created' $now.AddSeconds(301)
Assert-Equal $d.state.attempts 0 'stable recovery resets budget'
$s.attempts = 2
$d = Get-CodexRecoveryDecision $s $true '100:created' $now
$d = Get-CodexRecoveryDecision $d.state $true '200:created' $now.AddSeconds(301)
Assert-Equal $d.state.attempts 2 'different process cannot satisfy stability'
$s.attempts = 4
try { Get-CodexRecoveryDecision $s $false $null $now; throw 'expected validation error' } catch {
  Assert-Equal ($_.Exception.Message -like '*Invalid recovery state*') $true 'invalid state fails closed'
}
$p = @{ ExecutablePath = 'C:\Program Files\WindowsApps\OpenAI.Codex_26.915.3509.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe'; CommandLine = '"app\ChatGPT.exe"'; SessionId = 1 }
Assert-Equal (Test-CodexDesktopProcess $p 1) $true 'desktop parent detected'
$p.CommandLine += ' --type=renderer'
Assert-Equal (Test-CodexDesktopProcess $p 1) $false 'renderer excluded'
$p.CommandLine = '"app\ChatGPT.exe"'
Assert-Equal (Test-CodexDesktopProcess $p 2) $false 'other session excluded'
$p.ExecutablePath = 'C:\Users\me\AppData\Local\OpenAI\Codex\bin\abc\codex.exe'
Assert-Equal (Test-CodexDesktopProcess $p 1) $false 'CLI backend excluded'
$p.ExecutablePath = 'C:\Program Files\WindowsApps\OpenAI.Codex_26.915.3509.0_x64__wrong\app\ChatGPT.exe'
Assert-Equal (Test-CodexDesktopProcess $p 1) $false 'different package excluded'
Write-Output "PASS: $count recovery assertions"

# Exercise the real runner, persistence, pause/resume and activation dispatch,
# with only OS process discovery/activation replaced. Never stop the host app.
$testRoot = Join-Path $env:TEMP ('codex-recovery-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $testRoot | Out-Null
$global:codexRecoveryTestLaunches = 0
function Get-CimInstance { param($ClassName, $Filter, $OperationTimeoutSec) return @() }
function Get-AppxPackage { param($Name) return [pscustomobject]@{ PackageFamilyName = 'OpenAI.Codex_2p2nqsd0c76g0' } }
function Get-AppxPackageManifest { param($Package) return [pscustomobject]@{ Package = @{ Applications = @{ Application = @(@{ Id = 'App' }) } } } }
function Start-Process {
  param($FilePath, $ArgumentList, $WindowStyle)
  if ($ArgumentList -ne 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App') { throw 'Wrong activation target' }
  $global:codexRecoveryTestLaunches++
}
& "$PSScriptRoot/codex-recovery.ps1" -StateRoot $testRoot -Action Pause
& "$PSScriptRoot/codex-recovery.ps1" -StateRoot $testRoot
Assert-Equal $global:codexRecoveryTestLaunches 0 'paused runner does not launch'
& "$PSScriptRoot/codex-recovery.ps1" -StateRoot $testRoot -Action Resume
1..4 | ForEach-Object { & "$PSScriptRoot/codex-recovery.ps1" -StateRoot $testRoot }
Assert-Equal $global:codexRecoveryTestLaunches 3 'runner dispatches only three activations'
Assert-Equal ((Get-Content "$testRoot/status.json" -Raw | ConvertFrom-Json).result) 'blocked' 'block recorded on disk'
Assert-Equal ((Get-Content "$testRoot/state.json" -Raw | ConvertFrom-Json).attempts) 3 'budget survives process invocation'
& "$PSScriptRoot/codex-recovery.ps1" -StateRoot $testRoot -Action Resume
Assert-Equal ((Get-Content "$testRoot/state.json" -Raw | ConvertFrom-Json).attempts) 0 'explicit resume resets budget'
Write-Output "PASS: $count total assertions including runner integration"
