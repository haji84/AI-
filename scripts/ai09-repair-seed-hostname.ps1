# Issue #1798: repair one reviewed hostname literal on the existing seed. Never create or format media.
[CmdletBinding()]
param(
    [ValidateSet('Verify', 'Execute')][string]$Mode = 'Verify',
    [switch]$GuestUnmountConfirmed
)
$ErrorActionPreference = 'Stop'

function Get-Ai09RepairHash {
    param([byte[]]$Bytes)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($Bytes))).Replace('-', '') }
    finally { $hasher.Dispose() }
}

function ConvertTo-Ai09RepairedScript {
    param([byte[]]$Bytes)
    if ((Get-Ai09RepairHash $Bytes) -ne 'C2C1B80DFFDE73BBAAB1B3F54BCCCA90E03CEE208CBC1EFD4BB03B0444BDCCA8') { throw 'ORIGINAL_SCRIPT_HASH_MISMATCH' }
    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    $text = $utf8.GetString($Bytes)
    $old = '[[ "$(hostname)" = 8484 ]]'
    $new = '[[ "$(hostname)" = 848484 ]]'
    if ([regex]::Matches($text, [regex]::Escape($old)).Count -ne 1) { throw 'EXACTLY_ONE_HOSTNAME_GUARD_REQUIRED' }
    $result = $utf8.GetBytes($text.Replace($old, $new))
    if ((Get-Ai09RepairHash $result) -ne '0306204EB6D8DFDD8C659938A6C92373A8CD89B659017F269FBF6C34DEE85A33') { throw 'REPAIRED_SCRIPT_HASH_MISMATCH' }
    return ,$result
}

function Read-Ai09RepairStream {
    param([IO.Stream]$Stream)
    if ($Stream.Length -gt 1MB) { throw 'SCRIPT_TOO_LARGE' }
    $Stream.Position = 0
    $bytes = New-Object byte[] ([int]$Stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $count = $Stream.Read($bytes, $offset, $bytes.Length - $offset)
        if ($count -le 0) { throw 'INCOMPLETE_SCRIPT_READ' }
        $offset += $count
    }
    if ($Stream.ReadByte() -ne -1) { throw 'SCRIPT_CHANGED_DURING_READ' }
    return ,$bytes
}

function Assert-Ai09RepairFile {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'UNSAFE_REPAIR_FILE' }
}

function Read-Ai09RepairScript {
    param([string]$Root)
    $path = Join-Path $Root 'bridge.sh'
    Assert-Ai09RepairFile $path
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try { return ,(Read-Ai09RepairStream $stream) }
    finally { $stream.Dispose() }
}

function Assert-Ai09RepairRun {
    param([object]$Scope, [string]$Root)
    $id = [Text.UTF8Encoding]::new($false, $true).GetString((Read-Ai09BoundedSeedFile -Root $Root -Name 'seed.id')).TrimEnd([char[]]"`r`n")
    if ($id -ne $Scope.RunId) { throw 'SEED_RUN_ID_MISMATCH' }
    $receipts = @(Get-ChildItem -LiteralPath $Root -Force -ErrorAction Stop |
        Where-Object { $_.Name -in @('ai09-result.txt', 'ai09-stdout.txt', 'ai09-stderr.txt') })
    if ($receipts.Count) { throw 'GUEST_RECEIPTS_ALREADY_EXIST_REPAIR_REFUSED' }
}

