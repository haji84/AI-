param(
    [Parameter(Mandatory)][string]$HostPath,
    [Parameter(Mandatory)][ValidatePattern('^0\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,4})$')][string]$Version,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit
)
$ErrorActionPreference = 'Stop'
$expected = [version]$Version
if ($expected.Minor -gt 255 -or $expected.Build -gt 65535) { throw 'MSI version range exceeded' }
# Read PE metadata without launching the host or granting capture/input access.
$info = [Diagnostics.FileVersionInfo]::GetVersionInfo((Resolve-Path -LiteralPath $HostPath).Path)
if ($info.ProductName -cne 'GORIQ Remote Lite Candidate' -or
    $info.CompanyName -cne 'GORIQ Remote Lite' -or
    $info.OriginalFilename -cne 'GORIQRemoteLite.exe' -or
    $info.FileDescription -cne 'GORIQ Remote Lite manual Windows host' -or
    $info.ProductVersion -cne $Version -or $info.FileVersion -cne $Version -or
    $info.Comments -cne "Source commit: $SourceCommit") {
    throw 'Windows host product/version/source metadata mismatch'
}
foreach ($prefix in @('File', 'Product')) {
    foreach ($part in @{ Major = 0; Minor = $expected.Minor; Build = $expected.Build; Private = 0 }.GetEnumerator()) {
        if ($info.($prefix + $part.Key + 'Part') -ne $part.Value) { throw 'Windows host numeric version mismatch' }
    }
}
Write-Output "PASS Windows host metadata: product/version=$Version/source=$SourceCommit (signature not assessed)"
