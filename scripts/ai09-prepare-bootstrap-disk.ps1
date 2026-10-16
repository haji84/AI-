# One-time AI-09 seed preparation. Verify is read-only; Execute never reuses a disk.
[CmdletBinding()]
param(
    [ValidateSet('Verify', 'Execute')][string]$Mode = 'Verify',
    [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedAclSha256
)
$ErrorActionPreference = 'Stop'

function Get-Ai09AclSha256 {
    param([object[]]$Rules)
    $rows = @($Rules | ForEach-Object {
        [ordered]@{
            Direction = [int]$_.Direction; Action = [int]$_.Action; Weight = [int]$_.Weight
            LocalIPAddress = [string]$_.LocalIPAddress; RemoteIPAddress = [string]$_.RemoteIPAddress
            LocalPort = [string]$_.LocalPort; RemotePort = [string]$_.RemotePort
            Protocol = [string]$_.Protocol; Stateful = [bool]$_.Stateful
            IdleSessionTimeout = [int]$_.IdleSessionTimeout
        } | ConvertTo-Json -Compress
    } | Sort-Object)
    $bytes = [Text.Encoding]::UTF8.GetBytes('[' + ($rows -join ',') + ']')
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Assert-Ai09Path {
    param([string]$Path)
    if ([IO.Path]::GetFullPath($Path) -ne $Path -or $Path -notmatch '^C:\\GORIQ-AI09\\') { throw 'UNSAFE_PATH' }
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_PATH_REFUSED' }
        }
        $cursor = Split-Path -Path $cursor -Parent
    }
}

function Assert-Ai09OsDisk {
    param([object[]]$Drives)
    $childPath = 'C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx'
    $parentPath = 'C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu.vhdx'
    if ($Drives.Count -ne 1 -or $Drives[0].Path -ne $childPath -or [string]$Drives[0].ControllerType -ne 'SCSI' -or
        $Drives[0].ControllerNumber -ne 0 -or $Drives[0].ControllerLocation -ne 0) { throw 'VM_DISKS_UNEXPECTED' }
    Assert-Ai09Path $childPath
    Assert-Ai09Path $parentPath
    $child = Get-VHD -Path $childPath
    $parent = Get-VHD -Path $parentPath
    foreach ($vhd in @($child, $parent)) {
        if ($vhd.Size -ne 40GB -or [string]$vhd.VhdFormat -ne 'VHDX' -or
            [string]$vhd.DiskIdentifier -ne '9D28872E-0087-4A33-ABFA-AE0DEF1E66B8') { throw 'OS_CHAIN_CHANGED' }
    }
    if ($child.Path -ne $childPath -or [string]$child.VhdType -ne 'Differencing' -or $child.ParentPath -ne $parentPath -or
        $parent.Path -ne $parentPath -or [string]$parent.VhdType -ne 'Dynamic' -or $parent.ParentPath) { throw 'OS_CHAIN_CHANGED' }
}

function Assert-Ai09Environment {
    param([string]$AclSha256, [switch]$SeedMayExist)
    if ($env:COMPUTERNAME -ne 'HAJI') { throw 'WRONG_HOST' }
    $vm = Get-VM -Name 'GORIQ-AI09-Ubuntu' -ErrorAction Stop
    if ([string]$vm.Id -ne '453b139b-cceb-446e-99fb-f45bf5895436' -or [string]$vm.State -ne 'Running') { throw 'VM_IDENTITY_OR_STATE_CHANGED' }
    if (@(Get-Process Runner.Listener -ErrorAction SilentlyContinue).Count -ne 1) { throw 'RUNNER_NOT_READY' }
    if (@(Get-Process Runner.Worker -ErrorAction SilentlyContinue).Count -ne 0) { throw 'GORIQ_JOB_ACTIVE' }
    Assert-Ai09OsDisk @(Get-VMHardDiskDrive -VMName $vm.Name)
    $nics = @(Get-VMNetworkAdapter -VMName $vm.Name)
    if ($nics.Count -ne 1 -or $nics[0].SwitchName -ne 'Default Switch' -or $nics[0].MacAddress -ne '00155DDC2C00' -or
        [string]$nics[0].Id -ne 'Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D') { throw 'VM_NIC_CHANGED' }
    $rules = @(Get-VMNetworkAdapterExtendedAcl -VMName $vm.Name)
    if ($rules.Count -ne 4) { throw 'VM_ACL_CHANGED' }
    $observedAcl = Get-Ai09AclSha256 $rules
    if ($AclSha256 -and $observedAcl -ne $AclSha256) { throw 'VM_ACL_CHANGED' }
    Assert-Ai09Path 'C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx'
    if (-not $SeedMayExist -and (Test-Path -LiteralPath 'C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx')) { throw 'SEED_ALREADY_EXISTS_DO_NOT_OVERWRITE' }
    if ((Get-PSDrive C).Free -lt 50GB) { throw 'HOST_LOW_DISK_SPACE' }
    return $observedAcl
}

