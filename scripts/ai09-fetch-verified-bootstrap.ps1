# GitHub-pinned AI-09 seed delivery. Verify never invokes the disk/VM script.
[CmdletBinding()]
param(
    [ValidateSet('Verify', 'Execute')][string]$Mode = 'Verify',
    [string]$ExpectedAclSha256 = ''
)
$ErrorActionPreference = 'Stop'

function Invoke-Ai09VerifiedChild {
    param([string]$Target, [string]$ExpectedAclSha256, [string]$RunDirectory)
    # Use the OS binary and existing execution policy; never elevate or bypass here.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $start.Arguments = '-NoProfile -NonInteractive -File "' + $Target + '" -Mode Execute -ExpectedAclSha256 ' + $ExpectedAclSha256
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Console]::OutputEncoding
    $start.StandardErrorEncoding = [Console]::OutputEncoding
    $child = New-Object Diagnostics.Process
    $child.StartInfo = $start
    try {
        if (-not $child.Start()) { throw 'CHILD_START_FAILED' }
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        # Do not kill a process halfway through storage cleanup. The preparation
        # script owns its try/finally dismount; SSH probes have separate timeouts.
        $child.WaitForExit()
        [IO.File]::WriteAllText((Join-Path $RunDirectory 'stdout.txt'), $stdout.GetAwaiter().GetResult(), [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $RunDirectory 'stderr.txt'), $stderr.GetAwaiter().GetResult(), [Text.UTF8Encoding]::new($false))
        return $child.ExitCode
    } finally { $child.Dispose() }
}

function Invoke-Ai09VerifiedFetch {
    [CmdletBinding()]
    param([ValidateSet('Verify', 'Execute')][string]$Mode = 'Verify', [string]$ExpectedAclSha256 = '')
    if ($Mode -eq 'Execute' -and $ExpectedAclSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'ACL_BASELINE_REQUIRED' }
    $uri = 'https://raw.githubusercontent.com/haji84/AI-/6b36842e791611ecba0a1917d4732ab09d6c5af1/scripts/ai09-prepare-bootstrap-disk.ps1'
    $expectedSha256 = 'DF755ECA63C62576E93AFBB17E40450DABD9367082C18D4D5593E6EE3F6FAACB'
    $runId = [Guid]::NewGuid().ToString('N')
    $runDirectory = Join-Path ([IO.Path]::GetTempPath()) ('goriq-ai09-bootstrap-' + $runId)
    if (Test-Path -LiteralPath $runDirectory) { throw 'RUN_DIRECTORY_COLLISION' }
    [void][IO.Directory]::CreateDirectory($runDirectory)
    $target = Join-Path $runDirectory 'verified-bootstrap.ps1'
    $receipt = [ordered]@{ runId = $runId; startedAt = [DateTime]::UtcNow.ToString('o'); mode = $Mode; source = $uri; expectedSha256 = $expectedSha256; status = 'FAILED'; exitCode = $null; localFile = $target }
    $lockedFile = $null
    $response = $null
    try {
        # CreateNew prevents overwriting. After download, reopen read-only and
        # hash that final locked handle; any intervening replacement fails hash.
        $lockedFile = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
        $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 45 -MaximumRedirection 0 -ErrorAction Stop
        $inputStream = $response.RawContentStream
        $buffer = New-Object byte[] 8192
        $total = 0
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt 1048576) { throw 'DOWNLOAD_TOO_LARGE' }
            $lockedFile.Write($buffer, 0, $count)
        }
        $lockedFile.Flush()
        $lockedFile.Dispose()
        $lockedFile = [IO.File]::Open($target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $lockedFile.Position = 0
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($algorithm.ComputeHash($lockedFile)).Replace('-', '') }
        finally { $algorithm.Dispose() }
        $receipt.actualSha256 = $actual
        if ($actual -cne $expectedSha256) { throw ('SHA256_MISMATCH_EXPECTED_' + $expectedSha256 + '_ACTUAL_' + $actual) }
        if ($Mode -eq 'Verify') { $receipt.status = 'VERIFIED_ONLY' }
        else {
            $receipt.exitCode = Invoke-Ai09VerifiedChild -Target $target -ExpectedAclSha256 $ExpectedAclSha256 -RunDirectory $runDirectory
            if ($receipt.exitCode -ne 0) { throw ('CHILD_FAILED_' + $receipt.exitCode) }
            $receipt.status = 'PREPARATION_SUCCEEDED_GUEST_NOT_VERIFIED'
        }
    } catch {
        $receipt.error = $_.Exception.Message
        throw
    } finally {
        if ($null -ne $response -and $null -ne $response.RawContentStream) { $response.RawContentStream.Dispose() }
        if ($null -ne $lockedFile) { $lockedFile.Dispose() }
        $receipt.finishedAt = [DateTime]::UtcNow.ToString('o')
        [IO.File]::WriteAllText((Join-Path $runDirectory 'receipt.json'), ($receipt | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
        Write-Host ('AI09_RECEIPT=' + (Join-Path $runDirectory 'receipt.json'))
    }
    return [pscustomobject]$receipt
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-Ai09VerifiedFetch -Mode $Mode -ExpectedAclSha256 $ExpectedAclSha256
}
