$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot/codex-recovery.psm1" -Force
if (-not (Get-Command Invoke-CodexDesktopRestart -ErrorAction SilentlyContinue)) { throw 'FAIL: explicit restart implementation missing' }
$global:restartFixture = @{}
$assertions = 0
function Assert($value, $message) { if (-not $value) { throw "FAIL: $message" }; $script:assertions++ }
function Run-Fixture($fixture) {
  $global:restartFixture = $fixture
  Invoke-CodexDesktopRestart -Probe { @($global:restartFixture.current) } -Close {
    param($parent)
    $global:restartFixture.closed++
    if (-not $global:restartFixture.stubborn) { $global:restartFixture.current = @() }
  } -ForceStop {
    param($parent)
    $global:restartFixture.forced++
    if (-not $global:restartFixture.forceFails) { $global:restartFixture.current = @() }
  } -Activate {
    $global:restartFixture.launched++
    if (-not $global:restartFixture.launchFails) { $global:restartFixture.current = @(@{ Key = 'new'; ProcessId = 202 }) }
  } -Wait { param($seconds) }
}
function Fixture { @{ current=@(@{Key='old';ProcessId=101});closed=0;forced=0;launched=0;stubborn=$false;forceFails=$false;launchFails=$false } }
$f = Fixture
$result = Run-Fixture $f
Assert ($f.closed -eq 1 -and $f.forced -eq 0 -and $f.launched -eq 1) 'graceful close then launch exactly once'
Assert ($result.newKey -eq 'new') 'new process identity verified'
$f = Fixture; $f.stubborn = $true
$result = Run-Fixture $f
Assert ($f.forced -eq 1 -and $f.launched -eq 1) 'bounded force-stop after graceful timeout'
$f = Fixture; $f.current = @()
$result = Run-Fixture $f
Assert ($f.closed -eq 0 -and $f.forced -eq 0 -and $f.launched -eq 1) 'absent app only launches'
$f = Fixture; $f.stubborn = $true; $f.forceFails = $true
try { Run-Fixture $f; throw 'missing error' } catch { Assert ($_.Exception.Message -like '*still running*') 'failed close aborts launch' }
Assert ($f.launched -eq 0) 'no duplicate while old app remains'
$f = Fixture; $f.launchFails = $true
try { Run-Fixture $f; throw 'missing error' } catch { Assert ($_.Exception.Message -like '*not observed*') 'failed restart not reported as success' }
Assert ($f.launched -eq 1) 'restart activation bounded to one attempt'
$f = Fixture; $f.current += @{Key='other';ProcessId=303}
try { Run-Fixture $f; throw 'missing error' } catch { Assert ($_.Exception.Message -like '*Multiple*') 'ambiguous parents fail closed' }
Assert ($f.closed -eq 0 -and $f.launched -eq 0) 'ambiguous parents untouched'
$global:restartFixture = Fixture
$result = Invoke-CodexDesktopRestart -Probe { @($global:restartFixture.current) } -Close {
  param($p)
  $global:restartFixture.current = @(@{Key='manual'; ProcessId=404})
} -ForceStop { throw 'Must not stop replacement' } -Activate { throw 'Must not duplicate replacement' } -Wait { param($seconds) }
Assert ($result.newKey -eq 'manual') 'manual replacement during close is not killed or duplicated'
Write-Output "PASS: $assertions restart assertions"