function Assert-Ai09Administrator {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMIN_REQUIRED' }
}

function Assert-Ai09SeedDisk {
    param([object]$Identity, [switch]$RequireRaw)
    Assert-Ai09Path $Identity.Path
    $vhd = Get-VHD -Path $Identity.Path -ErrorAction Stop
    if ($vhd.Path -ne $Identity.Path -or [string]$vhd.DiskIdentifier -ne $Identity.Identifier -or
        -not $vhd.Attached -or $vhd.DiskNumber -ne $Identity.Number -or $vhd.Size -ne 256MB) { throw 'SEED_VHD_IDENTITY_CHANGED' }
    $disk = Get-Disk -Number $Identity.Number -ErrorAction Stop
    $systemDisk = @(Get-Partition -DriveLetter C | Get-Disk)
    if (@($disk).Count -ne 1 -or $systemDisk.Count -ne 1 -or $disk.Number -eq $systemDisk[0].Number -or
        -not $disk.UniqueId -or $disk.UniqueId -ne $Identity.UniqueId -or $disk.Number -ne $Identity.Number -or
        $disk.Size -ne 256MB -or $disk.IsBoot -or $disk.IsSystem -or $disk.IsReadOnly -or $disk.IsOffline) { throw 'UNSAFE_SEED_DISK_ABORT' }
    if ($RequireRaw -and [string]$disk.PartitionStyle -ne 'RAW') { throw 'SEED_NOT_RAW' }
    return $disk
}