function Get-Ai09WritableRepairRoot {
    param([object]$Scope, [object]$Mounted)
    $vhd = Get-Ai09CollectionVhd $Scope
    if (-not $vhd.Attached -or -not $Mounted.Attached -or $Mounted.Path -ne $Scope.SeedPath -or
        [string]$Mounted.DiskIdentifier -ne $Scope.DiskIdentifier -or $Mounted.DiskNumber -ne $vhd.DiskNumber) { throw 'SEED_MOUNT_IDENTITY_MISMATCH' }
    $disk = Get-Disk -Number $vhd.DiskNumber -ErrorAction Stop
    $systemDisk = @(Get-Partition -DriveLetter C | Get-Disk)
    if (@($disk).Count -ne 1 -or $systemDisk.Count -ne 1 -or $disk.Number -eq $systemDisk[0].Number -or
        $disk.Number -ne $vhd.DiskNumber -or $disk.UniqueId -ne $Scope.UniqueId -or
        $disk.Size -ne 256MB -or $disk.IsBoot -or $disk.IsSystem -or $disk.IsReadOnly -or $disk.IsOffline -or
        [string]$disk.PartitionStyle -ne 'MBR' -or [uint32]$disk.Signature -ne $Scope.Signature) { throw 'SEED_NOT_EXPECTED_WRITABLE_DISK' }
    $parts = @(Get-Partition -DiskNumber $disk.Number)
    if ($parts.Count -ne 1 -or $parts[0].DiskNumber -ne $disk.Number -or $parts[0].PartitionNumber -ne 1 -or
        [string]$parts[0].DriveLetter -notmatch '^[A-Za-z]$') { throw 'SEED_PARTITION_MISMATCH' }
    $volume = Get-Volume -Partition $parts[0]
    if (@($volume).Count -ne 1 -or [string]$volume.FileSystem -ne 'FAT32' -or $volume.FileSystemLabel -ne 'AI09SEED' -or
        $volume.DriveLetter -ne $parts[0].DriveLetter) { throw 'SEED_VOLUME_MISMATCH' }
    $letter = [string]$volume.DriveLetter
    $logical = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $letter + ":'")
    if (@($logical).Count -ne 1 -or ([string]$logical.VolumeSerialNumber).ToUpperInvariant() -ne $Scope.FileSystemUuid.Replace('-', '')) { throw 'SEED_FAT_UUID_MISMATCH' }
    return $letter + ':\'
}

function Invoke-Ai09RepairMount {
    param([object]$Scope, [switch]$Writable, [scriptblock]$Action)
    $null = Assert-Ai09CollectionEnvironment -Scope $Scope -SeedAttached $false
    if ((Get-Ai09CollectionVhd $Scope).Attached) { throw 'SEED_IN_USE_DO_NOT_MOUNT' }
    $attempted = $false; $operationFailure = $null
    try {
        $attempted = $true
        $mounted = Mount-VHD -Path $Scope.SeedPath -ReadOnly:(-not $Writable) -PassThru -ErrorAction Stop
        $root = if ($Writable) { Get-Ai09WritableRepairRoot -Scope $Scope -Mounted $mounted }
            else { Get-Ai09ReadOnlySeedRoot -Scope $Scope -Mounted $mounted }
        Assert-Ai09RepairRun -Scope $Scope -Root $root
        & $Action $root $mounted
    } catch { $operationFailure = $_; throw }
    finally {
        if ($attempted) {
            try {
                # Ownership starts only after observing this exact VHD detached from the VM and host.
                Assert-Ai09SeedDetachedFromVm $Scope
                if ((Get-Ai09CollectionVhd $Scope).Attached) { Dismount-VHD -Path $Scope.SeedPath -ErrorAction Stop }
                if ((Get-Ai09CollectionVhd $Scope).Attached) { throw 'HOST_DISMOUNT_UNCONFIRMED_MANUAL_INSPECTION_REQUIRED' }
            } catch { throw "REPAIR_CLEANUP_FAILED: $($_.Exception.Message); ORIGINAL_FAILURE: $operationFailure" }
        }
    }
}

function Write-Ai09RepairNewFile {
    param([string]$Path, [byte[]]$Bytes)
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}

function Save-Ai09RepairBackup {
    param([string]$Directory, [byte[]]$Original)
    if ((Get-Ai09RepairHash $Original) -ne 'C2C1B80DFFDE73BBAAB1B3F54BCCCA90E03CEE208CBC1EFD4BB03B0444BDCCA8') { throw 'BACKUP_SOURCE_HASH_MISMATCH' }
    Assert-Ai09Path $Directory
    if (Test-Path -LiteralPath $Directory) { throw 'BACKUP_DIRECTORY_EXISTS' }
    New-Item -Path $Directory -ItemType Directory -ErrorAction Stop | Out-Null
    Assert-Ai09Path $Directory
    $path = Join-Path $Directory 'bridge.sh.original'
    Write-Ai09RepairNewFile -Path $path -Bytes $Original
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne 'C2C1B80DFFDE73BBAAB1B3F54BCCCA90E03CEE208CBC1EFD4BB03B0444BDCCA8') { throw 'BACKUP_HASH_MISMATCH' }
}

