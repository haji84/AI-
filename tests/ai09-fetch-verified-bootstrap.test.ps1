param([string]$RepositoryRoot)
$ErrorActionPreference = 'Stop'
$source = Join-Path $RepositoryRoot 'scripts/ai09-fetch-verified-bootstrap.ps1'
$text = [IO.File]::ReadAllText($source)
if ($text -notmatch '/[a-f0-9]{40}/scripts/ai09-prepare-bootstrap-disk.ps1') { throw 'REGRESSION: source URL is not immutable' }
if ($text -match 'ExecutionPolicy\s+Bypass') { throw 'REGRESSION: execution policy bypass present' }
. $source
$script:fixtureBytes = [IO.File]::ReadAllBytes((Join-Path $RepositoryRoot 'scripts/ai09-prepare-bootstrap-disk.ps1'))
$script:fixtureBytes = [Text.Encoding]::UTF8.GetBytes([Text.Encoding]::UTF8.GetString($script:fixtureBytes).Replace("`r`n", "`n"))
$script:fixtureMode = 'valid'
$script:executions = 0
$script:seenDirectories = @()
function Invoke-WebRequest {
    param($Uri, [switch]$UseBasicParsing, $TimeoutSec, $MaximumRedirection, $ErrorAction)
    if ($MaximumRedirection -ne 0 -or $TimeoutSec -ne 45) { throw 'DOWNLOAD_BOUNDARY_MISSING' }
    if ($script:fixtureMode -eq 'network') { throw 'SIMULATED_NETWORK_FAILURE' }
    $data = $script:fixtureBytes
    if ($script:fixtureMode -eq 'tamper') { $data = [Text.Encoding]::UTF8.GetBytes('unverified code') }
    return [pscustomobject]@{ RawContentStream = [IO.MemoryStream]::new([byte[]]$data) }
}
function Invoke-Ai09VerifiedChild {
    param($Target, $ExpectedAclSha256, $RunDirectory)
    $script:executions++
    if ($ExpectedAclSha256 -ne ('A' * 64)) { throw 'ACL_SCOPE_LOST' }
    $script:seenDirectories += $RunDirectory
    if ($env:OS -eq 'Windows_NT') {
        $locked = $false
        try { $stream = [IO.File]::Open($Target, 'Open', 'Write', 'ReadWrite'); $stream.Dispose() }
        catch [IO.IOException] { $locked = $true }
        if (-not $locked) { throw 'VERIFIED_FILE_WAS_WRITABLE' }
    }
    if ($script:fixtureMode -eq 'childFailure') { return 7 }
    return 0
}
function Assert-Fails([scriptblock]$Action, [string]$Pattern) {
    try { & $Action | Out-Null } catch { if ($_.Exception.Message -match $Pattern) { return }; throw }
    throw ('EXPECTED_FAILURE_NOT_OBSERVED: ' + $Pattern)
}
$first = Invoke-Ai09VerifiedFetch -Mode Verify
if ($script:executions -ne 0 -or $first.status -ne 'VERIFIED_ONLY') { throw 'VERIFY_EXECUTED_CHILD' }
$script:fixtureMode = 'tamper'
Assert-Fails { Invoke-Ai09VerifiedFetch -Mode Execute -ExpectedAclSha256 ('A' * 64) } 'SHA256_MISMATCH'
if ($script:executions -ne 0) { throw 'MISMATCH_EXECUTED' }
$script:fixtureMode = 'network'
Assert-Fails { Invoke-Ai09VerifiedFetch -Mode Execute -ExpectedAclSha256 ('A' * 64) } 'SIMULATED_NETWORK_FAILURE'
Assert-Fails { Invoke-Ai09VerifiedFetch -Mode Execute } 'ACL_BASELINE_REQUIRED'
if ($script:executions -ne 0) { throw 'FAILED_PREFLIGHT_EXECUTED' }
$script:fixtureMode = 'valid'
$executed = Invoke-Ai09VerifiedFetch -Mode Execute -ExpectedAclSha256 ('A' * 64)
if ($script:executions -ne 1 -or $executed.exitCode -ne 0) { throw 'EXECUTE_RESULT_MISSING' }
$script:fixtureMode = 'childFailure'
Assert-Fails { Invoke-Ai09VerifiedFetch -Mode Execute -ExpectedAclSha256 ('A' * 64) } 'CHILD_FAILED_7'
if ($script:seenDirectories[0] -eq $script:seenDirectories[1]) { throw 'CACHE_DIRECTORY_REUSED' }
$receipt = Get-Content -LiteralPath (Join-Path $script:seenDirectories[1] 'receipt.json') -Raw | ConvertFrom-Json
if ($receipt.exitCode -ne 7 -or $receipt.status -ne 'FAILED') { throw 'FAILURE_RECEIPT_MISSING' }
Write-Output 'PASS: immutable source, Verify no execution, mismatch/network refusal, explicit ACL scope, locked execution, unique runs, exit/failure receipts'

# Exercise the real Windows PowerShell child, not just a mocked executor.
if ($env:OS -eq 'Windows_NT') {
    . $source
    $folder = Join-Path $env:TEMP ('ai09-harmless-child-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($folder)
    $file = Join-Path $folder 'harmless.ps1'
    [IO.File]::WriteAllText($file, 'param($Mode,$ExpectedAclSha256); if($Mode -ne "Execute" -or $ExpectedAclSha256 -ne ("A"*64)){exit 9}; [Console]::Out.WriteLine("probe-out"); [Console]::Error.WriteLine("probe-err"); exit 7', [Text.UTF8Encoding]::new($false))
    $lock = [IO.File]::Open($file, 'Open', 'Read', 'Read')
    try { $childExit = Invoke-Ai09VerifiedChild -Target $file -ExpectedAclSha256 ('A' * 64) -RunDirectory $folder }
    finally { $lock.Dispose() }
    if ($childExit -ne 7 -or [IO.File]::ReadAllText((Join-Path $folder 'stdout.txt')).Trim() -ne 'probe-out' -or [IO.File]::ReadAllText((Join-Path $folder 'stderr.txt')).Trim() -ne 'probe-err') { throw 'REAL_CHILD_CAPTURE_FAILED' }
    Write-Output 'PASS: real PS5.1 child reads locked script and returns stdout/stderr/exit7 with exact arguments'
}