function New-Ai09GuestScript {
    param([string]$RunId, [string]$FsUuid, [string]$PartUuid)
    if ($RunId -notmatch '^[a-f0-9]{32}$' -or $FsUuid -notmatch '^[A-F0-9]{4}-[A-F0-9]{4}$' -or
        $PartUuid -notmatch '^[a-f0-9]{8}-01$') { throw 'INVALID_SEED_IDENTITY' }
    $template = @'
#!/usr/bin/env bash
set -euo pipefail
# No receipt or network writes before all identity checks pass.
[[ "$(id -u)" = 0 ]] || { echo ROOT_REQUIRED >&2; exit 3; }
[[ "$(hostname)" = 848484 ]] || { echo WRONG_GUEST >&2; exit 4; }
[[ "$(readlink -f -- "${BASH_SOURCE[0]}")" = /mnt/bridge.sh && ! -L /mnt/bridge.sh ]] || exit 5
[[ "$(findmnt -rn -M /mnt -o TARGET)" = /mnt ]] || { echo SEED_NOT_MOUNTED >&2; exit 6; }
[[ "$(findmnt -rn -M /mnt -o FSTYPE)" = vfat ]] || exit 7
seed_device="$(findmnt -rn -M /mnt -o SOURCE)"
[[ -b "$seed_device" ]] || exit 8
[[ "$(blkid -s LABEL -o value "$seed_device")" = AI09SEED ]] || exit 9
[[ "$(blkid -s UUID -o value "$seed_device")" = __FS_UUID__ ]] || exit 10
[[ "$(blkid -s PARTUUID -o value "$seed_device")" = __PART_UUID__ ]] || exit 11
[[ "$(readlink -f "$seed_device")" != "$(findmnt -rn -M / -o SOURCE | xargs readlink -f)" ]] || exit 12
[[ ! -L /mnt/seed.id && "$(cat /mnt/seed.id)" = __RUN_ID__ ]] || exit 13
for file in /mnt/ai09-stdout.txt /mnt/ai09-stderr.txt /mnt/ai09-result.txt; do
    [[ ! -e "$file" && ! -L "$file" ]] || { echo EXISTING_RECEIPT_REFUSED >&2; exit 14; }
done
umask 077
set -o noclobber
ulimit -f 2048
exec 3>/mnt/ai09-result.txt
exec >/mnt/ai09-stdout.txt 2>/mnt/ai09-stderr.txt
finish() {
    rc=$?
    trap - EXIT
    set +e
    if ! sync; then rc=74; fi
    status=FAILED
    if [[ "$rc" = 0 ]]; then status=DIAGNOSTICS_COLLECTED; fi
    printf 'RUN_ID=__RUN_ID__\nTIMESTAMP=%s\nSTATUS=%s\nEXIT_CODE=%s\n' "$(date -u +%FT%TZ)" "$status" "$rc" >&3
    exec 3>&-
    if ! sync; then exit 74; fi
    exit "$rc"
}
trap finish EXIT
printf 'RUN_ID=__RUN_ID__\nMACHINE=%s\nSTARTED=%s\n' "$(hostname)" "$(date -u +%FT%TZ)"
ip link show dev eth0
printf 'GUEST_MAC=%s\n' "$(cat /sys/class/net/eth0/address)"
[[ "$(cat /sys/class/net/eth0/address)" = 00:15:5d:dc:2c:00 ]] || exit 15
printf '=== SSH SERVER (no service changes) ===\n'
if command -v sshd >/dev/null 2>&1 || [[ -x /usr/sbin/sshd ]]; then
    echo SSHD_PRESENT
    if systemctl is-active --quiet ssh; then echo SSH_SERVICE_ACTIVE; else echo SSH_SERVICE_INACTIVE; fi
    if [[ -f /etc/ssh/ssh_host_ed25519_key.pub ]]; then
        ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub
        cat /etc/ssh/ssh_host_ed25519_key.pub
    else
        echo SSH_HOST_KEY_MISSING
    fi
else
    echo SSHD_MISSING
fi
systemctl is-active --quiet systemd-networkd || { echo NETWORKD_NOT_ACTIVE >&2; exit 16; }
for dir in /run /run/systemd; do
    [[ -d "$dir" && ! -L "$dir" ]] || { echo NETWORK_DIR_UNSAFE >&2; exit 17; }
done
[[ ! -L /run/systemd/network ]] || { echo NETWORK_DIR_UNSAFE >&2; exit 17; }
if [[ ! -e /run/systemd/network ]]; then mkdir -m 755 /run/systemd/network; fi
[[ -d /run/systemd/network ]] || exit 17
[[ ! -e /run/systemd/network/10-ai09.network && ! -L /run/systemd/network/10-ai09.network ]] || { echo EXISTING_NETWORK_CONFIG_REFUSED >&2; exit 18; }
cat > /run/systemd/network/10-ai09.network <<'NETWORK'
[Match]
Name=eth0
MACAddress=00:15:5d:dc:2c:00

[Network]
DHCP=ipv4
IPv6AcceptRA=no
LinkLocalAddressing=no

[DHCPv4]
UseDNS=no
UseRoutes=no
NETWORK
chmod 644 /run/systemd/network/10-ai09.network
timeout 10s networkctl reload
timeout 10s networkctl reconfigure eth0
for attempt in {1..12}; do
    if ip -4 -o address show dev eth0 scope global | grep -q ' inet '; then break; fi
    sleep 1
done
printf '=== IP ===\n'
ip -4 -br address show dev eth0
printf '=== ROUTE ===\n'
ip -4 route
printf '=== STORAGE ===\n'
df -h /
ip -4 -o address show dev eth0 scope global | grep -q ' inet ' || { echo DHCP_IPV4_MISSING >&2; exit 19; }
echo 'DIAGNOSTICS_ONLY_NOT_SSH_E2E; manually unmount /mnt before host collection'
'@
    return $template.Replace('__RUN_ID__', $RunId).Replace('__FS_UUID__', $FsUuid).Replace('__PART_UUID__', $PartUuid).Replace("`r`n", "`n") + "`n"
}

