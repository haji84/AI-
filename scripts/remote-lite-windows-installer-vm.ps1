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
$licenseHash = (Get-FileHash -LiteralPath (Join-Path (Split-Path -Parent $first) 'REMOTE_LITE_LICENSE.txt') -Algorithm SHA256).Hash
if ((Get-FileHash -LiteralPath (Join-Path (Split-Path -Parent $upgrade) 'REMOTE_LITE_LICENSE.txt') -Algorithm SHA256).Hash -ne $licenseHash) {
    throw 'Same-source test versions must contain the same approved license'
}
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
$machinePaths = @(
    (Join-Path $env:ProgramFiles 'GORIQ Remote Lite'),
    (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'GORIQ Remote Lite'),
    'HKLM:\Software\GORIQRemoteLiteInstaller',
    ('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $firstCode)
)
foreach ($path in @($installed, $identity, $shortcut, $registry) + $machinePaths) {
    if (Test-Path -LiteralPath $path) { throw 'Preexisting state found; refusing to overwrite it' }
}
New-Item -ItemType Directory -Path $identity | Out-Null
$identityMarker = Join-Path $identity 'enrollment.json'
Set-Content -LiteralPath $identityMarker -Value '{"fixture":"not-a-device-credential"}' -Encoding utf8
$identityHash = (Get-FileHash -LiteralPath $identityMarker -Algorithm SHA256).Hash
function Invoke-Msi([string[]]$Arguments, [string]$Stage, [int[]]$AllowedCodes = @(0), [switch]$ScopeRejection) {
    $log = Join-Path $env:RUNNER_TEMP ('remote-lite-msi-' + $Stage + '.log')
    $argumentsWithLog = $Arguments + @('/qn', '/norestart', '/l*v', ('"' + $log + '"'))
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/msiexec.exe') -ArgumentList $argumentsWithLog -WindowStyle Hidden -Wait -PassThru
    $script:lastMsiLog = $log
    Write-Output "MSI stage=$Stage exit=$($process.ExitCode)"
    if ($process.ExitCode -notin $AllowedCodes) { throw "MSI $Stage failed with exit $($process.ExitCode); inspect the VM log" }
    if ($ScopeRejection) {
        $contents = Get-Content -LiteralPath $log -Raw
        if (!$contents.Contains('このインストーラーは現在のユーザー専用です。')) {
            throw 'Machine override did not fail at the intended scope condition'
        }
    }
}
function Assert-IdentityRetained {
    if (!(Test-Path -LiteralPath $identityMarker) -or
        (Get-FileHash -LiteralPath $identityMarker -Algorithm SHA256).Hash -ne $identityHash) {
        throw 'Installer changed or removed device identity state'
    }
}
$engine = New-Object -ComObject WindowsInstaller.Installer
function Assert-ProductRegistration([string]$Code, [bool]$Expected) {
    # Products is not reliably exposed as a PowerShell COM property. ProductsEx
    # is an explicit method, and positive lifecycle checks calibrate this read.
    $products = @($engine.ProductsEx($Code, '', 7))
    if ($Expected) {
        if ($products.Count -ne 1 -or $products[0].ProductCode() -ne $Code) {
            throw 'Expected exactly one installed product registration'
        }
    } elseif ($products.Count -ne 0) { throw 'Unexpected product registration remains' }
}
function Assert-Installed([string]$ExpectedHash) {
    $binary = Join-Path $installed 'GORIQRemoteLite.exe'
    $binaryExists = Test-Path -LiteralPath $binary
    $hashMatches = $binaryExists -and (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash -eq $ExpectedHash
    $shortcutExists = Test-Path -LiteralPath $shortcut
    $noticeExists = Test-Path -LiteralPath (Join-Path $installed 'GO_LICENSE.txt')
    $licensePath = Join-Path $installed 'REMOTE_LITE_LICENSE.txt'
    $licenseMatches = (Test-Path -LiteralPath $licensePath) -and (Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash -eq $licenseHash
    if (!$binaryExists -or !$hashMatches -or !$shortcutExists -or !$noticeExists -or !$licenseMatches) {
        Write-Output "MSI payload: binary=$binaryExists hash=$hashMatches shortcut=$shortcutExists notice=$noticeExists"
        # Disposable runner paths and installation scope only; never dump the
        # full log, environment or retained enrollment data.
        Select-String -LiteralPath $script:lastMsiLog -Pattern '^Property\([CS]\): (ALLUSERS|MSIINSTALLPERUSER|ProgramFiles64Folder|RemoteLiteInstallFolder|ProgramMenuFolder|RemoteLiteMenuFolder|LocalAppDataFolder) = ' |
            ForEach-Object { Write-Output $_.Line }
        throw 'Installed payload, shortcut or notice mismatch'
    }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    if ($link.TargetPath -ne $binary -or $link.Arguments) { throw 'Shortcut does not start exactly the manual host' }
    Assert-IdentityRetained
}
# Both overrides must reach the scope condition and fail before any payload,
# registration or shared Start Menu entry is installed. The VM is disposable;
# never run these adversarial command lines against an owner profile.
Invoke-Msi -Arguments @('/i', ('"' + $first + '"'), 'ALLUSERS=1') -Stage 'reject-machine' -AllowedCodes @(1603) -ScopeRejection
Invoke-Msi -Arguments @('/i', ('"' + $first + '"'), 'ALLUSERS=2', 'MSIINSTALLPERUSER=""') -Stage 'reject-machine-fallback' -AllowedCodes @(1603) -ScopeRejection
foreach ($path in @($installed, $shortcut, $registry) + $machinePaths) {
    if (Test-Path -LiteralPath $path) { throw 'Rejected machine override changed installation state' }
}
Assert-ProductRegistration $firstCode $false
Assert-IdentityRetained
Invoke-Msi -Arguments @('/i', ('"' + $first + '"')) -Stage 'install'
Assert-Installed $firstHash
Assert-ProductRegistration $firstCode $true
# Windows Installer may refuse a rebuilt package as1638 (another package for
# this product already installed) or enter maintenance. It must not register
# another ProductCode or change the payload/identity.
Invoke-Msi -Arguments @('/i', ('"' + $rebuilt + '"')) -Stage 'same-version' -AllowedCodes @(0,1638)
Assert-Installed $firstHash
Assert-ProductRegistration $firstCode $true
# A real repair must restore a corrupted candidate file, without executing it.
[IO.File]::WriteAllText((Join-Path $installed 'GORIQRemoteLite.exe'), 'VM repair fixture')
[IO.File]::WriteAllText((Join-Path $installed 'REMOTE_LITE_LICENSE.txt'), 'VM repair fixture')
Invoke-Msi -Arguments @('/fa', ('"' + $first + '"')) -Stage 'repair'
Assert-Installed $firstHash
Invoke-Msi -Arguments @('/i', ('"' + $upgrade + '"')) -Stage 'upgrade'
Assert-Installed $upgradeHash
Assert-ProductRegistration $firstCode $false
Assert-ProductRegistration $upgradeCode $true
$foreignMarker = Join-Path $installed 'keep-user-file.txt'
Set-Content -LiteralPath $foreignMarker -Value 'VM-owned foreign file; not an installer component'
Invoke-Msi -Arguments @('/x', $upgradeCode) -Stage 'uninstall'
Assert-IdentityRetained
if ((Test-Path -LiteralPath (Join-Path $installed 'GORIQRemoteLite.exe')) -or
    (Test-Path -LiteralPath (Join-Path $installed 'REMOTE_LITE_LICENSE.txt')) -or
    (Test-Path -LiteralPath (Join-Path $installed 'GO_LICENSE.txt')) -or
    (Test-Path -LiteralPath $shortcut) -or (Test-Path -LiteralPath $registry) -or
    !(Test-Path -LiteralPath $foreignMarker)) { throw 'Uninstall removed foreign data or retained installed components' }
foreach ($path in $machinePaths) {
    if (Test-Path -LiteralPath $path) { throw 'Per-user lifecycle changed machine-wide state' }
}
Assert-ProductRegistration $firstCode $false
Assert-ProductRegistration $upgradeCode $false
Write-Output 'PASS machine overrides rejected; real per-user MSI install, same-version rebuild, corrupted-file repair, version upgrade and uninstall; MIT notice bytes verified; identity and foreign files retained'
# No recursive removal. Delete only the two fixture files created above.
Remove-Item -LiteralPath $foreignMarker
Remove-Item -LiteralPath $identityMarker
Remove-Item -LiteralPath $installed
Remove-Item -LiteralPath $identity
