@echo off
setlocal DisableDelayedExpansion
set "GORIQ_RESTORE_LAUNCHER=%~f0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $text=[IO.File]::ReadAllText($env:GORIQ_RESTORE_LAUNCHER); $lf=[string][char]10; $text=$text.Replace(([string][char]13+$lf),$lf); $marker=$lf+'# GORIQ-RESTORE-POWERSHELL'+$lf; $position=$text.IndexOf($marker,[StringComparison]::Ordinal); if($position -lt 0){throw 'LAUNCHER_PAYLOAD_MISSING'}; $payload=$text.Substring($position+$marker.Length); $sha=[Security.Cryptography.SHA256]::Create(); try{$hash=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))).Replace('-','')}finally{$sha.Dispose()}; if($hash -ne 'db86591c1ceb5c6f75f064e3846eaba2cdf102c6f395e21f4757f905667494d6'){throw 'LAUNCHER_PAYLOAD_HASH_MISMATCH'}; & ([scriptblock]::Create($payload))"
set "GORIQ_RESTORE_EXIT=%ERRORLEVEL%"
echo(
pause
exit /b %GORIQ_RESTORE_EXIT%
# GORIQ-RESTORE-POWERSHELL

$ErrorActionPreference = 'Stop'
$directory = [IO.Path]::GetDirectoryName($env:GORIQ_RESTORE_LAUNCHER)
$savedResult = Get-ChildItem -LiteralPath $directory -Filter 'GORIQ-restore-result-*.json' -File |
    Where-Object { $_.Name -cmatch '^GORIQ-restore-result-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}\.json$' } |
    Sort-Object LastWriteTimeUtc, Name -Descending | Select-Object -First 1
if ($savedResult) {
    Write-Host ('保存済みの復元結果を表示します。 ' + $savedResult.Name)
    try {
        if ($savedResult.Length -gt 8192 -or ($savedResult.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'PREVIOUS_RESULT_UNVERIFIED'
        }
        $savedReceipt = Get-Content -LiteralPath $savedResult.FullName -Raw | ConvertFrom-Json
        if ($savedReceipt.Status -cne 'GORIQ_CONFIG_ROLLBACK' -or
            ($null -ne $savedReceipt.Restored -and $savedReceipt.Restored -isnot [bool])) {
            throw 'PREVIOUS_RESULT_UNVERIFIED'
        }
        $summary = [ordered]@{Status = 'GORIQ_CONFIG_ROLLBACK'; Restored = $savedReceipt.Restored; PreviousResult = $true}
        foreach ($name in @('Stage','Reason')) {
            if ($savedReceipt.$name -is [string] -and $savedReceipt.$name -cmatch '^[A-Za-z0-9_-]{1,70}$') {
                $summary[$name] = $savedReceipt.$name
            }
        }
        $summary | ConvertTo-Json -Compress
        if ($savedReceipt.Restored -eq $true -and -not $savedReceipt.Reason) { exit 0 }
    } catch {
        Write-Host 'GORIQ PREVIOUS_RESULT_UNVERIFIED'
    }
    exit 2
}

$ErrorActionPreference = 'Stop'
try {
    $lines = @(
[ordered]@{Status='GORIQ_CONFIG_ROLLBACK';Restored=$true;TargetCount=5} | ConvertTo-Json -Compress

    )
    $line = $lines | Where-Object { $_ -is [string] -and $_.StartsWith('{') } | Select-Object -Last 1
    $receipt = if ($line) { ConvertFrom-Json -InputObject $line } else { $null }
    if ($null -eq $receipt -or $receipt.Status -cne 'GORIQ_CONFIG_ROLLBACK' -or $receipt.Restored -isnot [bool]) {
        throw 'OPERATOR_RESULT_UNVERIFIED'
    }
} catch {
    $line = [ordered]@{
        Status = 'GORIQ_CONFIG_ROLLBACK'
        Stage = 'launcher'
        Reason = 'OPERATOR_RESULT_UNVERIFIED'
        Restored = $null
    } | ConvertTo-Json -Compress
    $receipt = ConvertFrom-Json -InputObject $line
}

Write-Output $line
try {
    $directory = [IO.Path]::GetDirectoryName($env:GORIQ_RESTORE_LAUNCHER)
    $suffix = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $resultPath = Join-Path $directory ('GORIQ-restore-result-' + $suffix + '.json')
    $bytes = [Text.Encoding]::UTF8.GetBytes($line + [Environment]::NewLine)
    $stream = [IO.File]::Open($resultPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
    Write-Host ('復元結果を保存しました。 ' + [IO.Path]::GetFileName($resultPath))
} catch {
    Write-Error 'GORIQ_RESULT_SAVE_FAILED' -ErrorAction Continue
    exit 3
}
if ($receipt.Restored -eq $true -and -not $receipt.Reason) { exit 0 }
exit 2