function Write-Ai09SeedFiles {
    param([object]$Identity, [object]$Partition, [string]$RunId)
    $disk = Assert-Ai09SeedDisk $Identity
    $parts = @(Get-Partition -DiskNumber $Identity.Number)
    if ($parts.Count -ne 1 -or $parts[0].PartitionNumber -ne 1 -or $parts[0].PartitionNumber -ne $Partition.PartitionNumber -or
        -not $parts[0].DriveLetter) { throw 'SEED_PARTITION_CHANGED' }
    $volume = Get-Volume -Partition $parts[0]
    if ([string]$volume.FileSystem -ne 'FAT32' -or $volume.FileSystemLabel -ne 'AI09SEED' -or
        $volume.DriveLetter -ne $parts[0].DriveLetter) { throw 'SEED_VOLUME_CHANGED' }
    $letter = [string]$parts[0].DriveLetter
    $logical = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $letter + ":'")
    $serial = [string]$logical.VolumeSerialNumber
    if ($serial -notmatch '^[A-Fa-f0-9]{8}$' -or -not $disk.Signature) { throw 'SEED_UUID_MISSING' }
    $uuid = $serial.ToUpperInvariant().Insert(4, '-')
    $partUuid = ('{0:x8}-01' -f [uint32]$disk.Signature)
    $guest = New-Ai09GuestScript -RunId $RunId -FsUuid $uuid -PartUuid $partUuid
    $encoding = [Text.UTF8Encoding]::new($false)
    # CreateNew: even an unexpected file on this new volume cannot be overwritten.
    foreach ($entry in @(@{ Name = 'bridge.sh'; Data = $guest }, @{ Name = 'seed.id'; Data = $RunId + "`n" })) {
        $stream = [IO.File]::Open(($letter + ':\' + $entry.Name), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $bytes = $encoding.GetBytes($entry.Data); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
        finally { $stream.Dispose() }
    }
    return [pscustomobject]@{ RunId = $RunId; FileSystemUuid = $uuid; PartitionUuid = $partUuid
        GuestSha256 = (Get-FileHash -LiteralPath ($letter + ':\bridge.sh') -Algorithm SHA256).Hash }
}

function Invoke-Ai09Bootstrap {
    param([ValidateSet('Verify', 'Execute')][string]$Mode = 'Verify', [string]$ExpectedAclSha256)
    $path = 'C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx'
    $phase = 'Preflight'
    $observed = Assert-Ai09Environment -AclSha256 $ExpectedAclSha256
    if ($Mode -eq 'Verify') {
        return [pscustomobject]@{ Status = 'VERIFIED_READ_ONLY'; ObservedAclSha256 = $observed
            ExecuteRequiresReviewedAclHash = $true; SeedPath = $path }
    }
    if ($ExpectedAclSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'REVIEWED_ACL_HASH_REQUIRED' }
    Assert-Ai09Administrator
    $identifier = $null; $identity = $null; $receipt = $null
    try {
        $phase = 'Create'
        $null = Assert-Ai09Environment -AclSha256 $ExpectedAclSha256
        New-Item -Path 'C:\GORIQ-AI09\Bootstrap' -ItemType Directory -Force | Out-Null
        Assert-Ai09Path $path
        New-VHD -Path $path -Dynamic -SizeBytes 256MB | Out-Null
        $created = Get-VHD -Path $path -ErrorAction Stop
        if ($created.Path -ne $path -or $created.Size -ne 256MB -or $created.Attached -or
            [string]$created.VhdType -ne 'Dynamic' -or -not $created.DiskIdentifier) { throw 'NEW_VHD_IDENTITY_INVALID' }
        $identifier = [string]$created.DiskIdentifier
        $phase = 'Mount'
        $null = Assert-Ai09Environment -AclSha256 $ExpectedAclSha256 -SeedMayExist
        $mounted = Mount-VHD -Path $path -PassThru -ErrorAction Stop
        if ($mounted.Path -ne $path -or [string]$mounted.DiskIdentifier -ne $identifier -or -not $mounted.Attached) { throw 'MOUNT_IDENTITY_INVALID' }
        $disk = Get-Disk -Number $mounted.DiskNumber -ErrorAction Stop
        $identity = [pscustomobject]@{ Path = $path; Identifier = $identifier; Number = $mounted.DiskNumber; UniqueId = $disk.UniqueId }
        $phase = 'Initialize'
        $null = Assert-Ai09Environment -AclSha256 $ExpectedAclSha256 -SeedMayExist
        $disk = Assert-Ai09SeedDisk $identity -RequireRaw
        Initialize-Disk -Number $disk.Number -PartitionStyle MBR | Out-Null
        $phase = 'Partition'
        $null = Assert-Ai09Environment -AclSha256 $ExpectedAclSha256 -SeedMayExist
        $disk = Assert-Ai09SeedDisk $identity
        if ([string]$disk.PartitionStyle -ne 'MBR' -or @(Get-Partition | Where-Object { $_.DiskNumber -eq $disk.Number }).Count -ne 0) { throw 'SEED_PARTITIONS_UNEXPECTED' }
        $part = New-Partition -DiskNumber $disk.Number -UseMaximumSize -AssignDriveLetter
        $phase = 'Format'
        $null = Assert-Ai09Environment -AclSha256 $ExpectedAclSha256 -SeedMayExist
        $null = Assert-Ai09SeedDisk $identity
        if ($part.DiskNumber -ne $identity.Number -or $part.PartitionNumber -ne 1 -or -not $part.DriveLetter) { throw 'UNSAFE_PARTITION_ABORT' }
        Format-Volume -Partition $part -FileSystem FAT32 -NewFileSystemLabel 'AI09SEED' -Confirm:$false -Force | Out-Null
        $phase = 'Write'
        $null = Assert-Ai09Environment -AclSha256 $ExpectedAclSha256 -SeedMayExist
        $receipt = Write-Ai09SeedFiles -Identity $identity -Partition $part -RunId ([guid]::NewGuid().ToString('N'))
    } catch {
        Write-Output ('FAILED_PHASE=' + $phase)
        throw
    } finally {
        # Inspect actual attachment even when Mount-VHD attached the disk and then threw.
        if ($identifier) {
            $actual = Get-VHD -Path $path -ErrorAction Stop
            if ($actual.Path -ne $path -or [string]$actual.DiskIdentifier -ne $identifier) { throw 'CLEANUP_IDENTITY_CHANGED_MANUAL_INSPECTION_REQUIRED' }
            if ($actual.Attached) { Dismount-VHD -Path $path -ErrorAction Stop }
            if ((Get-VHD -Path $path -ErrorAction Stop).Attached) { throw 'SEED_STILL_HOST_MOUNTED_DO_NOT_ATTACH' }
        }
    }
    $null = Assert-Ai09Environment -AclSha256 $ExpectedAclSha256 -SeedMayExist
    $ready = Get-VHD -Path $path -ErrorAction Stop
    if ($ready.Attached -or [string]$ready.DiskIdentifier -ne $identifier -or $ready.Path -ne $path) { throw 'SEED_ATTACH_IDENTITY_CHANGED' }
    Add-VMHardDiskDrive -VMName 'GORIQ-AI09-Ubuntu' -ControllerType SCSI -ControllerNumber 0 -ControllerLocation 2 -Path $path
    $seen = @(Get-VMHardDiskDrive -VMName 'GORIQ-AI09-Ubuntu')
    $seed = @($seen | Where-Object { $_.Path -eq $path -and [string]$_.ControllerType -eq 'SCSI' -and $_.ControllerNumber -eq 0 -and $_.ControllerLocation -eq 2 })
    if ($seen.Count -ne 2 -or $seed.Count -ne 1) { throw 'SEED_ATTACHMENT_UNCONFIRMED' }
    return [pscustomobject]@{ Status = 'SEED_ATTACHED_GUEST_NOT_EXECUTED'; SeedPath = $path; Identity = $identity; Receipt = $receipt }
}

# Dot-sourcing exposes the read-only helpers for unit tests and digest inspection only.
if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-Ai09Bootstrap -Mode $Mode -ExpectedAclSha256 $ExpectedAclSha256 | ConvertTo-Json -Depth 6 }
    catch { Write-Error $_; exit 1 }
}