function Set-Ai09RepairScript {
    param([object]$Scope, [string]$Root, [object]$Mounted)
    $path = Join-Path $Root 'bridge.sh'
    Assert-Ai09RepairFile $path
    # Re-read and hash the final exclusive handle. Never write based on an earlier path read.
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $null = Assert-Ai09CollectionEnvironment -Scope $Scope -SeedAttached $false
        if ((Get-Ai09WritableRepairRoot -Scope $Scope -Mounted $Mounted) -ne $Root) { throw 'SEED_ROOT_CHANGED' }
        Assert-Ai09RepairRun -Scope $Scope -Root $Root
        $bytes = ConvertTo-Ai09RepairedScript (Read-Ai09RepairStream $stream)
        $stream.Position = 0
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.SetLength($bytes.Length)
        $stream.Flush($true)
        if ((Get-Ai09RepairHash (Read-Ai09RepairStream $stream)) -ne '0306204EB6D8DFDD8C659938A6C92373A8CD89B659017F269FBF6C34DEE85A33') { throw 'REPAIR_WRITE_VERIFICATION_FAILED' }
    } finally { $stream.Dispose() }
}

function Save-Ai09RepairStatus {
    param([object]$Scope, [string]$Directory, [string]$Phase, [bool]$Success, [string]$Failure)
    Assert-Ai09Path $Directory
    $result = [pscustomobject]@{
        Status = $(if ($Success) { 'HOSTNAME_GUARD_REPAIRED_REATTACHED_GUEST_NOT_EXECUTED' } else { 'REPAIR_FAILED_MANUAL_INSPECTION_REQUIRED' })
        Phase = $Phase; HostRecordedAt = [DateTimeOffset]::UtcNow.ToString('o'); Failure = $Failure
        VmId = $Scope.VmId; SeedPath = $Scope.SeedPath; DiskIdentifier = $Scope.DiskIdentifier
        UniqueId = $Scope.UniqueId; FileSystemUuid = $Scope.FileSystemUuid; PartitionUuid = '703b5247-01'; RunId = $Scope.RunId
        OriginalSha256 = 'C2C1B80DFFDE73BBAAB1B3F54BCCCA90E03CEE208CBC1EFD4BB03B0444BDCCA8'
        RepairedSha256 = '0306204EB6D8DFDD8C659938A6C92373A8CD89B659017F269FBF6C34DEE85A33'
        BackupDirectory = $Directory; GuestExecuted = $false; SshVerified = $false
    }
    $name = if ($Success) { 'repair-success.json' } else { 'repair-failure.json' }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($result | ConvertTo-Json -Depth 4))
    Write-Ai09RepairNewFile -Path (Join-Path $Directory $name) -Bytes $bytes
    return $result
}

