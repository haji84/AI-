# Issue #1798: collect only the one seed created on 2026-10-14. No retry or reattachment.
[CmdletBinding()]
param(
    [ValidateSet('Verify', 'Collect')][string]$Mode = 'Verify',
    [switch]$GuestUnmountConfirmed
)
$ErrorActionPreference = 'Stop'

function Get-Ai09CollectionScope {
    return [pscustomobject]@{
        VmName = 'GORIQ-AI09-Ubuntu'; VmId = '453b139b-cceb-446e-99fb-f45bf5895436'
        SeedPath = 'C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx'
        DiskIdentifier = 'BF75A570-C8A6-49A6-82B1-DF4A914E7176'
        UniqueId = '6002248070A575BFA6C8DF4A914E7176'
        FileSystemUuid = 'CA77-6E6C'; Signature = [uint32]0x703b5247
        RunId = '02ea2f0d324543a1ab2973e73c97421d'
        AclSha256 = '0FB015791FB49CFE66935F0558E56827A65B6EA48FD2C2298FA38990C36E6243'
    }
}

function Assert-Ai09CollectionEnvironment {
    param([object]$Scope, [bool]$SeedAttached)
    if ($env:COMPUTERNAME -ne 'HAJI') { throw 'WRONG_HOST' }
    $vm = Get-VM -Name $Scope.VmName -ErrorAction Stop
    if ([string]$vm.Id -ne $Scope.VmId -or [string]$vm.State -ne 'Running') { throw 'VM_IDENTITY_OR_STATE_CHANGED' }
    if (@(Get-Process Runner.Listener -ErrorAction SilentlyContinue).Count -ne 1 -or
        @(Get-Process Runner.Worker -ErrorAction SilentlyContinue).Count -ne 0) { throw 'RUNNER_NOT_IDLE' }
    $drives = @(Get-VMHardDiskDrive -VMName $Scope.VmName)
    $seed = @($drives | Where-Object { $_.Path -eq $Scope.SeedPath })
    $root = @($drives | Where-Object { $_.Path -ne $Scope.SeedPath })
    Assert-Ai09OsDisk $root
    if ($SeedAttached) {
        if ($drives.Count -ne 2 -or $seed.Count -ne 1 -or [string]$seed[0].ControllerType -ne 'SCSI' -or
            $seed[0].ControllerNumber -ne 0 -or $seed[0].ControllerLocation -ne 2) { throw 'EXACT_SEED_ATTACHMENT_REQUIRED' }
    } elseif ($drives.Count -ne 1 -or $seed.Count -ne 0) { throw 'SEED_STILL_VM_ATTACHED' }
    $nics = @(Get-VMNetworkAdapter -VMName $Scope.VmName)
    if ($nics.Count -ne 1 -or $nics[0].SwitchName -ne 'Default Switch' -or $nics[0].MacAddress -ne '00155DDC2C00' -or
        [string]$nics[0].Id -ne 'Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D') { throw 'VM_NIC_CHANGED' }
    $rules = @(Get-VMNetworkAdapterExtendedAcl -VMName $Scope.VmName)
    if ($rules.Count -ne 4 -or (Get-Ai09AclSha256 $rules) -ne $Scope.AclSha256) { throw 'VM_ACL_CHANGED' }
    Assert-Ai09Path $Scope.SeedPath
    return $seed
}

function Assert-Ai09SeedDetachedFromVm {
    param([object]$Scope)
    $attached = @(Get-VMHardDiskDrive -VMName $Scope.VmName | Where-Object { $_.Path -eq $Scope.SeedPath })
    if ($attached.Count -ne 0) { throw 'SEED_STILL_VM_ATTACHED' }
}

function Get-Ai09CollectionVhd {
    param([object]$Scope)
    Assert-Ai09Path $Scope.SeedPath
    $vhd = Get-VHD -Path $Scope.SeedPath -ErrorAction Stop
    if (@($vhd).Count -ne 1 -or $vhd.Path -ne $Scope.SeedPath -or [string]$vhd.DiskIdentifier -ne $Scope.DiskIdentifier -or
        $vhd.Size -ne 256MB -or [string]$vhd.VhdType -ne 'Dynamic' -or [string]$vhd.VhdFormat -ne 'VHDX' -or $vhd.ParentPath) { throw 'SEED_IDENTITY_MISMATCH' }
    return $vhd
}

