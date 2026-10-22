param([Parameter(Mandatory)][string]$MsiPath)
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
$summary = $database.SummaryInformation(0)
if (([int]$summary.Property(15) -band 8) -eq 0) { throw 'MSI requests elevated installation' }
$tables = @(Read-MsiRows 'SELECT `Name` FROM `_Tables`' | ForEach-Object { $_[0] })
if ('CustomAction' -in $tables) {
    if (@(Read-MsiRows 'SELECT `Action` FROM `CustomAction`').Count) { throw 'Unexpected executable custom action' }
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
if (($files -join ',') -ne 'GO_LICENSE.txt,GORIQRemoteLite.exe') { throw 'Unexpected payload or missing Go notice' }
foreach ($row in @(Read-MsiRows 'SELECT `Root`, `Key` FROM `Registry`')) {
    if ($row[0] -ne '1' -or $row[1] -ne 'Software\GORIQRemoteLiteInstaller') { throw 'Unexpected registry scope' }
}
$directories = @(Read-MsiRows 'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`')
if (!($directories | Where-Object { $_[0] -eq 'RemoteLitePrograms' -and $_[1] -eq 'LocalAppDataFolder' -and $_[2] -eq 'Programs' })) {
    throw 'Install root is outside the current user local application data'
}
if (!($directories | Where-Object { $_[0] -eq 'RemoteLiteInstallFolder' -and $_[1] -eq 'RemoteLitePrograms' -and ($_[2] -split '\|')[-1] -eq 'GORIQ Remote Lite' })) {
    throw 'Install directory mismatch'
}
Write-Output 'PASS MSI metadata: per-user, no elevation/custom actions, exact manual-host payload and user registry'