function Invoke-Ai09SeedHostnameRepair {
    param([ValidateSet('Verify', 'Execute')][string]$Mode = 'Verify', [switch]$GuestUnmountConfirmed)
    if ($Mode -eq 'Execute' -and -not $GuestUnmountConfirmed) { throw 'EXPLICIT_GUEST_UNMOUNT_CONFIRMATION_REQUIRED' }
    $scope = Get-Ai09CollectionScope
    $null = Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true
    $null = Get-Ai09CollectionVhd $scope
    if ($Mode -eq 'Verify') {
        return [pscustomobject]@{ Status = 'READ_ONLY_REPAIR_PREFLIGHT'; RunId = $scope.RunId
            SeedPath = $scope.SeedPath; GuestUnmountConfirmed = [bool]$GuestUnmountConfirmed; GuestFilesInspected = $false }
    }
    Assert-Ai09Administrator
    $seed = @(Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true)
    $null = Get-Ai09CollectionVhd $scope
    $phase = 'DETACH'; $backupDirectory = $null
    try {
        Remove-VMHardDiskDrive -VMHardDiskDrive $seed[0] -ErrorAction Stop
        $phase = 'READ_ONLY_INSPECTION'
        $original = Invoke-Ai09RepairMount -Scope $scope -Action {
            param($root, $mounted)
            $bytes = Read-Ai09RepairScript -Root $root
            $null = ConvertTo-Ai09RepairedScript $bytes
            return ,$bytes
        }
        $phase = 'BACKUP'
        $null = Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
        if ((Get-Ai09CollectionVhd $scope).Attached) { throw 'HOST_DISMOUNT_UNCONFIRMED_MANUAL_INSPECTION_REQUIRED' }
        $backupDirectory = 'C:\GORIQ-AI09\Reports\hostname-repair-' + $scope.RunId + '-' + [guid]::NewGuid().ToString('N')
        Save-Ai09RepairBackup -Directory $backupDirectory -Original $original
        $phase = 'WRITE'
        $null = Invoke-Ai09RepairMount -Scope $scope -Writable -Action {
            param($root, $mounted)
            Set-Ai09RepairScript -Scope $scope -Root $root -Mounted $mounted
        }
        $phase = 'REATTACH'
        $null = Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
        if ((Get-Ai09CollectionVhd $scope).Attached) { throw 'HOST_DISMOUNT_UNCONFIRMED_MANUAL_INSPECTION_REQUIRED' }
        Add-VMHardDiskDrive -VMName $scope.VmName -ControllerType SCSI -ControllerNumber 0 -ControllerLocation 2 -Path $scope.SeedPath -ErrorAction Stop
        $null = Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true
        $null = Get-Ai09CollectionVhd $scope
        return Save-Ai09RepairStatus -Scope $scope -Directory $backupDirectory -Phase 'VERIFIED_REATTACHMENT' -Success $true
    } catch {
        $failure = $_
        if ($backupDirectory -and (Test-Path -LiteralPath $backupDirectory)) {
            try { $null = Save-Ai09RepairStatus -Scope $scope -Directory $backupDirectory -Phase $phase -Success $false -Failure $failure.Exception.Message }
            catch { Write-Warning ("Failure receipt unavailable at " + $backupDirectory + ": " + $_.Exception.Message) }
        }
        throw $failure
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $locks = [Collections.Generic.List[IO.FileStream]]::new()
    try {
        # Both helper handles remain locked while loading and using their functions.
        $repairMode = $Mode; $repairConfirmation = $GuestUnmountConfirmed
        $helpers = @(
            @{ Name = 'ai09-prepare-bootstrap-disk.ps1'; Hash = 'E6E7B482E112609749C6982F051B1D35842EEE51FCDC563F4E9408B1D3C15B6B' },
            @{ Name = 'ai09-collect-bootstrap-result.ps1'; Hash = '6A0E4D4264825A8D38C749F74BF9706FCCD39B59BDF8CF22CB8BFD3B6975F391' }
        )
        foreach ($helper in $helpers) {
            $path = Join-Path $PSScriptRoot $helper.Name
            $handle = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            $locks.Add($handle)
            $hasher = [Security.Cryptography.SHA256]::Create()
            try { $hash = ([BitConverter]::ToString($hasher.ComputeHash($handle))).Replace('-', '') }
            finally { $hasher.Dispose() }
            if ($hash -ne $helper.Hash) { throw ('REPAIR_HELPER_HASH_MISMATCH: ' + $helper.Name) }
        }
        foreach ($helper in $helpers) { . (Join-Path $PSScriptRoot $helper.Name) }
        Invoke-Ai09SeedHostnameRepair -Mode $repairMode -GuestUnmountConfirmed:$repairConfirmation | ConvertTo-Json -Depth 5
    } catch { Write-Error $_; exit 1 }
    finally { foreach ($handle in $locks) { $handle.Dispose() } }
}
