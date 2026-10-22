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
if ($output.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
    $output.StartsWith($repo.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Candidate output must be outside the source worktree'
}
if (Test-Path -LiteralPath $output) { throw 'Use a new output directory; existing artifacts are retained' }
foreach ($name in @('candle.exe', 'light.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $tools $name) -PathType Leaf)) { throw 'WiX build tools unavailable' }
}
$go = (Get-Command $GoCommand -ErrorAction Stop).Source
$goRoot = & $go env GOROOT
if ($LASTEXITCODE -ne 0) { throw 'Go runtime unavailable' }
$goLicense = Join-Path $goRoot 'LICENSE'
if (!(Test-Path -LiteralPath $goLicense -PathType Leaf)) { throw 'Go redistribution notice unavailable' }
$sourceCommit = git -C $repo rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Source commit unavailable' }
$sourceChanges = git -C $repo status --porcelain --untracked-files=normal
if ($LASTEXITCODE -ne 0 -or $sourceChanges) { throw 'Candidate requires a clean source worktree' }
New-Item -ItemType Directory -Path $output | Out-Null
$hostExe = Join-Path $output 'GORIQRemoteLite.exe'
# Build the committed source in a fresh directory. Generated .syso resources must
# never enter the worktree, influence later native tests, or include ignored keys.
$archive = Join-Path $output 'source.zip'
git -C $repo archive --format=zip "--output=$archive" $sourceCommit -- apps/remote-lite-windows scripts/remote-lite-windows-host-check.ps1 scripts/remote-lite-windows-package-check.ps1 docs/remote-lite/START_HERE_JA.md
if ($LASTEXITCODE -ne 0) { throw 'Committed host source export failed' }
$staging = Join-Path $output 'source'
Expand-Archive -LiteralPath $archive -DestinationPath $staging
$app = Join-Path $staging 'apps/remote-lite-windows'
$resource = Join-Path $app 'cmd/localhost/resource_windows_amd64.syso'
if (Test-Path -LiteralPath $resource) { throw 'Unexpected prebuilt version resource in source' }
$numericVersion = @{ Major = 0; Minor = ([version]$Version).Minor; Patch = ([version]$Version).Build; Build = 0 }
$versionConfig = Join-Path $output 'versioninfo.json'
@{
    FixedFileInfo = @{ FileVersion = $numericVersion; ProductVersion = $numericVersion;
        FileFlagsMask = '3f'; FileFlags = '00'; FileOS = '040004'; FileType = '01'; FileSubType = '00' }
    StringFileInfo = @{ ProductName = 'GORIQ Remote Lite Candidate'; CompanyName = 'GORIQ Remote Lite';
        FileDescription = 'GORIQ Remote Lite manual Windows host'; OriginalFilename = 'GORIQRemoteLite.exe';
        FileVersion = $Version; ProductVersion = $Version; Comments = "Source commit: $sourceCommit" }
    VarFileInfo = @{ Translation = @{ LangID = '0409'; CharsetID = '04B0' } }
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $versionConfig -Encoding utf8NoBOM
Push-Location (Join-Path $app 'buildtools/versioninfo')
try {
    # Separate module pins generator/dependency checksums; no runtime dependency,
    # manifest/privilege change, signing credential, or @latest tool resolution.
    & $go run -mod=readonly github.com/josephspurrier/goversioninfo/cmd/goversioninfo -64 -o $resource $versionConfig
    if ($LASTEXITCODE -ne 0) { throw 'Windows version resource generation failed' }
} finally { Pop-Location }
Push-Location $app
try {
    & $go build -trimpath -buildvcs=false "-ldflags=-s -w -buildid=remote-lite-$Version" -o $hostExe ./cmd/localhost
    if ($LASTEXITCODE -ne 0) { throw 'Host build failed' }
} finally { Pop-Location }
& (Join-Path $staging 'scripts/remote-lite-windows-host-check.ps1') -HostPath $hostExe -Version $Version -SourceCommit $sourceCommit
if (!$?) { throw 'Windows host metadata verification failed' }
$object = Join-Path $output 'Product.wixobj'
$msi = Join-Path $output ('GORIQRemoteLite-' + $Version + '.msi')
# Stable identity for one architecture/version: rebuilding the same version
# cannot register a second product over the first product's files.
$codeDigest = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes("GORIQRemoteLite-x64-per-user-$Version"))
$productCode = ([guid]::new([byte[]]$codeDigest[0..15])).ToString('B').ToUpperInvariant()
& (Join-Path $tools 'candle.exe') -nologo -wx -arch x64 "-dProductCode=$productCode" "-dProductVersion=$Version" "-dHostExecutable=$hostExe" "-dGoLicense=$goLicense" -out $object (Join-Path $app 'installer/Product.wxs')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
& (Join-Path $tools 'light.exe') -nologo -wx -out $msi $object
if ($LASTEXITCODE -ne 0) { throw 'Installer linking/validation failed' }
& (Join-Path $staging 'scripts/remote-lite-windows-package-check.ps1') -MsiPath $msi -ExpectedVersion $Version
if (!$?) { throw 'MSI verification failed' }
Copy-Item -LiteralPath $goLicense -Destination (Join-Path $output 'GO_LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $staging 'docs/remote-lite/START_HERE_JA.md') -Destination (Join-Path $output 'START_HERE_JA.md')
[ordered]@{ version = $Version; productCode = $productCode; distributable = $false; signing = 'UNSIGNED_CANDIDATE';
    sourceCommit = $sourceCommit; sourceRepository = 'https://github.com/haji84/AI-';
    resourceGenerator = 'github.com/josephspurrier/goversioninfo@v1.5.0';
    acceptance = 'PHYSICAL_PUBLIC_SIGNING_PENDING';
    msi = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash;
    host = (Get-FileHash -LiteralPath $hostExe -Algorithm SHA256).Hash } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'candidate.json') -Encoding utf8
$inventory = @(('GORIQRemoteLite-' + $Version + '.msi'), 'GORIQRemoteLite.exe', 'GO_LICENSE.txt', 'START_HERE_JA.md', 'candidate.json')
$hashes = foreach ($name in $inventory) { (Get-FileHash -LiteralPath (Join-Path $output $name) -Algorithm SHA256).Hash + '  ' + $name }
$hashes | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding utf8
Write-Output "Built unsigned candidate: $msi"
