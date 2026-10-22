param(
    [Parameter(Mandatory)][string]$WixDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [ValidatePattern('^0\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,4})$')][string]$Version = '0.1.0',
    [string]$GoCommand = 'go'
)
$ErrorActionPreference = 'Stop'
if (([version]$Version).Minor -gt 255 -or ([version]$Version).Build -gt 65535) { throw 'MSI version range exceeded' }
$repo = Split-Path -Parent $PSScriptRoot
$tools = (Resolve-Path -LiteralPath $WixDirectory).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Use a new output directory; existing artifacts are retained' }
foreach ($name in @('candle.exe', 'light.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $tools $name) -PathType Leaf)) { throw 'WiX build tools unavailable' }
}
$go = (Get-Command $GoCommand -ErrorAction Stop).Source
$goRoot = & $go env GOROOT
if ($LASTEXITCODE -ne 0) { throw 'Go runtime unavailable' }
$goLicense = Join-Path $goRoot 'LICENSE'
if (!(Test-Path -LiteralPath $goLicense -PathType Leaf)) { throw 'Go redistribution notice unavailable' }
New-Item -ItemType Directory -Path $output | Out-Null
$hostExe = Join-Path $output 'GORIQRemoteLite.exe'
Push-Location (Join-Path $repo 'apps/remote-lite-windows')
try {
    & $go build -trimpath "-ldflags=-s -w -buildid=remote-lite-$Version" -o $hostExe ./cmd/localhost
    if ($LASTEXITCODE -ne 0) { throw 'Host build failed' }
} finally { Pop-Location }
$object = Join-Path $output 'Product.wixobj'
$msi = Join-Path $output ('GORIQRemoteLite-' + $Version + '.msi')
# Stable identity for one architecture/version: rebuilding the same version
# cannot register a second product over the first product's files.
$codeDigest = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes("GORIQRemoteLite-x64-per-user-$Version"))
$productCode = ([guid]::new([byte[]]$codeDigest[0..15])).ToString('B').ToUpperInvariant()
& (Join-Path $tools 'candle.exe') -nologo -wx -arch x64 "-dProductCode=$productCode" "-dProductVersion=$Version" "-dHostExecutable=$hostExe" "-dGoLicense=$goLicense" -out $object (Join-Path $repo 'apps/remote-lite-windows/installer/Product.wxs')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
& (Join-Path $tools 'light.exe') -nologo -wx -out $msi $object
if ($LASTEXITCODE -ne 0) { throw 'Installer linking/validation failed' }
& (Join-Path $PSScriptRoot 'remote-lite-windows-package-check.ps1') -MsiPath $msi
if (!$?) { throw 'MSI verification failed' }
[ordered]@{ version = $Version; productCode = $productCode; distributable = $false; signing = 'UNSIGNED_CANDIDATE';
    msi = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash;
    host = (Get-FileHash -LiteralPath $hostExe -Algorithm SHA256).Hash } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'candidate.json') -Encoding utf8
Write-Output "Built unsigned candidate: $msi"
