param([Parameter(Mandatory)][string]$MsiPath, [string]$ExpectedVersion)
$ErrorActionPreference = 'Stop'

# Read MSI tables only. This check never installs, launches, or removes an app.
$msi = (Resolve-Path -LiteralPath $MsiPath).Path
$engine = New-Object -ComObject WindowsInstaller.Installer
$database = $engine.OpenDatabase($msi, 0)
function Read-MsiRows([string]$Query) {
    $view = $database.OpenView($Query)
    [void]$view.Execute()
    try {
        while ($record = $view.Fetch()) {
            $values = for ($column = 1; $column -le $record.FieldCount(); $column++) { $record.StringData($column) }
            ,@($values)
        }
    } finally { [void]$view.Close() }
}
$properties = @{}
Read-MsiRows 'SELECT `Property`, `Value` FROM `Property`' | ForEach-Object { $properties[$_[0]] = $_[1] }
if ($properties.ProductName -ne 'GORIQ Remote Lite Candidate' -or $properties.ALLUSERS) {
    throw 'Wrong product or machine-wide installation scope'
}
if ($ExpectedVersion -and $properties.ProductVersion -cne $ExpectedVersion) { throw 'MSI product version mismatch' }
if ($ExpectedVersion) {
    $hostRows = @(Read-MsiRows 'SELECT `File`, `Version` FROM `File`' | Where-Object { $_[0] -eq 'HostExecutable' })
    if ($hostRows.Count -ne 1 -or $hostRows[0][1] -cne "$ExpectedVersion.0") {
        throw 'MSI embedded host file version mismatch'
    }
}
$conditions = @(Read-MsiRows 'SELECT `Condition` FROM `LaunchCondition`' | ForEach-Object { $_[0] })
if ('NOT ALLUSERS' -notin $conditions) { throw 'Missing rejection of machine-wide overrides' }
foreach ($sequence in @('InstallUISequence', 'InstallExecuteSequence')) {
    $actions = @{}
    $actionConditions = @{}
    Read-MsiRows ('SELECT `Action`, `Sequence`, `Condition` FROM `' + $sequence + '`') | ForEach-Object {
        $actions[$_[0]] = [int]$_[1]
        $actionConditions[$_[0]] = $_[2]
    }
    if (!$actions.LaunchConditions -or $actions.LaunchConditions -ge $actions.CostInitialize) {
        throw 'Machine-scope rejection must run before costing and installation'
    }
    if (!$actions.SetRemoteLiteInstallFolder -or
        $actions.SetRemoteLiteInstallFolder -le $actions.CostInitialize -or
        $actions.SetRemoteLiteInstallFolder -ge $actions.CostFinalize -or
        $actionConditions.SetRemoteLiteInstallFolder -ne 'NOT ALLUSERS') {
        throw 'Missing enforced per-user directory assignment before final costing'
    }
}
$summary = $database.SummaryInformation(0)
if (([int]$summary.Property(15) -band 8) -eq 0) { throw 'MSI requests elevated installation' }
$tables = @(Read-MsiRows 'SELECT `Name` FROM `_Tables`' | ForEach-Object { $_[0] })
if ('CustomAction' -notin $tables) { throw 'Missing per-user directory assignment' }
$customActions = @(Read-MsiRows 'SELECT `Action`, `Type`, `Source`, `Target` FROM `CustomAction`')
if ($customActions.Count -ne 1 -or $customActions[0][0] -ne 'SetRemoteLiteInstallFolder' -or
    $customActions[0][1] -ne '51' -or $customActions[0][2] -ne 'RemoteLiteInstallFolder' -or
    $customActions[0][3] -ne '[LocalAppDataFolder]Programs\GORIQ Remote Lite\') {
    throw 'Only the exact non-executable per-user directory assignment is allowed'
}
foreach ($name in @('ServiceInstall', 'Environment')) {
    if ($name -in $tables) { throw 'Unexpected service or environment table' }
}
foreach ($row in @(Read-MsiRows 'SELECT `FileName` FROM `RemoveFile`')) {
    if ($row[0]) { throw 'Unexpected wildcard or foreign-file deletion' }
}
$components = @(Read-MsiRows 'SELECT `Component`, `Directory_` FROM `Component`')
if ($components.Count -ne 2 -or
    !($components | Where-Object { $_[0] -eq 'ManualHost' -and $_[1] -eq 'RemoteLiteInstallFolder' }) -or
    !($components | Where-Object { $_[0] -eq 'StartMenu' -and $_[1] -eq 'RemoteLiteMenuFolder' })) {
    throw 'Payload escaped the manual host/menu directories'
}
$files = @(Read-MsiRows 'SELECT `FileName` FROM `File`' | ForEach-Object { ($_[0] -split '\|')[-1] } | Sort-Object)
if (($files -join ',') -ne 'GO_LICENSE.txt,GORIQRemoteLite.exe,REMOTE_LITE_LICENSE.txt') { throw 'Unexpected payload or missing license notice' }
$registryRows = @(Read-MsiRows 'SELECT `Root`, `Key`, `Component_` FROM `Registry`')
if ($registryRows.Count -ne 2) { throw 'Unexpected component registration count' }
foreach ($row in $registryRows) {
    $expectedRoot = if ($row[2] -eq 'ManualHost') { '-1' } elseif ($row[2] -eq 'StartMenu') { '1' } else { 'INVALID' }
    if ($row[0] -ne $expectedRoot -or $row[1] -ne 'Software\GORIQRemoteLiteInstaller') { throw 'Unexpected registry scope' }
}
$directories = @(Read-MsiRows 'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`')
if (!($directories | Where-Object { $_[0] -eq 'ProgramFiles64Folder' -and $_[1] -eq 'TARGETDIR' })) {
    throw 'Missing context-aware program directory'
}
if (!($directories | Where-Object { $_[0] -eq 'RemoteLiteInstallFolder' -and $_[1] -eq 'ProgramFiles64Folder' -and ($_[2] -split '\|')[-1] -eq 'GORIQ Remote Lite' })) {
    throw 'Install directory mismatch'
}
$shortcuts = @(Read-MsiRows 'SELECT `Component_`, `Directory_`, `Target` FROM `Shortcut`')
if ($shortcuts.Count -ne 1 -or $shortcuts[0][0] -ne 'StartMenu' -or
    $shortcuts[0][1] -ne 'RemoteLiteMenuFolder' -or $shortcuts[0][2] -ne '[RemoteLiteInstallFolder]GORIQRemoteLite.exe') {
    throw 'Shortcut must use its user component and the exact installed host path'
}
Write-Output 'PASS MSI metadata: per-user path assignment, no elevation/executable custom actions, exact manual-host payload and user registry'
