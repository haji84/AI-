# Native PS 5.1 regression fixture. Every mutating host command is replaced here.
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '..\scripts\ai09-prepare-bootstrap-disk.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$mode = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Mode' })
if ($mode.Count -ne 1 -or $mode[0].DefaultValue.Value -ne 'Verify') { throw 'DEFAULT_VERIFY_REQUIRED' }
. $scriptPath
$script:Passed = 0
$script:SeedPath = 'C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx'
$script:ChildPath = 'C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx'
$script:ParentPath = 'C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu.vhdx'
function Reset-Fixture {
    $script:Calls = [Collections.Generic.List[string]]::new()
    $script:Fault = ''; $script:Checks = 0; $script:Exists = $false; $script:VmAttached = $false; $script:Parts = @()
    $script:Rules = @(1..4 | ForEach-Object {
        [pscustomobject]@{ Direction = $_; Action = 2; Weight = 1; LocalIPAddress = 'ANY'; RemoteIPAddress = 'ANY'
            LocalPort = 'ANY'; RemotePort = 'ANY'; Protocol = 'ANY'; Stateful = $false; IdleSessionTimeout = 0 }
    })
    $script:Expected = Get-Ai09AclSha256 $script:Rules
    $script:Vhd = [pscustomobject]@{ Path = $script:SeedPath; DiskIdentifier = 'new-id'; Size = 256MB; VhdType = 'Dynamic'; Attached = $false; DiskNumber = 9 }
    $script:Disk = [pscustomobject]@{ Number = 9; UniqueId = 'unique-seed'; Size = 256MB; IsBoot = $false; IsSystem = $false
        IsReadOnly = $false; IsOffline = $false; PartitionStyle = 'RAW'; Signature = 12345 }
}
function Add-Call([string]$Name) { $script:Calls.Add($Name) }
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Body, [string]$Message) {
    $caught = ''
    try { $null = & $Body } catch { $caught = $_.Exception.Message }
    Assert-True ($caught -like "*$Message*") ("Expected $Message; actual $caught")
}
function Test-Case([string]$Name, [scriptblock]$Body) {
    Reset-Fixture
    & $Body
    $script:Passed++
    Write-Output "PASS $Name"
}
function Assert-Ai09Administrator { Add-Call 'AdminCheck' }
function Assert-Ai09Path {
    param([string]$Path)
    # Dedicated path tests below execute the original function.
    if ($script:Fault -eq 'reparse') { throw 'REPARSE_PATH_REFUSED' }
}
function Get-VM { [CmdletBinding()]param($Name)
    [pscustomobject]@{ Name = 'GORIQ-AI09-Ubuntu'; Id = '453b139b-cceb-446e-99fb-f45bf5895436'; State = 'Running' }
}
function Get-Process { [CmdletBinding()]param($Name)
    if ($Name -eq 'Runner.Listener') { $script:Checks++; return [pscustomobject]@{ Id = 1 } }
    if (($script:Fault -eq 'runner-before-initialize' -and $script:Checks -ge 4) -or
        ($script:Fault -eq 'runner-before-attach' -and $script:Checks -ge 8)) { return [pscustomobject]@{ Id = 2 } }
}
function Get-VMHardDiskDrive { param($VMName)
    $root = [pscustomobject]@{ Path = $script:ChildPath; ControllerType = 'SCSI'; ControllerNumber = 0; ControllerLocation = 0 }
    if ($script:Fault -eq 'root-slot') { $root.ControllerLocation = 1 }
    $root
    if ($script:VmAttached) { [pscustomobject]@{ Path = $script:SeedPath; ControllerType = 'SCSI'; ControllerNumber = 0; ControllerLocation = 2 } }
}
function Get-VMNetworkAdapter { param($VMName)
    [pscustomobject]@{ SwitchName = 'Default Switch'; MacAddress = '00155DDC2C00'
        Id = 'Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D' }
}
function Get-VMNetworkAdapterExtendedAcl { param($VMName)
    if ($script:Fault -eq 'acl-same-count') { $script:Rules[0].Action = 1 }
    $script:Rules
}
function Test-Path { param($LiteralPath) if ($LiteralPath -eq $script:SeedPath) { return $script:Exists }; return $false }
function Get-PSDrive { param($Name) [pscustomobject]@{ Free = 100GB } }
function New-Item { param($Path, $ItemType, [switch]$Force) Add-Call 'Directory' }
function New-VHD { param($Path, [switch]$Dynamic, $SizeBytes) Add-Call 'New'; $script:Exists = $true }
function Get-VHD { [CmdletBinding()]param($Path)
    if ($Path -eq $script:ChildPath -or $Path -eq $script:ParentPath) {
        $isChild = $Path -eq $script:ChildPath
        $parent = if ($isChild) { $script:ParentPath } else { '' }
        if ($script:Fault -eq 'wrong-chain') { $parent = 'C:\unrelated.vhdx' }
        return [pscustomobject]@{ Path = $Path; DiskIdentifier = '9D28872E-0087-4A33-ABFA-AE0DEF1E66B8'; Size = 40GB
            VhdFormat = 'VHDX'; VhdType = $(if ($isChild) { 'Differencing' } else { 'Dynamic' }); ParentPath = $parent }
    }
    return $script:Vhd
}
function Mount-VHD { [CmdletBinding()]param($Path, [switch]$PassThru)
    Add-Call 'Mount'; $script:Vhd.Attached = $true
    if ($script:Fault -eq 'partial-mount') { throw 'MOUNT_FAILED_AFTER_ATTACH' }
    if ($script:Fault -eq 'system-disk') { $script:Vhd.DiskNumber = 0; $script:Disk.Number = 0 }
    return $script:Vhd
}
function Get-Disk { [CmdletBinding()]param($Number, [Parameter(ValueFromPipeline = $true)]$InputObject)
    process { if ($null -ne $InputObject) { return [pscustomobject]@{ Number = 0 } }; return $script:Disk }
}
function Get-Partition { [CmdletBinding()]param($DriveLetter, $DiskNumber)
    if ($DriveLetter) { return [pscustomobject]@{ DiskNumber = 0 } }
    return $script:Parts
}
function Initialize-Disk { param($Number, $PartitionStyle) Add-Call 'Initialize'; $script:Disk.PartitionStyle = $PartitionStyle }
function New-Partition { param($DiskNumber, [switch]$UseMaximumSize, [switch]$AssignDriveLetter)
    Add-Call 'Partition'
    $script:Parts = @([pscustomobject]@{ DiskNumber = $DiskNumber; PartitionNumber = 1; DriveLetter = 'Z' })
    if ($script:Fault -eq 'wrong-partition') { $script:Parts[0].DiskNumber = 0 }
    return $script:Parts[0]
}
function Format-Volume { param($Partition, $FileSystem, $NewFileSystemLabel, $Confirm, [switch]$Force)
    Add-Call 'Format'
    if ($script:Fault -eq 'format-failed') { throw 'FORMAT_FAILED' }
}
function Write-Ai09SeedFiles { param($Identity, $Partition, $RunId) Add-Call 'Write'; return @{ RunId = $RunId } }
function Dismount-VHD { [CmdletBinding()]param($Path)
    Add-Call 'Dismount'
    if ($script:Fault -eq 'dismount-failed') { throw 'DISMOUNT_FAILED' }
    if ($script:Fault -ne 'dismount-noop') { $script:Vhd.Attached = $false }
}
function Add-VMHardDiskDrive { param($VMName, $ControllerType, $ControllerNumber, $ControllerLocation, $Path)
    Add-Call 'Attach'; Assert-True (-not $script:Vhd.Attached) 'Concurrent host/guest attach'
    $script:VmAttached = $true
}