function Get-Ai09ReadOnlySeedRoot {
    param([object]$Scope, [object]$Mounted)
    $vhd = Get-Ai09CollectionVhd $Scope
    if (-not $vhd.Attached -or -not $Mounted.Attached -or $Mounted.Path -ne $Scope.SeedPath -or
        [string]$Mounted.DiskIdentifier -ne $Scope.DiskIdentifier -or $Mounted.DiskNumber -ne $vhd.DiskNumber) { throw 'SEED_MOUNT_IDENTITY_MISMATCH' }
    $disk = Get-Disk -Number $vhd.DiskNumber -ErrorAction Stop
    $systemDisk = @(Get-Partition -DriveLetter C | Get-Disk)
    if (@($disk).Count -ne 1 -or $systemDisk.Count -ne 1 -or $disk.Number -eq $systemDisk[0].Number -or
        $disk.Number -ne $vhd.DiskNumber -or $disk.UniqueId -ne $Scope.UniqueId -or
        $disk.Size -ne 256MB -or $disk.IsBoot -or $disk.IsSystem -or -not $disk.IsReadOnly -or $disk.IsOffline -or
        [string]$disk.PartitionStyle -ne 'MBR' -or [uint32]$disk.Signature -ne $Scope.Signature) { throw 'SEED_NOT_EXPECTED_READONLY_DISK' }
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

function Read-Ai09BoundedSeedFile {
    param([string]$Root, [string]$Name)
    if ($Name -notin @('seed.id', 'ai09-stdout.txt', 'ai09-stderr.txt', 'ai09-result.txt')) { throw 'UNEXPECTED_RECEIPT_FILE' }
    $path = Join-Path $Root $Name
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'UNSAFE_RECEIPT_FILE' }
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -gt 1MB) { throw 'RECEIPT_FILE_TOO_LARGE' }
        $bytes = New-Object byte[] ([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $count = $stream.Read($bytes, $offset, $bytes.Length - $offset)
            if ($count -le 0) { throw 'INCOMPLETE_RECEIPT_READ' }
            $offset += $count
        }
        if ($stream.ReadByte() -ne -1) { throw 'RECEIPT_CHANGED_DURING_READ' }
        return ,$bytes
    } finally { $stream.Dispose() }
}

