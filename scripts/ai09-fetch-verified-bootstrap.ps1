# GORIQ AI-09: retrieve and SHA-256 verify the scoped Ubuntu seed script from GitHub.
# Default mode is Verify only. -Mode Execute is an explicit privileged operation.
param(
    [ValidateSet('Verify', 'Execute')]
    [string]$Mode = 'Verify'
)
$ErrorActionPreference = 'Stop'
$uri = 'https://raw.githubusercontent.com/haji84/AI-/feat/1798-ai09-bootstrap-script/scripts/ai09-prepare-bootstrap-disk.ps1'
$expectedSha256 = 'F1B385568030B5047202FD63437AD078B24D9A3167736DB7B6DE6A5B8ECD9C48'
$target = Join-Path $env:TEMP 'goriq-ai09-prepare-bootstrap-disk-verified.ps1'
$partial = Join-Path $env:TEMP 'goriq-ai09-bootstrap-download.tmp'

if (Test-Path -LiteralPath $partial) { throw 'PARTIAL_FILE_ALREADY_EXISTS' }
try {
    Invoke-WebRequest -Uri $uri -OutFile $partial -UseBasicParsing -TimeoutSec 45 -ErrorAction Stop
    $actualSha256 = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualSha256 -ne $expectedSha256) {
        throw ('UNVERIFIED_GITHUB_CONTENT_EXPECTED_' + $expectedSha256 + '_ACTUAL_' + $actualSha256)
    }
    Move-Item -LiteralPath $partial -Destination $target -Force
} finally {
    if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Force
    }
}
Write-Host ('GITHUB_SHA256_VERIFIED=' + $expectedSha256)
Write-Host ('LOCAL_FILE=' + $target)
if ($Mode -eq 'Verify') {
    Write-Host 'VERIFY_ONLY_NO_DISK_OR_VM_CHANGES'
    return
}
Write-Host 'EXECUTION_REQUESTED_BY_OWNER'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $target
if ($LASTEXITCODE -ne 0) {
    throw ('BOOTSTRAP_SCRIPT_FAILED_EXIT_CODE_' + $LASTEXITCODE)
}
