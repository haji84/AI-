param([string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$path = Join-Path $RepositoryRoot 'scripts/ai09-repair-seed-hostname.ps1'
if (-not (Test-Path -LiteralPath $path)) { throw 'REPAIR_SCRIPT_MISSING' }
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$mode = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Mode' })
if ($mode.Count -ne 1 -or $mode[0].DefaultValue.Value -ne 'Verify') { throw 'DEFAULT_VERIFY_REQUIRED' }
. (Join-Path $RepositoryRoot 'scripts/ai09-prepare-bootstrap-disk.ps1')
. (Join-Path $RepositoryRoot 'scripts/ai09-collect-bootstrap-result.ps1')
. $path
$script:RealWriter = ${function:Set-Ai09RepairScript}
$script:RealRunGuard = ${function:Assert-Ai09RepairRun}
$script:RealBackup = ${function:Save-Ai09RepairBackup}
$script:RealReader = ${function:Read-Ai09RepairScript}
$script:Passed = 0
$script:Original = [Text.UTF8Encoding]::new($false).GetBytes((New-Ai09GuestScript -RunId '02ea2f0d324543a1ab2973e73c97421d' -FsUuid 'CA77-6E6C' -PartUuid '703b5247-01').Replace('[[ "$(hostname)" = 848484 ]]', '[[ "$(hostname)" = 8484 ]]'))
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Body, [string]$Message) {
    $caught = ''
    try { $null = & $Body } catch { $caught = $_.Exception.Message }
    Assert-True ($caught -like "*$Message*") ("Expected $Message; actual $caught")
}
function Add-Call([string]$Name) { $script:Calls.Add($Name) }
function Reset-RepairFixture {
    $script:Scope = Get-Ai09CollectionScope
    $script:Calls = [Collections.Generic.List[string]]::new()
    $script:Fault = ''; $script:VmAttached = $true; $script:BackedUp = $false
    $script:Bytes = [byte[]]$script:Original.Clone()
    $script:Vhd = [pscustomobject]@{ Path = $script:Scope.SeedPath; DiskIdentifier = $script:Scope.DiskIdentifier
        Size = 256MB; VhdType = 'Dynamic'; VhdFormat = 'VHDX'; ParentPath = ''; Attached = $true; DiskNumber = 9 }
    $script:Disk = [pscustomobject]@{ Number = 9; UniqueId = $script:Scope.UniqueId; Size = 256MB; IsBoot = $false
        IsSystem = $false; IsReadOnly = $true; IsOffline = $false; PartitionStyle = 'MBR'; Signature = $script:Scope.Signature }
}
function Test-RepairCase([string]$Name, [scriptblock]$Body) {
    Reset-RepairFixture
    & $Body
    $script:Passed++; Write-Output "PASS $Name"
}
function Assert-Ai09Path { param($Path) if ($script:Fault -eq 'reparse') { throw 'REPARSE_PATH_REFUSED' } }
function Assert-Ai09OsDisk { param($Drives)
    if (@($Drives).Count -ne 1 -or $Drives[0].Path -ne 'root.avhdx' -or $script:Fault -eq 'root-chain') { throw 'OS_CHAIN_CHANGED' }
}
function Assert-Ai09Administrator { Add-Call 'Admin' }
function Get-VM { [CmdletBinding()]param($Name)
    [pscustomobject]@{ Id = $(if ($script:Fault -eq 'vm-id') { 'wrong' } else { $script:Scope.VmId }); State = 'Running' }
}
function Get-Process { [CmdletBinding()]param($Name)
    if ($Name -eq 'Runner.Listener') { return [pscustomobject]@{ Id = 1 } }
    if (($script:Fault -eq 'late-runner-write' -and $script:Calls.Contains('MountReadWrite')) -or
        ($script:Fault -eq 'late-runner-attach' -and $script:Calls.Contains('Write'))) { return [pscustomobject]@{ Id = 2 } }
}
function Get-VMHardDiskDrive { param($VMName)
    [pscustomobject]@{ Path = 'root.avhdx' }
    if ($script:VmAttached) {
        [pscustomobject]@{ Path = $script:Scope.SeedPath; ControllerType = 'SCSI'; ControllerNumber = 0
            ControllerLocation = $(if ($script:Fault -eq 'slot') { 1 } else { 2 }) }
    }
}
function Get-VMNetworkAdapter { param($VMName)
    [pscustomobject]@{ SwitchName = 'Default Switch'; MacAddress = '00155DDC2C00'
        Id = 'Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D' }
}
function Get-VMNetworkAdapterExtendedAcl { param($VMName) 1..4 }
function Get-Ai09AclSha256 { param($Rules)
    if ($script:Fault -eq 'acl') { return 'changed-same-count' }
    return $script:Scope.AclSha256
}
function Get-VHD { [CmdletBinding()]param($Path)
    if ($script:Fault -eq 'vhd-id') { $script:Vhd.DiskIdentifier = 'wrong' }
    $script:Vhd
}
function Remove-VMHardDiskDrive { [CmdletBinding()]param($VMHardDiskDrive)
    Assert-True ($VMHardDiskDrive.Path -eq $script:Scope.SeedPath -and $VMHardDiskDrive.ControllerLocation -eq 2) 'Wrong detach target'
    Add-Call 'Detach'
    if ($script:Fault -eq 'detach-failure') { throw 'DETACH_FAILED' }
    if ($script:Fault -ne 'detach-noop') { $script:VmAttached = $false; $script:Vhd.Attached = $false }
}
function Add-VMHardDiskDrive { [CmdletBinding()]param($VMName, $ControllerType, $ControllerNumber, $ControllerLocation, $Path)
    Assert-True ($VMName -eq $script:Scope.VmName -and $ControllerType -eq 'SCSI' -and $ControllerNumber -eq 0 -and
        $ControllerLocation -eq 2 -and $Path -eq $script:Scope.SeedPath -and -not $script:VmAttached -and -not $script:Vhd.Attached) 'Unsafe reattachment'
    Add-Call 'Attach'
    if ($script:Fault -eq 'attach-failure') { throw 'ATTACH_FAILED' }
    $script:VmAttached = $true; $script:Vhd.Attached = $true
}
function Mount-VHD { [CmdletBinding()]param($Path, [switch]$ReadOnly, [switch]$PassThru)
    Assert-True ($Path -eq $script:Scope.SeedPath -and -not $script:VmAttached -and -not $script:Vhd.Attached) 'Unsafe mount'
    $kind = if ($ReadOnly) { 'MountReadOnly' } else { 'MountReadWrite' }
    Add-Call $kind; $script:Vhd.Attached = $true; $script:Disk.IsReadOnly = [bool]$ReadOnly
    if (($ReadOnly -and $script:Fault -eq 'partial-ro') -or (-not $ReadOnly -and $script:Fault -eq 'partial-rw')) { throw 'PARTIAL_MOUNT_FAILED' }
    if (-not $ReadOnly -and $script:Fault -eq 'changed-after-inspection') { $script:Bytes = [Text.Encoding]::UTF8.GetBytes('tampered') }
    $script:Vhd
}
function Get-Disk { [CmdletBinding()]param($Number, [Parameter(ValueFromPipeline = $true)]$InputObject)
    process {
        if ($null -ne $InputObject) { return [pscustomobject]@{ Number = 0 } }
        if ($script:Fault -eq 'rw-is-readonly' -and $script:Calls.Contains('MountReadWrite')) { $script:Disk.IsReadOnly = $true }
        if ($script:Fault -eq 'unique-id') { $script:Disk.UniqueId = 'wrong' }
        if ($script:Fault -eq 'os-disk') { $script:Disk.IsSystem = $true }
        $script:Disk
    }
}
function Get-Partition { [CmdletBinding()]param($DriveLetter, $DiskNumber)
    if ($DriveLetter) { return [pscustomobject]@{ DiskNumber = 0 } }
    [pscustomobject]@{ DiskNumber = 9; PartitionNumber = $(if ($script:Fault -eq 'partition') { 2 } else { 1 }); DriveLetter = 'Z' }
}
function Get-Volume { param($Partition)
    [pscustomobject]@{ FileSystem = 'FAT32'; FileSystemLabel = $(if ($script:Fault -eq 'label') { 'wrong' } else { 'AI09SEED' }); DriveLetter = 'Z' }
}
function Get-CimInstance { param($ClassName, $Filter)
    [pscustomobject]@{ VolumeSerialNumber = $(if ($script:Fault -eq 'fat-uuid') { 'wrong' } else { 'CA776E6C' }) }
}
function Read-Ai09BoundedSeedFile { param($Root, $Name)
    Assert-True ($Name -eq 'seed.id') 'Unexpected read'
    if ($script:Fault -eq 'run-id') { return ,([Text.Encoding]::UTF8.GetBytes('wrong')) }
    return ,([Text.Encoding]::UTF8.GetBytes($script:Scope.RunId))
}
function Get-ChildItem { [CmdletBinding()]param($LiteralPath, [switch]$Force)
    if ($script:Fault -eq 'existing-receipts') { [pscustomobject]@{ Name = 'ai09-result.txt' } }
}
function Read-Ai09RepairScript { param($Root)
    Add-Call 'InspectScript'
    if ($script:Fault -eq 'old-hash') { return ,([Text.Encoding]::UTF8.GetBytes('wrong')) }
    if ($script:Fault -eq 'already-repaired') { return ,(ConvertTo-Ai09RepairedScript $script:Original) }
    return ,$script:Bytes
}
function Dismount-VHD { [CmdletBinding()]param($Path)
    Assert-True ($Path -eq $script:Scope.SeedPath -and -not $script:VmAttached) 'Wrong dismount target'
    Add-Call 'Dismount'
    if ($script:Fault -eq 'dismount-failure' -or ($script:Fault -eq 'rw-dismount-failure' -and $script:Calls.Contains('MountReadWrite'))) { throw 'DISMOUNT_FAILED' }
    if ($script:Fault -ne 'dismount-noop') { $script:Vhd.Attached = $false }
}
function Save-Ai09RepairBackup { param($Directory, $Original)
    Assert-True (-not $script:VmAttached -and -not $script:Vhd.Attached -and $script:Calls.Contains('InspectScript')) 'Backup before read-only dismount'
    Assert-True ((Get-Ai09RepairHash $Original) -eq (Get-Ai09RepairHash $script:Original)) 'Wrong backup bytes'
    Add-Call 'Backup'
    if ($script:Fault -eq 'backup-failure') { throw 'BACKUP_FAILED' }
    $script:BackedUp = $true
}
function Test-Path { [CmdletBinding()]param($LiteralPath, [string]$PathType)
    if ($LiteralPath -like 'C:\GORIQ-AI09\Reports\hostname-repair-*') { return $script:BackedUp }
    Microsoft.PowerShell.Management\Test-Path @PSBoundParameters
}
function Set-Ai09RepairScript { param($Scope, $Root, $Mounted)
    $null = Assert-Ai09CollectionEnvironment -Scope $Scope -SeedAttached $false
    Assert-True ($script:BackedUp) 'Write without backup'
    $script:Bytes = ConvertTo-Ai09RepairedScript $script:Bytes
    Add-Call 'Write'
    if ($script:Fault -eq 'write-failure') { throw 'WRITE_FAILED' }
}
function Save-Ai09RepairStatus { param($Scope, $Directory, $Phase, [bool]$Success, $Failure)
    Add-Call $(if ($Success) { 'SuccessReceipt' } else { 'FailureReceipt' })
    [pscustomobject]@{ Success = $Success; Phase = $Phase; GuestExecuted = $false; SshVerified = $false }
}
function New-VHD { throw 'UNAUTHORIZED_NEW_VHD' }
function Initialize-Disk { throw 'UNAUTHORIZED_INITIALIZE' }
function Format-Volume { throw 'UNAUTHORIZED_FORMAT' }
function Remove-Item { throw 'UNAUTHORIZED_DELETE' }
$previousComputer = $env:COMPUTERNAME
$env:COMPUTERNAME = 'HAJI'
try {
    Test-RepairCase 'Verify has no detach, mount, backup, or write' {
        $result = Invoke-Ai09SeedHostnameRepair
        Assert-True ($result.Status -eq 'READ_ONLY_REPAIR_PREFLIGHT' -and -not $result.GuestFilesInspected -and -not $result.GuestUnmountConfirmed -and $script:Calls.Count -eq 0) 'Verify mutated or overstated evidence'
    }
    Test-RepairCase 'Execute requires actual unmount acknowledgement' {
        Expect-Failure { Invoke-Ai09SeedHostnameRepair -Mode Execute } 'EXPLICIT_GUEST_UNMOUNT_CONFIRMATION_REQUIRED'
        Assert-True ($script:Calls.Count -eq 0) 'Unconfirmed mutation'
    }
    Test-RepairCase 'wrong host fails before detach' {
        $env:COMPUTERNAME = 'OTHER'
        try { Expect-Failure { Invoke-Ai09SeedHostnameRepair -Mode Execute -GuestUnmountConfirmed } 'WRONG_HOST' }
        finally { $env:COMPUTERNAME = 'HAJI' }
        Assert-True ($script:Calls.Count -eq 0) 'Wrong host mutation'
    }
    foreach ($caseName in @('vm-id', 'acl', 'root-chain', 'slot', 'reparse', 'vhd-id')) {
        Test-RepairCase "$caseName fails before detach" {
            $script:Fault = $caseName
            $reason = @{ 'vm-id' = 'VM_IDENTITY'; acl = 'VM_ACL'; 'root-chain' = 'OS_CHAIN'; slot = 'EXACT_SEED_ATTACHMENT'; reparse = 'REPARSE'; 'vhd-id' = 'SEED_IDENTITY' }[$caseName]
            Expect-Failure { Invoke-Ai09SeedHostnameRepair -Mode Execute -GuestUnmountConfirmed } $reason
            Assert-True (-not $script:Calls.Contains('Detach')) 'Unsafe detach'
        }
    }
    foreach ($caseName in @('detach-failure', 'detach-noop')) {
        Test-RepairCase "$caseName never mounts" {
            $script:Fault = $caseName
            $reason = if ($caseName -eq 'detach-failure') { 'DETACH_FAILED' } else { 'SEED_STILL_VM_ATTACHED' }
            Expect-Failure { Invoke-Ai09SeedHostnameRepair -Mode Execute -GuestUnmountConfirmed } $reason
            Assert-True (-not $script:Calls.Contains('MountReadOnly')) 'Mounted attached seed'
        }
    }
    foreach ($caseName in @('partial-ro', 'unique-id', 'os-disk', 'partition', 'label', 'fat-uuid', 'run-id', 'existing-receipts', 'old-hash', 'already-repaired')) {
        Test-RepairCase "$caseName dismounts before any backup or write" {
            $script:Fault = $caseName
            $reason = @{ 'partial-ro' = 'PARTIAL_MOUNT'; 'unique-id' = 'EXPECTED_READONLY'; 'os-disk' = 'EXPECTED_READONLY'; partition = 'PARTITION_MISMATCH'; label = 'VOLUME_MISMATCH'; 'fat-uuid' = 'FAT_UUID'; 'run-id' = 'RUN_ID'; 'existing-receipts' = 'RECEIPTS_ALREADY'; 'old-hash' = 'ORIGINAL_SCRIPT_HASH'; 'already-repaired' = 'ORIGINAL_SCRIPT_HASH' }[$caseName]
            Expect-Failure { Invoke-Ai09SeedHostnameRepair -Mode Execute -GuestUnmountConfirmed } $reason
            Assert-True (-not $script:Vhd.Attached -and $script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Backup') -and -not $script:Calls.Contains('Attach')) 'Unsafe refusal cleanup'
        }
    }
    foreach ($caseName in @('dismount-failure', 'dismount-noop', 'backup-failure')) {
        Test-RepairCase "$caseName prohibits writable mount" {
            $script:Fault = $caseName
            $reason = if ($caseName -eq 'backup-failure') { 'BACKUP_FAILED' } else { 'REPAIR_CLEANUP_FAILED' }
            Expect-Failure { Invoke-Ai09SeedHostnameRepair -Mode Execute -GuestUnmountConfirmed } $reason
            Assert-True (-not $script:Calls.Contains('MountReadWrite') -and -not $script:Calls.Contains('Attach')) 'Continued after failure'
        }
    }
    foreach ($caseName in @('partial-rw', 'rw-is-readonly', 'changed-after-inspection', 'late-runner-write', 'write-failure', 'rw-dismount-failure', 'late-runner-attach')) {
        Test-RepairCase "$caseName preserves backup and refuses reattachment" {
            $script:Fault = $caseName
            $reason = @{ 'partial-rw' = 'PARTIAL_MOUNT'; 'rw-is-readonly' = 'EXPECTED_WRITABLE'; 'changed-after-inspection' = 'ORIGINAL_SCRIPT_HASH'; 'late-runner-write' = 'RUNNER_NOT_IDLE'; 'write-failure' = 'WRITE_FAILED'; 'rw-dismount-failure' = 'REPAIR_CLEANUP_FAILED'; 'late-runner-attach' = 'RUNNER_NOT_IDLE' }[$caseName]
            Expect-Failure { Invoke-Ai09SeedHostnameRepair -Mode Execute -GuestUnmountConfirmed } $reason
            Assert-True ($script:BackedUp -and $script:Calls.Contains('FailureReceipt') -and -not $script:Calls.Contains('Attach')) 'Unsafe failure handling'
            if ($caseName -ne 'rw-dismount-failure') { Assert-True (-not $script:Vhd.Attached) 'Host left attached' }
        }
    }
    Test-RepairCase 'success orders inspection, backup, one patch, dismount, then exact reattachment' {
        $result = Invoke-Ai09SeedHostnameRepair -Mode Execute -GuestUnmountConfirmed
        Assert-True (($script:Calls -join ',') -eq 'Admin,Detach,MountReadOnly,InspectScript,Dismount,Backup,MountReadWrite,Write,Dismount,Attach,SuccessReceipt') 'Unsafe success sequence'
        Assert-True ($result.Success -and -not $result.GuestExecuted -and -not $result.SshVerified) 'False guest success'
        Assert-True ((Get-Ai09RepairHash $script:Bytes) -eq '0306204EB6D8DFDD8C659938A6C92373A8CD89B659017F269FBF6C34DEE85A33') 'Wrong output bytes'
    }
    Test-RepairCase 'reattach failure is recorded without retry' {
        $script:Fault = 'attach-failure'
        Expect-Failure { Invoke-Ai09SeedHostnameRepair -Mode Execute -GuestUnmountConfirmed } 'ATTACH_FAILED'
        Assert-True (@($script:Calls | Where-Object { $_ -eq 'Attach' }).Count -eq 1 -and $script:Calls.Contains('FailureReceipt')) 'Reattachment retried or hidden'
    }
    Test-RepairCase 'real exclusive file handle changes only the verified literal and rejects reapply' {
        $temp = Join-Path ([IO.Path]::GetTempPath()) ('ai09-repair-fixture-' + [guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($temp) | Out-Null
        $target = Join-Path $temp 'bridge.sh'
        try {
            [IO.File]::WriteAllBytes($target, $script:Original)
            function Assert-Ai09CollectionEnvironment { param($Scope, $SeedAttached)
                $other = $null; $blocked = $false
                try { $other = [IO.File]::Open($target, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite) }
                catch [IO.IOException] { $blocked = $true }
                finally { if ($other) { $other.Dispose() } }
                Assert-True $blocked 'Writer did not hold exclusive final handle'
            }
            function Get-Ai09WritableRepairRoot { param($Scope, $Mounted) $temp }
            function Assert-Ai09RepairRun { param($Scope, $Root) }
            & $script:RealWriter -Scope $script:Scope -Root $temp -Mounted $script:Vhd
            $actual = [IO.File]::ReadAllBytes($target)
            $expected = ConvertTo-Ai09RepairedScript $script:Original
            Assert-True ([Convert]::ToBase64String($actual) -ceq [Convert]::ToBase64String($expected)) 'Unexpected byte changes'
            Expect-Failure { & $script:RealWriter -Scope $script:Scope -Root $temp -Mounted $script:Vhd } 'ORIGINAL_SCRIPT_HASH_MISMATCH'
            Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -ceq [Convert]::ToBase64String($expected)) 'Reapply mutated'
            $tampered = [Text.Encoding]::UTF8.GetBytes('tampered')
            [IO.File]::WriteAllBytes($target, $tampered)
            Expect-Failure { & $script:RealWriter -Scope $script:Scope -Root $temp -Mounted $script:Vhd } 'ORIGINAL_SCRIPT_HASH_MISMATCH'
            Assert-True ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($target)) -ceq 'tampered') 'Wrong hash mutated'
        } finally {
            if ([IO.File]::Exists($target)) { [IO.File]::Delete($target) }
            [IO.Directory]::Delete($temp, $false)
        }
    }
    Test-RepairCase 'real backup is byte exact and never overwrites an existing backup' {
        $temp = Join-Path ([IO.Path]::GetTempPath()) ('ai09-repair-backup-fixture-' + [guid]::NewGuid().ToString('N'))
        $target = Join-Path $temp 'bridge.sh.original'
        try {
            & $script:RealBackup -Directory $temp -Original $script:Original
            Assert-True ((Get-Ai09RepairHash ([IO.File]::ReadAllBytes($target))) -eq (Get-Ai09RepairHash $script:Original)) 'Backup changed bytes'
            Expect-Failure { & $script:RealBackup -Directory $temp -Original $script:Original } 'BACKUP_DIRECTORY_EXISTS'
        } finally {
            if ([IO.File]::Exists($target)) { [IO.File]::Delete($target) }
            if ([IO.Directory]::Exists($temp)) { [IO.Directory]::Delete($temp, $false) }
        }
    }

    Test-RepairCase 'entry rejects either untrusted helper and holds both trusted handles through argument delivery' {
        $temp = Join-Path ([IO.Path]::GetTempPath()) ('ai09-repair-entry-fixture-' + [guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($temp) | Out-Null
        $entry = Join-Path $temp 'ai09-repair-seed-hostname.ps1'
        $prepare = Join-Path $temp 'ai09-prepare-bootstrap-disk.ps1'
        $collector = Join-Path $temp 'ai09-collect-bootstrap-result.ps1'
        $source = [IO.File]::ReadAllText($path)
        $preparePin = 'E6E7B482E112609749C6982F051B1D35842EEE51FCDC563F4E9408B1D3C15B6B'
        $collectorPin = '6A0E4D4264825A8D38C749F74BF9706FCCD39B59BDF8CF22CB8BFD3B6975F391'
        Assert-True ((Get-FileHash -LiteralPath (Join-Path $RepositoryRoot 'scripts/ai09-prepare-bootstrap-disk.ps1') -Algorithm SHA256).Hash -eq $preparePin) 'Production prepare pin stale'
        Assert-True ((Get-FileHash -LiteralPath (Join-Path $RepositoryRoot 'scripts/ai09-collect-bootstrap-result.ps1') -Algorithm SHA256).Hash -eq $collectorPin) 'Production collector pin stale'
        Assert-True ($source.Contains($preparePin) -and $source.Contains($collectorPin)) 'Production entry pins absent'
        $fakePrepare = '$Mode = ''Verify''; $GuestUnmountConfirmed = $false'
        $fakeCollector = @'
$Mode = 'Verify'; $GuestUnmountConfirmed = $false
function Invoke-Ai09SeedHostnameRepair {
    param($Mode, [switch]$GuestUnmountConfirmed)
    $blocked = 0
    foreach ($name in @('ai09-prepare-bootstrap-disk.ps1', 'ai09-collect-bootstrap-result.ps1')) {
        $other = $null
        try { $other = [IO.File]::Open((Join-Path $PSScriptRoot $name), [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite) }
        catch [IO.IOException] { $blocked++ }
        finally { if ($other) { $other.Dispose() } }
    }
    [pscustomobject]@{ Mode = $Mode; Confirmed = [bool]$GuestUnmountConfirmed; LockedHelpers = $blocked }
}
'@
        $utf8 = [Text.UTF8Encoding]::new($false)
        function Invoke-EntryFixture {
            $engine = if ($env:OS -eq 'Windows_NT') { (Get-Command powershell.exe).Source } else { (Get-Command pwsh).Source }
            $start = [Diagnostics.ProcessStartInfo]::new()
            $start.FileName = $engine
            $start.Arguments = '-NoProfile -File "' + $entry + '" -Mode Execute -GuestUnmountConfirmed'
            $start.UseShellExecute = $false; $start.CreateNoWindow = $true
            $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
            if ($env:OS -eq 'Windows_NT') { $start.EnvironmentVariables.Remove('PSModulePath') }
            $process = [Diagnostics.Process]::Start($start)
            try {
                $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd()
                if (-not $process.WaitForExit(20000)) { $process.Kill(); throw 'ENTRY_FIXTURE_TIMEOUT' }
                [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
            } finally { $process.Dispose() }
        }
        try {
            [IO.File]::WriteAllText($prepare, $fakePrepare, $utf8)
            [IO.File]::WriteAllText($collector, $fakeCollector, $utf8)
            [IO.File]::WriteAllText($entry, $source, $utf8)
            $mismatch = Invoke-EntryFixture
            Assert-True ($mismatch.ExitCode -ne 0 -and $mismatch.Stderr -like '*REPAIR_HELPER_HASH_MISMATCH*' -and $mismatch.Stdout -notlike '*LockedHelpers*') 'Untrusted prepare executed'
            $trustedPrepare = $source.Replace($preparePin, (Get-FileHash -LiteralPath $prepare -Algorithm SHA256).Hash)
            [IO.File]::WriteAllText($entry, $trustedPrepare, $utf8)
            $mismatch = Invoke-EntryFixture
            Assert-True ($mismatch.ExitCode -ne 0 -and $mismatch.Stderr -like '*REPAIR_HELPER_HASH_MISMATCH*' -and $mismatch.Stdout -notlike '*LockedHelpers*') 'Untrusted collector executed'
            # Only the isolated fixture copy trusts harmless substitute helpers.
            $trustedBoth = $trustedPrepare.Replace($collectorPin, (Get-FileHash -LiteralPath $collector -Algorithm SHA256).Hash)
            [IO.File]::WriteAllText($entry, $trustedBoth, $utf8)
            $child = Invoke-EntryFixture
            Assert-True ($child.ExitCode -eq 0) ("Trusted fixture entry failed: " + $child.Stderr)
            $result = $child.Stdout | ConvertFrom-Json
            Assert-True ($result.Mode -eq 'Execute' -and $result.Confirmed -and $result.LockedHelpers -eq 2) 'Entry lost arguments or helper lock'
            foreach ($file in @($prepare, $collector)) {
                $handle = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
                $handle.Dispose()
            }
        } finally {
            foreach ($file in @($entry, $prepare, $collector)) { if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) } }
            [IO.Directory]::Delete($temp, $false)
        }
    }
} finally { $env:COMPUTERNAME = $previousComputer }
Write-Output "$script:Passed repair safety fixtures passed"
