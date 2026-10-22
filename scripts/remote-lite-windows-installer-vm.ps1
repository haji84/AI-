param(
    [Parameter(Mandatory)][string]$FirstMsi,
    [Parameter(Mandatory)][string]$RebuiltMsi,
    [Parameter(Mandatory)][string]$UpgradeMsi,
    [Parameter(Mandatory)][string]$FirstHost,
    [Parameter(Mandatory)][string]$UpgradeHost
)
$ErrorActionPreference = 'Stop'
# Never run installer acceptance against the owner's development PC/profile.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Installer mutations require a disposable GitHub-hosted Windows VM'
}
$first = (Resolve-Path -LiteralPath $FirstMsi).Path
$rebuilt = (Resolve-Path -LiteralPath $RebuiltMsi).Path
$upgrade = (Resolve-Path -LiteralPath $UpgradeMsi).Path
$firstHash = (Get-FileHash -LiteralPath $FirstHost -Algorithm SHA256).Hash
$upgradeHash = (Get-FileHash -LiteralPath $UpgradeHost -Algorithm SHA256).Hash
if ($firstHash -eq $upgradeHash) { throw 'Upgrade test requires different real host binaries' }
& (Join-Path $PSScriptRoot 'remote-lite-windows-package-check.ps1') -MsiPath $first
& (Join-Path $PSScriptRoot 'remote-lite-windows-package-check.ps1') -MsiPath $rebuilt
& (Join-Path $PSScriptRoot 'remote-lite-windows-package-check.ps1') -MsiPath $upgrade
function Msi-Property([string]$Path, [string]$Name) {
    if ($Name -notin @('ProductCode', 'ProductVersion')) { throw 'Unknown MSI property' }
    $engine = New-Object -ComObject WindowsInstaller.Installer
    $database = $engine.OpenDatabase($Path, 0)
    $query = 'SELECT `Value` FROM `Property` WHERE `Property`=' + "'$Name'"
    $view = $database.OpenView($query)
    [void]$view.Execute()
    try { ($view.Fetch()).StringData(1) } finally { [void]$view.Close() }
}
$firstCode = Msi-Property $first 'ProductCode'
$upgradeCode = Msi-Property $upgrade 'ProductCode'
if ($firstCode -notmatch '^\{[A-F0-9-]{36}\}$' -or $upgradeCode -notmatch '^\{[A-F0-9-]{36}\}$' -or $firstCode -eq $upgradeCode) {
    throw 'Invalid or identical candidate product IDs'
}
if ((Msi-Property $rebuilt 'ProductCode') -ne $firstCode -or (Msi-Property $rebuilt 'ProductVersion') -ne '0.1.0') {
    throw 'Same-version rebuild created a second product identity'
}
if ((Msi-Property $first 'ProductVersion') -ne '0.1.0' -or (Msi-Property $upgrade 'ProductVersion') -ne '0.1.1') {
    throw 'Unexpected acceptance versions'
}
$installed = Join-Path $env:LOCALAPPDATA 'Programs/GORIQ Remote Lite'
$identity = Join-Path $env:LOCALAPPDATA 'GORIQ Remote Lite'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'GORIQ Remote Lite/GORIQ Remote Lite.lnk'
$registry = 'HKCU:\Software\GORIQRemoteLiteInstaller'
foreach ($path in @($installed, $identity, $shortcut, $registry)) {
    if (Test-Path -LiteralPath $path) { throw 'Preexisting state found; refusing to overwrite it' }
}
New-Item -ItemType Directory -Path $identity | Out-Null
$identityMarker = Join-Path $identity 'enrollment.json'
Set-Content -LiteralPath $identityMarker -Value '{"fixture":"not-a-device-credential"}' -Encoding utf8
$identityHash = (Get-FileHash -LiteralPath $identityMarker -Algorithm SHA256).Hash
function Invoke-Msi([string[]]$Arguments, [string]$Stage, [int[]]$AllowedCodes = @(0)) {
    $log = Join-Path $env:RUNNER_TEMP ('remote-lite-msi-' + $Stage + '.log')
    $argumentsWithLog = $Arguments + @('/qn', '/norestart', '/l*v', ('"' + $log + '"'))
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/msiexec.exe') -ArgumentList $argumentsWithLog -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -notin $AllowedCodes) { throw "MSI $Stage failed with exit $($process.ExitCode); inspect the VM log" }
}
function Assert-IdentityRetained {
    if (!(Test-Path -LiteralPath $identityMarker) -or
        (Get-FileHash -LiteralPath $identityMarker -Algorithm SHA256).Hash -ne $identityHash) {
        throw 'Installer changed or removed device identity state'
    }
}
function Assert-Installed([string]$ExpectedHash) {
    $binary = Join-Path $installed 'GORIQRemoteLite.exe'
    if (!(Test-Path -LiteralPath $binary) -or (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash -ne $ExpectedHash -or
        !(Test-Path -LiteralPath $shortcut) -or !(Test-Path -LiteralPath (Join-Path $installed 'GO_LICENSE.txt'))) {
        throw 'Installed payload, shortcut or notice mismatch'
    }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    if ($link.TargetPath -ne $binary -or $link.Arguments) { throw 'Shortcut does not start exactly the manual host' }
    Assert-IdentityRetained
}
Invoke-Msi -Arguments @('/i', ('"' + $first + '"')) -Stage 'install'
Assert-Installed $firstHash
# Windows Installer may refuse a rebuilt package as1638 (another package for
# this product already installed) or enter maintenance. It must not register
# another ProductCode or change the payload/identity.
Invoke-Msi -Arguments @('/i', ('"' + $rebuilt + '"')) -Stage 'same-version' -AllowedCodes @(0,1638)
Assert-Installed $firstHash
# A real repair must restore a corrupted candidate file, without executing it.
[IO.File]::WriteAllText((Join-Path $installed 'GORIQRemoteLite.exe'), 'VM repair fixture')
Invoke-Msi -Arguments @('/fa', ('"' + $first + '"')) -Stage 'repair'
Assert-Installed $firstHash
Invoke-Msi -Arguments @('/i', ('"' + $upgrade + '"')) -Stage 'upgrade'
Assert-Installed $upgradeHash
$foreignMarker = Join-Path $installed 'keep-user-file.txt'
Set-Content -LiteralPath $foreignMarker -Value 'VM-owned foreign file; not an installer component'
Invoke-Msi -Arguments @('/x', $upgradeCode) -Stage 'uninstall'
Assert-IdentityRetained
if ((Test-Path -LiteralPath (Join-Path $installed 'GORIQRemoteLite.exe')) -or
    (Test-Path -LiteralPath $shortcut) -or (Test-Path -LiteralPath $registry) -or
    !(Test-Path -LiteralPath $foreignMarker)) { throw 'Uninstall removed foreign data or retained installed components' }
Write-Output 'PASS real per-user MSI install, same-version rebuild, corrupted-file repair, version upgrade and uninstall; registration and foreign files retained'
# No recursive removal. Delete only the two fixture files created above.
Remove-Item -LiteralPath $foreignMarker
Remove-Item -LiteralPath $identityMarker
Remove-Item -LiteralPath $installed
Remove-Item -LiteralPath $identity
