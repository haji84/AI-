@echo off
setlocal DisableDelayedExpansion
set "GORIQ_RESTORE_LAUNCHER=%~f0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $text=[IO.File]::ReadAllText($env:GORIQ_RESTORE_LAUNCHER); $lf=[string][char]10; $text=$text.Replace(([string][char]13+$lf),$lf); $marker=$lf+'# GORIQ-RESTORE-POWERSHELL'+$lf; $position=$text.IndexOf($marker,[StringComparison]::Ordinal); if($position -lt 0){throw 'LAUNCHER_PAYLOAD_MISSING'}; $payload=$text.Substring($position+$marker.Length); $sha=[Security.Cryptography.SHA256]::Create(); try{$hash=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))).Replace('-','')}finally{$sha.Dispose()}; if($hash -ne '9117bd972cb03f4e5f01e2530205c0ab193a9a63fbedc4dc3f670ffcc650e7f6'){throw 'LAUNCHER_PAYLOAD_HASH_MISMATCH'}; & ([scriptblock]::Create($payload))"
exit /b %ERRORLEVEL%
# GORIQ-RESTORE-POWERSHELL
$ErrorActionPreference = 'Stop'
try {
    $lines = @(
[ordered]@{Status='GORIQ_CONFIG_ROLLBACK';Restored=$false;Reason='ORIGINAL_BROKER_NOT_HEALTHY'} | ConvertTo-Json -Compress

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