function ConvertFrom-Ai09GuestReceipt {
    param([object]$Scope, [hashtable]$Files)
    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    $id = $utf8.GetString($Files['seed.id']).TrimEnd([char[]]"`r`n")
    if ($id -ne $Scope.RunId) { throw 'SEED_RUN_ID_MISMATCH' }
    $text = $utf8.GetString($Files['ai09-result.txt'])
    $pattern = '\ARUN_ID=(?<run>[a-f0-9]{32})\r?\nTIMESTAMP=(?<time>[0-9T:Z-]{20})\r?\nSTATUS=(?<status>FAILED|DIAGNOSTICS_COLLECTED)\r?\nEXIT_CODE=(?<code>[0-9]{1,3})\r?\n?\z'
    if ($text -notmatch $pattern -or $Matches['run'] -ne $Scope.RunId) { throw 'INVALID_GUEST_RECEIPT' }
    $code = [int]$Matches['code']; $status = $Matches['status']; $timestamp = $Matches['time']
    $null = [DateTimeOffset]::ParseExact($timestamp, "yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
    # The offline guest clock is untrusted; validate UTC syntax, not host-clock agreement.
    if ($code -gt 255 -or (($code -eq 0) -ne ($status -eq 'DIAGNOSTICS_COLLECTED'))) { throw 'INVALID_GUEST_RECEIPT_STATUS' }
    return [pscustomobject]@{ RunId = $Scope.RunId; Timestamp = $timestamp; Status = $status; ExitCode = $code }
}

function Write-Ai09CollectedEvidence {
    param([object]$Scope, [hashtable]$Files, [object]$Guest)
    $directory = 'C:\GORIQ-AI09\Reports\bootstrap-' + $Scope.RunId + '-' + [guid]::NewGuid().ToString('N')
    Assert-Ai09Path $directory
    if (Test-Path -LiteralPath $directory) { throw 'COLLECTION_DIRECTORY_EXISTS' }
    New-Item -Path $directory -ItemType Directory -ErrorAction Stop | Out-Null
    Assert-Ai09Path $directory
    $hashes = [ordered]@{}
    foreach ($name in @('seed.id', 'ai09-stdout.txt', 'ai09-stderr.txt', 'ai09-result.txt')) {
        $bytes = [byte[]]$Files[$name]
        $target = Join-Path $directory $name
        $stream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
        finally { $stream.Dispose() }
        $hashes[$name] = [ordered]@{ Bytes = $bytes.Length; Sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash }
    }
    $result = [pscustomobject]@{
        Status = $(if ($Guest.ExitCode -eq 0) { 'GUEST_DIAGNOSTICS_COLLECTED' } else { 'GUEST_BOOTSTRAP_FAILED_EVIDENCE_COLLECTED' })
        CollectorExitCode = 0; GuestExitCode = $Guest.ExitCode; GuestStatus = $Guest.Status
        UntrustedGuestTimestamp = $Guest.Timestamp; HostCollectedAt = [DateTimeOffset]::UtcNow.ToString('o')
        RunId = $Scope.RunId; SeedDiskIdentifier = $Scope.DiskIdentifier; OutputDirectory = $directory
        HostDismounted = $true; SeedReattached = $false; SshVerified = $false
        EvidenceClass = 'UNTRUSTED_GUEST_DIAGNOSTICS'; Files = $hashes
    }
    $json = [Text.UTF8Encoding]::new($false).GetBytes(($result | ConvertTo-Json -Depth 6))
    $stream = [IO.File]::Open((Join-Path $directory 'collection.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($json, 0, $json.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
    return $result
}

function Invoke-Ai09BootstrapCollection {
    param([ValidateSet('Verify', 'Collect')][string]$Mode = 'Verify', [switch]$GuestUnmountConfirmed)
    if ($Mode -eq 'Collect' -and -not $GuestUnmountConfirmed) { throw 'EXPLICIT_GUEST_UNMOUNT_CONFIRMATION_REQUIRED' }
    $scope = Get-Ai09CollectionScope
    $seed = @(Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true)
    $null = Get-Ai09CollectionVhd $scope
    if ($Mode -eq 'Verify') {
        return [pscustomobject]@{ Status = 'READ_ONLY_COLLECTION_PREFLIGHT'; SeedPath = $scope.SeedPath; RunId = $scope.RunId
            GuestUnmountConfirmed = [bool]$GuestUnmountConfirmed; GuestResultsRead = $false }
    }
    Assert-Ai09Administrator
    $seed = @(Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true)
    $null = Get-Ai09CollectionVhd $scope
    # Remove only the verified seed attachment object. Never pass the root disk or wildcard.
    Remove-VMHardDiskDrive -VMHardDiskDrive $seed[0] -ErrorAction Stop
    $mountAttempted = $false; $files = @{}; $guest = $null
    try {
        $null = Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
        if ((Get-Ai09CollectionVhd $scope).Attached) { throw 'SEED_IN_USE_DO_NOT_MOUNT' }
        $mountAttempted = $true
        $mounted = Mount-VHD -Path $scope.SeedPath -ReadOnly -PassThru -ErrorAction Stop
        $root = Get-Ai09ReadOnlySeedRoot -Scope $scope -Mounted $mounted
        foreach ($name in @('seed.id', 'ai09-stdout.txt', 'ai09-stderr.txt', 'ai09-result.txt')) {
            $files[$name] = Read-Ai09BoundedSeedFile -Root $root -Name $name
        }
        $guest = ConvertFrom-Ai09GuestReceipt -Scope $scope -Files $files
    } finally {
        if ($mountAttempted) {
            # This invocation observed the exact disk detached before attempting host mount.
            Assert-Ai09SeedDetachedFromVm $scope
            $actual = Get-Ai09CollectionVhd $scope
            if ($actual.Attached) { Dismount-VHD -Path $scope.SeedPath -ErrorAction Stop }
            if ((Get-Ai09CollectionVhd $scope).Attached) { throw 'HOST_DISMOUNT_UNCONFIRMED_MANUAL_INSPECTION_REQUIRED' }
        }
    }
    $null = Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
    if ((Get-Ai09CollectionVhd $scope).Attached) { throw 'HOST_DISMOUNT_UNCONFIRMED_MANUAL_INSPECTION_REQUIRED' }
    return Write-Ai09CollectedEvidence -Scope $scope -Files $files -Guest $guest
}

if ($MyInvocation.InvocationName -ne '.') {
    $collectionHelperLock = $null
    try {
        # Preserve collector arguments: the helper's own parameters have different defaults.
        $requestedMode = $Mode; $requestedConfirmation = $GuestUnmountConfirmed
        $helper = Join-Path $PSScriptRoot 'ai09-prepare-bootstrap-disk.ps1'
        # Hash the final handle and keep it open through dot-source and collection.
        # FileShare.Read rejects modification, replacement and deletion during this interval.
        $collectionHelperLock = [IO.File]::Open($helper, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $helperHasher = [Security.Cryptography.SHA256]::Create()
        try { $helperHash = ([BitConverter]::ToString($helperHasher.ComputeHash($collectionHelperLock))).Replace('-', '') }
        finally { $helperHasher.Dispose() }
        if ($helperHash -ne 'DF755ECA63C62576E93AFBB17E40450DABD9367082C18D4D5593E6EE3F6FAACB') { throw 'PREPARE_HELPER_HASH_MISMATCH' }
        . $helper
        Invoke-Ai09BootstrapCollection -Mode $requestedMode -GuestUnmountConfirmed:$requestedConfirmation | ConvertTo-Json -Depth 6
    } catch { Write-Error $_; exit 1 }
    finally { if ($null -ne $collectionHelperLock) { $collectionHelperLock.Dispose() } }
}
