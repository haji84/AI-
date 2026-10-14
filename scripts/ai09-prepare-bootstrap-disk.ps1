# GORIQ AI-09 offline bootstrap seed: bounded Windows 11 Pro Hyper-V host operation.
# Create ONE new FAT32 256MiB VHDX, put a diagnostic guest script in it, attach
# to the already-running Ubuntu VM as a SECOND SCSI disk. No network/ACL changes.
$ErrorActionPreference = 'Stop'
$vm = 'GORIQ-AI09-Ubuntu'
$dir = 'C:\GORIQ-AI09\Bootstrap'
$seedPath = Join-Path $dir 'AI09-SEED.vhdx'

Write-Host '=== PRECHECK ==='
if ($env:COMPUTERNAME -ne 'HAJI') { throw 'WRONG_HOST' }
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMIN_REQUIRED' }
if ((Get-VM -Name $vm -ErrorAction Stop).State -ne 'Running') { throw 'VM_NOT_RUNNING' }
if (@(Get-Process Runner.Listener -ErrorAction SilentlyContinue).Count -ne 1) { throw 'RUNNER_NOT_READY' }
if (@(Get-Process Runner.Worker -ErrorAction SilentlyContinue).Count -gt 0) { throw 'GORIQ_JOB_ACTIVE' }
$drives = @(Get-VMHardDiskDrive -VMName $vm)
if ($drives.Count -ne 1 -or $drives[0].Path -ne 'C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu.vhdx') { throw 'VM_DISKS_UNEXPECTED' }
if ($drives[0].ControllerType -ne 'SCSI' -or $drives[0].ControllerNumber -ne 0) { throw 'VM_ROOT_CONTROLLER_UNEXPECTED' }
if ($drives[0].ControllerLocation -eq 2) { throw 'SCSI_SLOT_2_IN_USE' }
if (Test-Path -LiteralPath $seedPath) { throw 'SEED_ALREADY_EXISTS_DO_NOT_OVERWRITE' }
$free = (Get-PSDrive C).Free
if ($free -lt 50GB) { throw 'HOST_LOW_DISK_SPACE' }
$rules = @(Get-VMNetworkAdapterExtendedAcl -VMName $vm)
if ($rules.Count -ne 4) { throw 'VM_ACL_COUNT_CHANGED' }
Write-Host 'PRECHECK_PASS'

# Pure diagnostics plus an ephemeral networkd DHCPv4 configuration. Do not open
# SSH, download packages, or adjust Hyper-V ACLs. Return a text receipt to VHD.
$guest = @'
#!/usr/bin/env bash
set -eu
exec > /mnt/ai09-result.txt 2>&1
trap 'sync || true' EXIT
printf '=== AI09 GUEST BOOTSTRAP ===\n'
printf 'MACHINE=%s\n' "$(hostname)"
if [ "$(id -u)" -ne 0 ]; then echo ROOT_REQUIRED; exit 3; fi
if ! ip link show dev eth0 >/dev/null 2>&1; then echo ETH0_NOT_FOUND; exit 4; fi
if ! systemctl is-active --quiet systemd-networkd; then echo NETWORKD_NOT_ACTIVE; exit 5; fi
mkdir -p /run/systemd/network
cat > /run/systemd/network/10-ai09.network <<'NETWORK'
[Match]
Name=eth0

[Network]
DHCP=ipv4
IPv6AcceptRA=no
LinkLocalAddressing=no

[DHCPv4]
UseDNS=no
UseRoutes=no
NETWORK
chmod 644 /run/systemd/network/10-ai09.network
networkctl reload
networkctl reconfigure eth0
sleep 12
printf '=== IP ===\n'
ip -4 -br address show dev eth0 || true
printf '=== ROUTE ===\n'
ip -4 route || true
printf '=== SSH SERVER ===\n'
if command -v sshd >/dev/null 2>&1 || [ -x /usr/sbin/sshd ]; then
    echo SSHD_PRESENT
    if [ -f /etc/ssh/ssh_host_ed25519_key.pub ]; then
        ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub || true
    fi
else
    echo SSHD_MISSING
fi
printf '=== STORAGE ===\n'
df -h / || true
printf '=== GUEST CHECK COMPLETE ===\n'
'@

Write-Host '=== CREATE ISOLATED SEED VHDX ==='
New-Item -Path $dir -ItemType Directory -Force | Out-Null
New-VHD -Path $seedPath -Dynamic -SizeBytes 256MB | Out-Null
$mounted = $false
try {
    $mountedVhd = Mount-VHD -Path $seedPath -PassThru
    $mounted = $true
    $disk = $mountedVhd | Get-Disk
    if (-not $disk -or @($disk).Count -ne 1) { throw 'SEED_DISK_DISCOVERY_FAILED' }
    $cDisk = Get-Partition -DriveLetter C | Get-Disk
    if ($disk.Number -eq $cDisk.Number -or $disk.PartitionStyle -ne 'RAW' -or
        $disk.Size -lt 240MB -or $disk.Size -gt 280MB -or $disk.IsBoot -or $disk.IsSystem) {
        throw 'UNSAFE_SEED_DISK_ABORT'
    }
    Initialize-Disk -Number $disk.Number -PartitionStyle MBR | Out-Null
    $part = New-Partition -DiskNumber $disk.Number -UseMaximumSize -AssignDriveLetter
    Format-Volume -Partition $part -FileSystem FAT32 -NewFileSystelLabel 'AI09SEED' -Confirm:$false -Force | Out-Null
    $letter = (Get-Partition -DiskNumber $disk.Number | Where-Object { $_.DriveLetter } | Select-Object -First 1).DriveLetter
    if (-not $letter) { throw 'SEED_LETTER_MISSING' }
    $file = "$($letter):\bridge.sh"
    $normalized = ($guest -replace "`r`n", "`n") + "`n"
    [System.IO.File]::WriteAllText($file, $normalized, (New-Object System.Text.UTF8Encoding($false)))
    if (-not (Test-Path -LiteralPath $file)) { throw 'SEED_SCRIPT_WRITE_FAILED' }
    Write-Host ('SEED_SCRIPT_SHA256=' + (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash)
} finally {
    if ($mounted) { Dismount-VHD -Path $seedPath -ErrorAction Stop }
}

if (@(Get-VMHardDiskDrive -VMName $vm).Count -ne 1) { throw 'DISK_LAYOUT_CHANGED_DO_NOT_ATTACH' }
Add-VMHardDiskDrive -VMName $vm -ControllerType SCSI -ControllerNumber 0 -ControllerLocation 2 -Path $seedPath
$seen = @(Get-VMHardDiskDrive -VMName $vm | Where-Object { $_.Path -eq $seedPath })
if ($seen.Count -ne 1) { throw 'SEED_ATTACHMENT_UNCONFIRMED' }
Write-Host 'SEED_ATTACHED_TO_VM_ONLY'
Write-Host 'GUEST_NOT_RUN_NO_SSH_OR_NETWORK_CHANGES'
Write-Host ('SEED_VHDX=' + $seedPath)
