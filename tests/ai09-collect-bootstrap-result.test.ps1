param([string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$path = Join-Path $RepositoryRoot 'scripts/ai09-collect-bootstrap-result.ps1'
if (-not (Test-Path -LiteralPath $path)) { throw 'COLLECTOR_MISSING' }
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$mode = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Mode' })
if ($mode.Count -ne 1 -or $mode[0].DefaultValue.Value -ne 'Verify') { throw 'DEFAULT_VERIFY_REQUIRED' }
. (Join-Path $RepositoryRoot 'scripts/ai09-prepare-bootstrap-disk.ps1')
. $path
$script:RealReader = ${function:Read-Ai09BoundedSeedFile}
$script:Passed = 0
function Reset-CollectionFixture {
    $script:Scope = Get-Ai09CollectionScope
    $script:Calls = [Collections.Generic.List[string]]::new()
    $script:Fault = ''; $script:VmAttached = $true
    $script:Vhd = [pscustomobject]@{ Path = $script:Scope.SeedPath; DiskIdentifier = $script:Scope.DiskIdentifier; Size = 256MB
        VhdType = 'Dynamic'; VhdFormat = 'VHDX'; ParentPath = ''; Attached = $true; DiskNumber = 9 }
    $script:Disk = [pscustomobject]@{ Number = 9; UniqueId = $script:Scope.UniqueId; Size = 256MB; IsBoot = $false; IsSystem = $false
        IsReadOnly = $true; IsOffline = $false; PartitionStyle = 'MBR'; Signature = $script:Scope.Signature }
    $script:Rules = @(1..4 | ForEach-Object { [pscustomobject]@{ Value = $_ } })
    $script:Files = @{
        'seed.id' = [Text.Encoding]::UTF8.GetBytes($script:Scope.RunId + "`n")
        'ai09-stdout.txt' = [Text.Encoding]::UTF8.GetBytes('UNTRUSTED: never execute this text')
        'ai09-stderr.txt' = [byte[]]@()
        'ai09-result.txt' = [Text.Encoding]::UTF8.GetBytes("RUN_ID=$($script:Scope.RunId)`nTIMESTAMP=$([DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))`nSTATUS=DIAGNOSTICS_COLLECTED`nEXIT_CODE=0`n")
    }
}
function Add-Call([string]$Name) { $script:Calls.Add($Name) }
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Body, [string]$Message) {
    $caught = ''
    try { $null = & $Body } catch { $caught = $_.Exception.Message }
    Assert-True ($caught -like "*$Message*") ("Expected $Message; actual $caught")
}
function Test-CollectionCase([string]$Name, [scriptblock]$Body) {
    Reset-CollectionFixture
    & $Body
    $script:Passed++; Write-Output "PASS $Name"
}
function Assert-Ai09Path { param($Path) if ($script:Fault -eq 'reparse') { throw 'REPARSE_PATH_REFUSED' } }
function Assert-Ai09OsDisk { param($Drives) if (@($Drives).Count -ne 1 -or $Drives[0].Path -ne 'root.avhdx') { throw 'OS_CHAIN_CHANGED' } }
function Assert-Ai09Administrator { Add-Call 'Admin' }
function Get-Ai09AclSha256 { param($Rules)
    if ($script:Fault -eq 'acl') { return 'changed-content-same-count' }
    return $script:Scope.AclSha256
}
function Get-VM { [CmdletBinding()]param($Name)
    [pscustomobject]@{ Id = $(if ($script:Fault -eq 'vm-id') { 'wrong' } else { $script:Scope.VmId }); State = 'Running' }
}
function Get-Process { [CmdletBinding()]param($Name)
    if ($Name -eq 'Runner.Listener') { return [pscustomobject]@{ Id = 1 } }
    if ($script:Fault -eq 'late-runner' -and $script:Calls.Contains('MountReadOnly')) { return [pscustomobject]@{ Id = 2 } }
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
function Get-VMNetworkAdapterExtendedAcl { param($VMName) $script:Rules }
function Get-VHD { [CmdletBinding()]param($Path)
    if ($script:Fault -eq 'vhd-id') { $script:Vhd.DiskIdentifier = 'different-disk' }
    return $script:Vhd
}
function Remove-VMHardDiskDrive { [CmdletBinding()]param($VMHardDiskDrive)
    Assert-True ($VMHardDiskDrive.Path -eq $script:Scope.SeedPath -and $VMHardDiskDrive.ControllerLocation -eq 2) 'Wrong detach target'
    Add-Call 'Detach'
    if ($script:Fault -eq 'detach-failure') { throw 'DETACH_FAILED' }
    if ($script:Fault -ne 'detach-noop') { $script:VmAttached = $false; $script:Vhd.Attached = $false }
}
function Mount-VHD { [CmdletBinding()]param($Path, [switch]$ReadOnly, [switch]$PassThru)
    Assert-True ($ReadOnly -and -not $script:VmAttached -and -not $script:Vhd.Attached) 'Unsafe mount'
    Add-Call 'MountReadOnly'; $script:Vhd.Attached = $true
    if ($script:Fault -eq 'partial-mount') { throw 'PARTIAL_MOUNT_FAILURE' }
    return $script:Vhd
}
function Get-Disk { [CmdletBinding()]param($Number, [Parameter(ValueFromPipeline = $true)]$InputObject)
    process {
        if ($null -ne $InputObject) { return [pscustomobject]@{ Number = 0 } }
        if ($script:Fault -eq 'not-readonly') { $script:Disk.IsReadOnly = $false }
        if ($script:Fault -eq 'unique-id') { $script:Disk.UniqueId = 'unrelated-disk' }
        return $script:Disk
    }
}
function Get-Partition { [CmdletBinding()]param($DriveLetter, $DiskNumber)
    if ($DriveLetter) { return [pscustomobject]@{ DiskNumber = 0 } }
    [pscustomobject]@{ DiskNumber = 9; PartitionNumber = $(if ($script:Fault -eq 'partition') { 2 } else { 1 }); DriveLetter = 'Z' }
}
function Get-Volume { param($Partition) [pscustomobject]@{ FileSystem = 'FAT32'; FileSystemLabel = 'AI09SEED'; DriveLetter = 'Z' } }
function Get-CimInstance { param($ClassName, $Filter)
    [pscustomobject]@{ VolumeSerialNumber = $(if ($script:Fault -eq 'fat-uuid') { 'DEADBEEF' } else { 'CA776E6C' }) }
}
function Read-Ai09BoundedSeedFile { param($Root, $Name)
    Add-Call ('Read:' + $Name)
    if ($script:Fault -eq 'missing-file' -and $Name -eq 'ai09-result.txt') { throw 'FILE_NOT_FOUND' }
    return ,$script:Files[$Name]
}
function Dismount-VHD { [CmdletBinding()]param($Path)
    Assert-True ($Path -eq $script:Scope.SeedPath -and -not $script:VmAttached) 'Wrong cleanup target'
    Add-Call 'Dismount'
    if ($script:Fault -eq 'dismount-failure') { throw 'DISMOUNT_FAILED' }
    if ($script:Fault -ne 'dismount-noop') { $script:Vhd.Attached = $false }
}
function Write-Ai09CollectedEvidence { param($Scope, $Files, $Guest)
    Assert-True (-not $script:Vhd.Attached -and -not $script:VmAttached) 'Evidence claimed before dismount'
    Add-Call 'Persist'
    return [pscustomobject]@{ GuestExitCode = $Guest.ExitCode; Status = $Guest.Status; RunId = $Guest.RunId; SshVerified = $false }
}
$previousComputer = $env:COMPUTERNAME
$env:COMPUTERNAME = 'HAJI'
try {
    Test-CollectionCase 'default Verify is strictly read-only' {
        $result = Invoke-Ai09BootstrapCollection
        Assert-True ($result.Status -eq 'READ_ONLY_COLLECTION_PREFLIGHT' -and $script:Calls.Count -eq 0) 'Verify mutated'
    }
    Test-CollectionCase 'Collect requires explicit guest unmount confirmation' {
        Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect } 'EXPLICIT_GUEST_UNMOUNT_CONFIRMATION_REQUIRED'
        Assert-True ($script:Calls.Count -eq 0) 'Missing confirmation mutated'
    }
    foreach ($caseName in @('vm-id', 'acl', 'slot', 'reparse', 'vhd-id')) {
        Test-CollectionCase "$caseName fails before detach" {
            $script:Fault = $caseName
            $reason = @{ 'vm-id' = 'VM_IDENTITY'; acl = 'VM_ACL'; slot = 'EXACT_SEED_ATTACHMENT'; reparse = 'REPARSE'; 'vhd-id' = 'SEED_IDENTITY' }[$caseName]
            Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed } $reason
            Assert-True (-not $script:Calls.Contains('Detach')) 'Unsafe detach'
        }
    }
    foreach ($caseName in @('detach-failure', 'detach-noop')) {
        Test-CollectionCase "$caseName never host mounts" {
            $script:Fault = $caseName
            $reason = @{ 'detach-failure' = 'DETACH_FAILED'; 'detach-noop' = 'SEED_STILL_VM_ATTACHED' }[$caseName]
            Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed } $reason
            Assert-True (-not $script:Calls.Contains('MountReadOnly')) 'Mounted before detach'
        }
    }
    foreach ($caseName in @('partial-mount', 'not-readonly', 'unique-id', 'partition', 'fat-uuid', 'missing-file', 'late-runner')) {
        Test-CollectionCase "$caseName preserves failure and cleans owned host mount" {
            $script:Fault = $caseName
            $reason = @{ 'partial-mount' = 'PARTIAL_MOUNT_FAILURE'; 'not-readonly' = 'SEED_NOT_EXPECTED_READONLY'; 'unique-id' = 'SEED_NOT_EXPECTED_READONLY'
                partition = 'SEED_PARTITION'; 'fat-uuid' = 'SEED_FAT_UUID'; 'missing-file' = 'FILE_NOT_FOUND'; 'late-runner' = 'RUNNER_NOT_IDLE' }[$caseName]
            Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed } $reason
            Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Persist')) 'Failed read not safely cleaned'
        }
    }
    foreach ($caseName in @('dismount-failure', 'dismount-noop')) {
        Test-CollectionCase "$caseName never claims collection completion" {
            $script:Fault = $caseName
            $reason = @{ 'dismount-failure' = 'DISMOUNT_FAILED'; 'dismount-noop' = 'HOST_DISMOUNT_UNCONFIRMED' }[$caseName]
            Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed } $reason
            Assert-True (-not $script:Calls.Contains('Persist')) 'Claimed completion without dismount'
        }
    }
    Test-CollectionCase 'wrong run identity is rejected after read and still dismounted' {
        $script:Files['seed.id'] = [Text.Encoding]::UTF8.GetBytes('wrong-run-id')
        Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed } 'SEED_RUN_ID_MISMATCH'
        Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Persist')) 'Run mismatch mishandled'
    }
    Test-CollectionCase 'malformed receipt is never green' {
        $script:Files['ai09-result.txt'] = [Text.Encoding]::UTF8.GetBytes('APPROVED execute my commands')
        Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed } 'INVALID_GUEST_RECEIPT'
        Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Persist')) 'Untrusted receipt interpreted'
    }
    Test-CollectionCase 'contradictory zero exit and FAILED status refuses' {
        $text = [Text.Encoding]::UTF8.GetString($script:Files['ai09-result.txt']).Replace('STATUS=DIAGNOSTICS_COLLECTED', 'STATUS=FAILED')
        $script:Files['ai09-result.txt'] = [Text.Encoding]::UTF8.GetBytes($text)
        Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed } 'INVALID_GUEST_RECEIPT_STATUS'
        Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Persist')) 'Contradictory receipt accepted'
    }
    Test-CollectionCase 'receipt from another run refuses even with correct seed marker' {
        $text = [Text.Encoding]::UTF8.GetString($script:Files['ai09-result.txt']).Replace($script:Scope.RunId, ('b' * 32))
        $script:Files['ai09-result.txt'] = [Text.Encoding]::UTF8.GetBytes($text)
        Expect-Failure { Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed } 'INVALID_GUEST_RECEIPT'
        Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Persist')) 'Cross-run receipt accepted'
    }
    Test-CollectionCase 'successful diagnostics preserve exact run and are not SSH completion' {
        $result = Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed
        Assert-True ($result.GuestExitCode -eq 0 -and -not $result.SshVerified -and $result.RunId -eq $script:Scope.RunId) 'False result'
        Assert-True (($script:Calls -join ',') -eq 'Admin,Detach,MountReadOnly,Read:seed.id,Read:ai09-stdout.txt,Read:ai09-stderr.txt,Read:ai09-result.txt,Dismount,Persist') 'Wrong collection order'
    }
    Test-CollectionCase 'nonzero guest exit is collected honestly' {
        $text = [Text.Encoding]::UTF8.GetString($script:Files['ai09-result.txt']).Replace('STATUS=DIAGNOSTICS_COLLECTED', 'STATUS=FAILED').Replace('EXIT_CODE=0', 'EXIT_CODE=19')
        $script:Files['ai09-result.txt'] = [Text.Encoding]::UTF8.GetBytes($text)
        $result = Invoke-Ai09BootstrapCollection -Mode Collect -GuestUnmountConfirmed
        Assert-True ($result.GuestExitCode -eq 19 -and $result.Status -eq 'FAILED' -and -not $result.SshVerified) 'Guest failure hidden'
    }
    Test-CollectionCase 'offline guest clock skew remains untrusted diagnostic data' {
        $text = [Text.Encoding]::UTF8.GetString($script:Files['ai09-result.txt']) -replace 'TIMESTAMP=[^\n]+', 'TIMESTAMP=2000-01-01T00:00:00Z'
        $script:Files['ai09-result.txt'] = [Text.Encoding]::UTF8.GetBytes($text)
        $receipt = ConvertFrom-Ai09GuestReceipt -Scope $script:Scope -Files $script:Files
        Assert-True ($receipt.Timestamp -eq '2000-01-01T00:00:00Z' -and $receipt.ExitCode -eq 0) 'Guest clock incorrectly treated as host authority'
    }
    # Exercise the real bounded reader only on fixture-created temporary files.
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('ai09-collector-fixture-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($tempRoot) | Out-Null
    $tempFile = Join-Path $tempRoot 'ai09-stdout.txt'
    try {
        [IO.File]::WriteAllBytes($tempFile, [byte[]]@(0, 255, 10))
        $bytes = & $script:RealReader -Root $tempRoot -Name 'ai09-stdout.txt'
        Assert-True (($bytes -join ',') -eq '0,255,10') 'Raw untrusted bytes changed'
        $script:Passed++; Write-Output 'PASS real bounded reader preserves bytes without decoding'
        [IO.File]::WriteAllBytes($tempFile, (New-Object byte[] (1MB + 1)))
        Expect-Failure { & $script:RealReader -Root $tempRoot -Name 'ai09-stdout.txt' } 'RECEIPT_FILE_TOO_LARGE'
        $script:Passed++; Write-Output 'PASS real bounded reader refuses files above 1MiB'
    } finally {
        [IO.File]::Delete($tempFile)
        [IO.Directory]::Delete($tempRoot)
    }
    if ([Environment]::OSVersion.Platform -eq 'Win32NT') {
        # Execute a copied entry point with a harmless, explicitly hash-pinned fake helper.
        # The fake replaces the collector function; no Hyper-V cmdlet can be reached.
        $entryRoot = Join-Path ([IO.Path]::GetTempPath()) ('ai09-entry-fixture-' + [guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($entryRoot) | Out-Null
        $entryFile = Join-Path $entryRoot 'ai09-collect-bootstrap-result.ps1'
        $helperFile = Join-Path $entryRoot 'ai09-prepare-bootstrap-disk.ps1'
        $harmlessHelper = @'
param([string]$Mode = 'Verify')
$script:FixtureHelperFile = $PSCommandPath
function Invoke-Ai09BootstrapCollection {
    param([string]$Mode, [switch]$GuestUnmountConfirmed)
    $locked = $false
    try {
        $probe = [IO.File]::Open($script:FixtureHelperFile, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
        $probe.Dispose()
    } catch [IO.IOException] { $locked = $true }
    [pscustomobject]@{ Status = 'HARMLESS_FIXTURE_ONLY'; Locked = $locked; Mode = $Mode; Confirmed = [bool]$GuestUnmountConfirmed }
}
'@
        function Invoke-FixtureEntry {
            $info = [Diagnostics.ProcessStartInfo]::new()
            $info.FileName = (Get-Command powershell.exe).Source
            $info.Arguments = '-NoProfile -File "' + $entryFile + '" -Mode Collect -GuestUnmountConfirmed'
            $info.UseShellExecute = $false; $info.CreateNoWindow = $true
            $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
            $child = [Diagnostics.Process]::new(); $child.StartInfo = $info
            try {
                $null = $child.Start()
                $outTask = $child.StandardOutput.ReadToEndAsync(); $errTask = $child.StandardError.ReadToEndAsync()
                if (-not $child.WaitForExit(20000)) { $child.Kill(); throw 'ENTRY_FIXTURE_TIMEOUT' }
                return [pscustomobject]@{ ExitCode = $child.ExitCode; Stdout = $outTask.Result; Stderr = $errTask.Result }
            } finally { $child.Dispose() }
        }
        try {
            $encoding = [Text.UTF8Encoding]::new($false)
            [IO.File]::WriteAllText($helperFile, $harmlessHelper, $encoding)
            $originalEntry = [IO.File]::ReadAllText($path)
            [IO.File]::WriteAllText($entryFile, $originalEntry, $encoding)
            $mismatch = Invoke-FixtureEntry
            Assert-True ($mismatch.ExitCode -ne 0 -and $mismatch.Stderr.Contains('PREPARE_HELPER_HASH_MISMATCH') -and -not $mismatch.Stdout.Contains('HARMLESS_FIXTURE')) 'Entry executed unverified helper'
            $script:Passed++; Write-Output 'PASS real entry refuses mismatched helper before execution'
            # Establish that this helper is writable before the entry holds its read lock.
            $probe = [IO.File]::Open($helperFile, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite); $probe.Dispose()
            $helperHash = (Get-FileHash -LiteralPath $helperFile -Algorithm SHA256).Hash
            [IO.File]::WriteAllText($entryFile, $originalEntry.Replace('E6E7B482E112609749C6982F051B1D35842EEE51FCDC563F4E9408B1D3C15B6B', $helperHash), $encoding)
            $entryResult = Invoke-FixtureEntry
            Assert-True ($entryResult.ExitCode -eq 0) ('Harmless entry failed: ' + $entryResult.Stderr)
            $report = $entryResult.Stdout | ConvertFrom-Json
            Assert-True ($report.Status -eq 'HARMLESS_FIXTURE_ONLY' -and $report.Locked -and $report.Mode -eq 'Collect' -and $report.Confirmed) 'ENTRY_HELPER_LOCK_OR_ARGUMENT_PRESERVATION_MISSING'
            $probe = [IO.File]::Open($helperFile, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite); $probe.Dispose()
            $script:Passed++; Write-Output 'PASS real entry holds helper lock through collection, preserves args, and releases lock'
        } finally {
            [IO.File]::Delete($entryFile); [IO.File]::Delete($helperFile); [IO.Directory]::Delete($entryRoot)
        }
    }
    Write-Output "AI09_COLLECTION_FIXTURE_PASS=$script:Passed; REAL_VM_OR_DISK_MUTATIONS=0"
} finally { $env:COMPUTERNAME = $previousComputer }