$previousComputer = $env:COMPUTERNAME
$env:COMPUTERNAME = 'HAJI'
try {
    Test-Case 'default Verify performs zero mutations' {
        $r = Invoke-Ai09Bootstrap
        Assert-True ($r.Status -eq 'VERIFIED_READ_ONLY' -and $script:Calls.Count -eq 0) 'Verify mutated'
    }
    Test-Case 'Execute requires independently reviewed ACL digest' {
        Expect-Failure { Invoke-Ai09Bootstrap -Mode Execute } 'REVIEWED_ACL_HASH_REQUIRED'
        Assert-True ($script:Calls.Count -eq 0) 'Missing digest mutated'
    }
    Test-Case 'same ACL count but widened rule refuses' {
        $script:Fault = 'acl-same-count'
        Expect-Failure { Invoke-Ai09Bootstrap -Mode Execute -ExpectedAclSha256 $script:Expected } 'VM_ACL_CHANGED'
        Assert-True ($script:Calls.Count -eq 0) 'Changed ACL mutated'
    }
    Test-Case 'existing seed refuses without retry or overwrite' {
        $script:Exists = $true
        Expect-Failure { Invoke-Ai09Bootstrap -Mode Execute -ExpectedAclSha256 $script:Expected } 'SEED_ALREADY_EXISTS'
        Assert-True ($script:Calls.Count -eq 0) 'Existing disk touched'
    }
    foreach ($caseName in @('reparse', 'root-slot', 'wrong-chain')) {
        Test-Case "unsafe baseline $caseName refuses" {
            $script:Fault = $caseName
            $expectedError = @{ reparse = 'REPARSE'; 'root-slot' = 'VM_DISKS'; 'wrong-chain' = 'OS_CHAIN' }[$caseName]
            Expect-Failure { Invoke-Ai09Bootstrap -Mode Execute -ExpectedAclSha256 $script:Expected } $expectedError
            Assert-True ($script:Calls.Count -eq 0) 'Baseline failure mutated'
        }
    }
    Test-Case 'safe fresh seed dismounts before guest attachment' {
        $r = Invoke-Ai09Bootstrap -Mode Execute -ExpectedAclSha256 $script:Expected
        Assert-True ($r.Status -eq 'SEED_ATTACHED_GUEST_NOT_EXECUTED') 'False completion status'
        Assert-True (($script:Calls -join ',') -eq 'AdminCheck,Directory,New,Mount,Initialize,Partition,Format,Write,Dismount,Attach') 'Wrong mutation order'
    }
    foreach ($caseName in @('partial-mount', 'system-disk', 'runner-before-initialize')) {
        Test-Case "$caseName cleans mount without disk initialization" {
            $script:Fault = $caseName
            $expectedError = @{ 'partial-mount' = 'MOUNT_FAILED'; 'system-disk' = 'UNSAFE_SEED'; 'runner-before-initialize' = 'GORIQ_JOB_ACTIVE' }[$caseName]
            Expect-Failure { Invoke-Ai09Bootstrap -Mode Execute -ExpectedAclSha256 $script:Expected } $expectedError
            Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Initialize') -and -not $script:Calls.Contains('Attach')) 'Unsafe failure path'
        }
    }
    foreach ($caseName in @('wrong-partition', 'format-failed', 'dismount-failed', 'dismount-noop', 'runner-before-attach')) {
        Test-Case "$caseName never attaches to guest" {
            $script:Fault = $caseName
            $expectedError = @{ 'wrong-partition' = 'UNSAFE_PARTITION'; 'format-failed' = 'FORMAT_FAILED'; 'dismount-failed' = 'DISMOUNT_FAILED'
                'dismount-noop' = 'SEED_STILL_HOST_MOUNTED'; 'runner-before-attach' = 'GORIQ_JOB_ACTIVE' }[$caseName]
            Expect-Failure { Invoke-Ai09Bootstrap -Mode Execute -ExpectedAclSha256 $script:Expected } $expectedError
            Assert-True (-not $script:Calls.Contains('Attach')) 'Attached after failure'
            if ($caseName -eq 'wrong-partition') { Assert-True (-not $script:Calls.Contains('Format')) 'Formatted wrong partition' }
        }
    }
    Test-Case 'seed UniqueId change refuses before initialize' {
        $script:Vhd.Attached = $true
        $id = @{ Path = $script:SeedPath; Identifier = 'new-id'; Number = 9; UniqueId = 'other-disk' }
        Expect-Failure { Assert-Ai09SeedDisk $id -RequireRaw } 'UNSAFE_SEED_DISK'
        Assert-True ($script:Calls.Count -eq 0) 'Identity mismatch mutated'
    }
    Test-Case 'guest embeds independent run/FAT/partition identities and no early receipt' {
        $guest = New-Ai09GuestScript -RunId ('a' * 32) -FsUuid '1234-ABCD' -PartUuid '1234abcd-01'
        Assert-True ($guest.Contains('UUID -o value "$seed_device")" = 1234-ABCD')) 'Missing FS identity'
        Assert-True ($guest.Contains('PARTUUID -o value "$seed_device")" = 1234abcd-01')) 'Missing partition identity'
        Assert-True ($guest.IndexOf('exec 3>') -gt $guest.IndexOf('cat /mnt/seed.id')) 'Premature result write'
        Assert-True ($guest.Contains('EXIT_CODE=%s') -and $guest.Contains('trap finish EXIT') -and -not $guest.Contains('|| true')) 'Hidden guest errors'
        Assert-True ($guest.Contains('! -L /run/systemd/network/10-ai09.network')) 'Symlink overwrite possible'
    }
    if ([Environment]::OSVersion.Platform -eq 'Win32NT') {
    # Real path guard with mocked filesystem reads; no host filesystem mutation.
    $pathFunction = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Assert-Ai09Path' }, $true)
    Invoke-Expression $pathFunction.Extent.Text
    function Test-Path { param($LiteralPath) return $true }
    function Get-Item { param($LiteralPath, [switch]$Force)
        [pscustomobject]@{ Attributes = $(if ($LiteralPath -eq 'C:\GORIQ-AI09\Bootstrap') { [IO.FileAttributes]::ReparsePoint } else { [IO.FileAttributes]::Directory }) }
    }
    Expect-Failure { Assert-Ai09Path $script:SeedPath } 'REPARSE_PATH_REFUSED'
    $script:Passed++; Write-Output 'PASS real path guard rejects ancestor junction'
    }
    Write-Output "AI09_FIXTURE_PASS=$script:Passed; REAL_DISK_MUTATIONS=0"
} finally { $env:COMPUTERNAME = $previousComputer }
