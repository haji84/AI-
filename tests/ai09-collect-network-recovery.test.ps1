param([string]$RepositoryRoot=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
$path=Join-Path $RepositoryRoot 'scripts/ai09-collect-network-recovery.ps1'
if(-not(Test-Path -LiteralPath $path)){throw 'RECOVERY_COLLECTOR_MISSING'}
. $path
$script:Passed=0
function Assert-True($Condition,$Message){if(-not $Condition){throw $Message}}
function Expect-Failure([scriptblock]$Body,$Message){$caught='';$threw=$false;try{& $Body | Out-Null}catch{$threw=$true;$caught=$_.Exception.Message};Assert-True ($threw -and $caught -like "*$Message*") "Expected $Message; got $caught"}
function New-ResultBytes($Status='DHCP_IPV4_VERIFIED',$ExitCode='0',$Phase='VERIFIED',$Created='1',$Address='172.29.80.20/20'){
    return ,([Text.Encoding]::UTF8.GetBytes("RUN_ID=network-recovery-20261016-v1`nSEED_RUN_ID=02ea2f0d324543a1ab2973e73c97421d`nTIMESTAMP=2026-10-16T00:00:00Z`nSTATUS=$Status`nEXIT_CODE=$ExitCode`nPHASE=$Phase`nCONFIG_CREATED=$Created`nIPV4=$Address`nORIGINAL_SHA256=ad37eaf039455b7f058d4da73c3fd008752787db45e952d343551d6f8b437fc9`n"))
}
function Test-Case($Name,[scriptblock]$Body){& $Body;$script:Passed++;"PASS $Name"}
Test-Case 'valid observed network result remains distinct from SSH verification' {
    $r=ConvertFrom-Ai09NetworkResult (New-ResultBytes)
    Assert-True ($r.ExitCode -eq 0 -and $r.Address -ceq '172.29.80.20/20' -and $r.Status -ceq 'DHCP_IPV4_VERIFIED') 'Wrong parsed result'
}
Test-Case 'failed guest result preserves actual nonzero exit' {
    $r=ConvertFrom-Ai09NetworkResult (New-ResultBytes -Status FAILED -ExitCode 51 -Phase WAIT_DHCP -Created 1 -Address '')
    Assert-True ($r.ExitCode -eq 51 -and $r.Status -ceq 'FAILED') 'Guest failure hidden'
}
foreach($params in @(
    @{Status='FAILED'},@{ExitCode='7'},@{Phase='WAIT_DHCP'},@{Created='0'},
    @{Address=''},@{Address='172.29.96.2/20'},@{Address='172.29.80.20/24'},@{Address='172.29.80.1/20'},
    @{Address='172.29.80.0/20'},@{Address='172.29.95.255/20'},@{ExitCode='256'}
)){
    Test-Case ('contradictory or invalid result rejected: '+($params | ConvertTo-Json -Compress)) {
        Expect-Failure {ConvertFrom-Ai09NetworkResult (New-ResultBytes @params)} 'INVALID_RECOVERY_RESULT'
    }
}
Test-Case 'different run and appended fields are refused' {
    $text=[Text.Encoding]::UTF8.GetString((New-ResultBytes))
    Expect-Failure {ConvertFrom-Ai09NetworkResult ([Text.Encoding]::UTF8.GetBytes($text.Replace('network-recovery-20261016-v1','different-run')))} 'INVALID_RECOVERY_RESULT'
    Expect-Failure {ConvertFrom-Ai09NetworkResult ([Text.Encoding]::UTF8.GetBytes($text+"EXTRA=yes`n"))} 'INVALID_RECOVERY_RESULT'
}
Test-Case 'invalid UTF8 and oversized result are refused' {
    Expect-Failure {ConvertFrom-Ai09NetworkResult ([byte[]]@(255,255))} 'INVALID_RECOVERY_RESULT'
    Expect-Failure {ConvertFrom-Ai09NetworkResult (New-Object byte[] 8193)} 'INVALID_RECOVERY_RESULT'
}
Test-Case 'collector requires explicit observed unmount before all native operations' {
    Expect-Failure {Invoke-Ai09NetworkCollection -Mode Collect} 'EXPLICIT_GUEST_UNMOUNT_CONFIRMATION_REQUIRED'
}
Test-Case 'collector requires an actually observed guest exit before native operations' {
    Expect-Failure {Invoke-Ai09NetworkCollection -Mode Collect -GuestUnmountConfirmed} 'OBSERVED_GUEST_EXIT_REQUIRED'
}

# Native collection is simulated here; no VM, disk or host report is accessed.
function Reset-NativeFixture {$script:VmAttached=$true;$script:HostAttached=$false;$script:Fault='';$script:Calls=[Collections.Generic.List[string]]::new()}
function Get-Ai09CollectionScope {[pscustomobject]@{SeedPath='fixed-seed';VmName='exact-vm'}}
function Assert-Ai09CollectionEnvironment {param($Scope,[bool]$SeedAttached)
    if($script:VmAttached -ne $SeedAttached){throw 'VM_ATTACHMENT_MISMATCH'}
    if($SeedAttached){[pscustomobject]@{Path='fixed-seed';ControllerLocation=2}}
}
function Get-Ai09CollectionVhd {param($Scope);[pscustomobject]@{Attached=($script:HostAttached -or $script:VmAttached)}}
function Assert-Ai09Administrator {$script:Calls.Add('Admin')}
function Remove-VMHardDiskDrive {[CmdletBinding()]param($VMHardDiskDrive)
    Assert-True ($VMHardDiskDrive.Path -ceq 'fixed-seed' -and $VMHardDiskDrive.ControllerLocation -eq 2) 'Wrong detach target'
    $script:Calls.Add('Detach');$script:VmAttached=$false
    if($script:Fault -eq 'unowned-host-mount'){$script:HostAttached=$true}
}
function Mount-VHD {[CmdletBinding()]param($Path,[switch]$ReadOnly,[switch]$PassThru)
    Assert-True ($ReadOnly -and -not $script:VmAttached -and -not $script:HostAttached) 'Unsafe mount'
    $script:Calls.Add('MountRO');$script:HostAttached=$true
    if($script:Fault -eq 'partial-mount'){throw 'PARTIAL_MOUNT'}
    [pscustomobject]@{Attached=$true}
}
function Get-Ai09ReadOnlySeedRoot {param($Scope,$Mounted);'fixture-root'}
function Read-Ai09NetworkEvidence {param($Root)
    $script:Calls.Add('Read')
    if($script:Fault -eq 'read-failed'){throw 'READ_FAILED'}
    [pscustomobject]@{Guest=[pscustomobject]@{ExitCode=51};Files=@{}}
}
function Assert-Ai09SeedDetachedFromVm {param($Scope);Assert-True (-not $script:VmAttached) 'Guest owns seed'}
function Dismount-VHD {[CmdletBinding()]param($Path)
    $script:Calls.Add('Dismount');if($script:Fault -eq 'dismount-noop'){return};$script:HostAttached=$false
}
function Save-Ai09NetworkCollection {param($Evidence)
    Assert-True (-not $script:HostAttached -and -not $script:VmAttached) 'Saved before cleanup'
    $script:Calls.Add('Save');$Evidence
}
Test-Case 'default verification never detaches or mounts' {
    Reset-NativeFixture
    $r=Invoke-Ai09NetworkCollection
    Assert-True ($r.Status -eq 'READ_ONLY_NETWORK_COLLECTION_PREFLIGHT' -and $script:Calls.Count -eq 0) 'Verify changed state'
}
Test-Case 'collection preserves guest failure and saves only after dismount' {
    Reset-NativeFixture
    $r=Invoke-Ai09NetworkCollection -Mode Collect -GuestUnmountConfirmed -ObservedGuestExitCode 51
    Assert-True ($r.Guest.ExitCode -eq 51) 'Guest failure hidden'
    Assert-True (($script:Calls -join ',') -ceq 'Admin,Detach,MountRO,Read,Dismount,Save') 'Wrong collection order'
}
Test-Case 'console and receipt exit mismatch is cleaned but cannot be accepted' {
    Reset-NativeFixture
    Expect-Failure {Invoke-Ai09NetworkCollection -Mode Collect -GuestUnmountConfirmed -ObservedGuestExitCode 0} 'OBSERVED_GUEST_EXIT_MISMATCH'
    Assert-True (-not $script:HostAttached -and -not $script:VmAttached -and $script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Save')) 'Mismatch was accepted or cleanup missed'
}
foreach($caseName in @('partial-mount','read-failed')){
    Test-Case ('collection cleans owned mount after '+$caseName) {
        Reset-NativeFixture;$script:Fault=$caseName
        $message=if($caseName -eq 'partial-mount'){'PARTIAL_MOUNT'}else{'READ_FAILED'}
        Expect-Failure {Invoke-Ai09NetworkCollection -Mode Collect -GuestUnmountConfirmed -ObservedGuestExitCode 51} $message
        Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Save') -and -not $script:HostAttached) 'Incorrect failure cleanup'
    }
}
Test-Case 'unconfirmed dismount cannot report collection success' {
    Reset-NativeFixture;$script:Fault='dismount-noop'
    Expect-Failure {Invoke-Ai09NetworkCollection -Mode Collect -GuestUnmountConfirmed -ObservedGuestExitCode 51} 'HOST_DISMOUNT_UNCONFIRMED'
    Assert-True (-not $script:Calls.Contains('Save')) 'Saved unconfirmed collection'
}
Test-Case 'unexpected existing host attachment is not dismounted by collector' {
    Reset-NativeFixture;$script:Fault='unowned-host-mount'
    Expect-Failure {Invoke-Ai09NetworkCollection -Mode Collect -GuestUnmountConfirmed -ObservedGuestExitCode 51} 'SEED_IN_USE'
    Assert-True (-not $script:Calls.Contains('Dismount') -and -not $script:Calls.Contains('Save')) 'Touched unowned mount'
}
"PASS network collection fixtures: $script:Passed"
