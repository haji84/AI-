param([string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
$path=Join-Path $RepositoryRoot 'scripts/ai09-stage-network-recovery.ps1'
if(-not(Test-Path -LiteralPath $path)){throw 'NETWORK_STAGING_SCRIPT_MISSING'}
. (Join-Path $RepositoryRoot 'scripts/ai09-prepare-bootstrap-disk.ps1')
. (Join-Path $RepositoryRoot 'scripts/ai09-collect-bootstrap-result.ps1')
. (Join-Path $RepositoryRoot 'scripts/ai09-repair-seed-hostname.ps1')
. $path
$script:RealSeedGuard=${function:Assert-Ai09NetworkSeed}
$script:RealProofGuard=${function:Assert-Ai09NetworkCollectionProof}
$script:RealMount=${function:Invoke-Ai09NetworkMount}
$script:RealHash=${function:Get-Ai09RepairHash}
$script:Passed=0
function Assert-True($Condition,$Message){if(-not $Condition){throw $Message}}
function Expect-Failure([scriptblock]$Body,$Message){$caught='';$threw=$false;try{& $Body | Out-Null}catch{$threw=$true;$caught=$_.Exception.Message};Assert-True ($threw -and $caught -like "*$Message*") "Expected $Message; got $caught"}
function Test-Case($Name,[scriptblock]$Body){$script:Calls=[Collections.Generic.List[string]]::new();$script:Fault='';$script:Attached=$false;& $Body;$script:Passed++;"PASS $Name"}
function Assert-Ai09CollectionEnvironment {param($Scope,[bool]$SeedAttached)
    $script:Calls.Add('Environment')
    if($script:Fault -eq 'environment'){throw 'ENVIRONMENT_CHANGED'}
    if($SeedAttached -ne $script:VmAttached){throw 'WRONG_ATTACHMENT'}
}
function Get-Ai09CollectionVhd {param($Scope);[pscustomobject]@{Attached=$script:Attached}}
function Assert-Ai09Administrator {$script:Calls.Add('Admin')}
function Assert-Ai09NetworkCollectionProof {$script:Calls.Add('Proof');if($script:Fault -eq 'proof'){throw 'INVALID_COLLECTION_PROOF'}}
function Mount-VHD {[CmdletBinding()]param($Path,[switch]$ReadOnly,[switch]$PassThru)
    $script:Calls.Add($(if($ReadOnly){'MountRO'}else{'MountRW'}));$script:Attached=$true
    if($script:Fault -eq 'partial-mount'){throw 'PARTIAL_MOUNT'}
    [pscustomobject]@{Attached=$true}
}
function Get-Ai09ReadOnlySeedRoot {param($Scope,$Mounted);'fixture-root'}
function Get-Ai09WritableRepairRoot {param($Scope,$Mounted);'fixture-root'}
function Assert-Ai09NetworkSeed {param($Scope,$Root,[switch]$AllowPayload)
    $script:Calls.Add('SeedProof');if($script:Fault -eq 'seed'){throw 'SEED_EVIDENCE_CHANGED'}
}
function Assert-Ai09SeedDetachedFromVm {param($Scope);if($script:VmAttached){throw 'STILL_VM_ATTACHED'}}
function Dismount-VHD {[CmdletBinding()]param($Path)
    $script:Calls.Add('Dismount');if($script:Fault -eq 'dismount'){throw 'DISMOUNT_FAILED'};$script:Attached=$false
}
Test-Case 'Verify performs no mount, file write or attachment' {
    $script:VmAttached=$false
    $r=Invoke-Ai09NetworkStaging
    Assert-True ($r.Status -eq 'READ_ONLY_NETWORK_STAGING_PREFLIGHT') 'Wrong status'
    Assert-True (-not $script:Calls.Contains('MountRO') -and -not $script:Calls.Contains('MountRW')) 'Verify mounted media'
}
Test-Case 'changed environment refuses before mount' {
    $script:VmAttached=$false;$script:Fault='environment'
    Expect-Failure {Invoke-Ai09NetworkStaging} 'ENVIRONMENT_CHANGED'
    Assert-True (-not $script:Calls.Contains('MountRO')) 'Mounted after failure'
}
Test-Case 'partial host mount is cleaned and never runs action' {
    $script:VmAttached=$false;$script:Fault='partial-mount'
    Expect-Failure {Invoke-Ai09NetworkMount (Get-Ai09CollectionScope) -Action {throw 'ACTION_MUST_NOT_RUN'}} 'PARTIAL_MOUNT'
    Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Attached) 'Partial mount not cleaned'
}
Test-Case 'changed seed evidence prevents action and cleans host mount' {
    $script:VmAttached=$false;$script:Fault='seed'
    Expect-Failure {Invoke-Ai09NetworkMount (Get-Ai09CollectionScope) -Action {throw 'ACTION_MUST_NOT_RUN'}} 'SEED_EVIDENCE_CHANGED'
    Assert-True ($script:Calls.Contains('Dismount') -and -not $script:Attached) 'Failed proof left host mount'
}
Test-Case 'action failure preserves failure after cleanup' {
    $script:VmAttached=$false
    Expect-Failure {Invoke-Ai09NetworkMount (Get-Ai09CollectionScope) -Writable -Action {throw 'WRITE_FAILED'}} 'WRITE_FAILED'
    Assert-True ($script:Calls.Contains('MountRW') -and $script:Calls.Contains('Dismount')) 'Write cleanup missing'
}
Test-Case 'unconfirmed cleanup remains failure' {
    $script:VmAttached=$false;$script:Fault='dismount'
    Expect-Failure {Invoke-Ai09NetworkMount (Get-Ai09CollectionScope) -Action {}} 'CLEANUP_FAILED'
}
Test-Case 'pre-existing host mount is refused without dismounting it' {
    $script:VmAttached=$false;$script:Attached=$true
    Expect-Failure {Invoke-Ai09NetworkMount (Get-Ai09CollectionScope) -Action {}} 'SEED_IN_USE'
    Assert-True (-not $script:Calls.Contains('Dismount')) 'Touched unowned host mount'
}
Test-Case 'new-file writer never overwrites existing bytes' {
    $dir=Join-Path ([IO.Path]::GetTempPath()) ('ai09-stage-fixture-'+[guid]::NewGuid().ToString('N'))
    $null=New-Item -ItemType Directory -Path $dir
    $file=Join-Path $dir 'recover.sh'
    try {
        [IO.File]::WriteAllText($file,'keep-original')
        Expect-Failure {Write-Ai09RepairNewFile -Path $file -Bytes ([Text.Encoding]::UTF8.GetBytes('replace'))} ''
        Assert-True ([IO.File]::ReadAllText($file) -ceq 'keep-original') 'Original overwritten'
    } finally {Remove-Item -LiteralPath $file;Remove-Item -LiteralPath $dir}
}
Test-Case 'invalid collection proof refuses before mounting' {
    $script:VmAttached=$false;$script:Fault='proof'
    Expect-Failure {Invoke-Ai09NetworkStaging -Mode Stage} 'INVALID_COLLECTION_PROOF'
    Assert-True (-not $script:Calls.Contains('MountRO') -and -not $script:Calls.Contains('MountRW')) 'Mounted without proof'
}

Test-Case 'real payload reader accepts a reviewed worktree-style source and rejects changed bytes' {
    $dir=Join-Path ([IO.Path]::GetTempPath()) ('ai09-source-fixture-'+[guid]::NewGuid().ToString('N'))
    $null=New-Item -ItemType Directory -Path $dir
    $fixture=Join-Path $dir 'ai09-stage-network-recovery.ps1'
    $payload=Join-Path $dir 'ai09-network-recovery.sh'
    try {
        [IO.File]::WriteAllText($fixture,[IO.File]::ReadAllText($path),[Text.UTF8Encoding]::new($false))
        $canonical=[Text.Encoding]::UTF8.GetBytes("#!/bin/sh`nexit 0`n")
        $script:FixturePayloadHash=Get-Ai09RepairHash $canonical
        [IO.File]::WriteAllText($payload,"#!/bin/sh`r`nexit 0`r`n",[Text.UTF8Encoding]::new($false))
        & {
            . $fixture
            function Get-Ai09NetworkPayloadHash {return $script:FixturePayloadHash}
            $actual=Get-Ai09NetworkPayload
            Assert-True ((Get-Ai09RepairHash $actual) -ceq $script:FixturePayloadHash) 'Payload canonicalization failed'
            [IO.File]::WriteAllText($payload,'tampered')
            Expect-Failure {Get-Ai09NetworkPayload} 'RECOVERY_SOURCE_HASH_MISMATCH'
            [IO.File]::WriteAllBytes($payload,[byte[]]@(255,255))
            Expect-Failure {Get-Ai09NetworkPayload} ''
            Expect-Failure {Assert-Ai09NetworkSourcePath 'relative.sh'} 'ABSOLUTE_SOURCE_PATH_REQUIRED'
        }
    } finally {Remove-Item -LiteralPath $payload;Remove-Item -LiteralPath $fixture;Remove-Item -LiteralPath $dir}
}
Test-Case 'source ancestor reparse point is rejected before file read' {
    & {
        function Get-Item {[CmdletBinding()]param($LiteralPath,[switch]$Force);[pscustomobject]@{Attributes=[IO.FileAttributes]::ReparsePoint}}
        Expect-Failure {Assert-Ai09NetworkSourcePath ([IO.Path]::GetFullPath($path))} 'SOURCE_REPARSE_POINT_REFUSED'
    }
}

Test-Case 'real seed guard rejects an altered original receipt' {
    & {
        function Read-Ai09BoundedSeedFile {param($Root,$Name);return ,([Text.Encoding]::UTF8.GetBytes('changed'))}
        Expect-Failure {& $script:RealSeedGuard (Get-Ai09CollectionScope) 'fixture-root'} 'SEED_EVIDENCE_CHANGED'
    }
}
Test-Case 'real seed guard rejects every prior recovery artifact and mismatched staged payload' {
    & {
        # Keep real guard control flow; substitute only immutable original file digests.
        function Read-Ai09BoundedSeedFile {param($Root,$Name);return ,([Text.Encoding]::UTF8.GetBytes($Name))}
        function Read-Ai09RepairScript {param($Root);return ,([Text.Encoding]::UTF8.GetBytes('bridge.sh'))}
        function Get-Ai09RepairHash {param([byte[]]$Bytes)
            $digests=@{
                'seed.id'='AECB5D8BA490D9C58DC489A2A4D9527766A2D6A3AD4FE1A1C552EB3882ABB34E'
                'ai09-stdout.txt'='CAD77C296F367DE9293ACA445C3EE558A322C3F9F9229E3012CFAEF4B938D7C7'
                'ai09-stderr.txt'='ED82BCCDAE44FAA204C10944ED21E6B7ED0CA252830B6AEB297FEEE68123D596'
                'ai09-result.txt'='D8F02BBB50C19069B0ED691478D35E6C41E7F183E02F5B74CC45471DB124C1F5'
                'bridge.sh'='0306204EB6D8DFDD8C659938A6C92373A8CD89B659017F269FBF6C34DEE85A33'
            };return $digests[[Text.Encoding]::UTF8.GetString($Bytes)]
        }
        function Test-Path {param($LiteralPath);return ([IO.Path]::GetFileName($LiteralPath) -ceq $script:ExistingArtifact)}
        foreach($artifact in @('recovery.id','recovery-stdout.txt','recovery-stderr.txt','recovery-result.txt','recovery-original.network')){
            $script:ExistingArtifact=$artifact
            Expect-Failure {& $script:RealSeedGuard (Get-Ai09CollectionScope) 'fixture-root'} 'RECOVERY_ALREADY_STARTED'
        }
        $script:ExistingArtifact='recover.sh'
        Expect-Failure {& $script:RealSeedGuard (Get-Ai09CollectionScope) 'fixture-root'} 'RECOVERY_PAYLOAD_ALREADY_EXISTS'
        $script:ExistingArtifact=''
        function Assert-Ai09RepairFile {param($Path)}
        function Get-FileHash {param($LiteralPath,$Algorithm);[pscustomobject]@{Hash='changed'}}
        Expect-Failure {& $script:RealSeedGuard (Get-Ai09CollectionScope) 'fixture-root' -AllowPayload} 'STAGED_PAYLOAD_HASH_MISMATCH'
    }
}

# Workflow fixtures replace all native and persistent operations; no real VM/disk/report is touched.
function Get-Ai09NetworkPayload {return ,([Text.Encoding]::UTF8.GetBytes('fixture'))}
function Assert-Ai09Path {param($Path)}
function Test-Path {param($LiteralPath);return $false}
function New-Item {[CmdletBinding()]param($ItemType,$Path);$script:Calls.Add('EvidenceDirectory')}
function Invoke-Ai09NetworkMount {param($Scope,[switch]$Writable,[scriptblock]$Action)
    $script:Calls.Add($(if($Writable){'StageRW'}else{'InspectRO'}))
    if($Writable -and $script:Fault -eq 'write-failed'){throw 'WRITE_FAILED'}
    if($Writable -and $script:Fault -eq 'host-remounted'){$script:Attached=$true}
    if($Writable -and $script:Fault -eq 'late-runner'){$script:Fault='environment'}
}
function Add-VMHardDiskDrive {[CmdletBinding()]param($VMName,$ControllerType,$ControllerNumber,$ControllerLocation,$Path)
    Assert-True ($VMName -ceq 'GORIQ-AI09-Ubuntu' -and $ControllerType -ceq 'SCSI' -and $ControllerNumber -eq 0 -and $ControllerLocation -eq 2 -and $Path -ceq 'C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx') 'Wrong attachment target'
    Assert-True (-not $script:Attached -and -not $script:VmAttached) 'Unsafe attachment'
    $script:Calls.Add('Attach')
    if($script:Fault -eq 'attach-failed'){throw 'ATTACH_FAILED'}
    $script:VmAttached=$true
}
function Save-Ai09NetworkStageReceipt {param($Directory,$Phase,[bool]$Success,$Failure)
    $script:Calls.Add($(if($Success){'SuccessReceipt'}else{'FailureReceipt'}))
    [pscustomobject]@{Success=$Success;Phase=$Phase;Failure=$Failure}
}
Test-Case 'successful staging inspects RO, stages RW, then attaches exact slot' {
    $script:VmAttached=$false
    $r=Invoke-Ai09NetworkStaging -Mode Stage
    Assert-True ($r.Success -and $r.Phase -eq 'VERIFIED_ATTACHMENT') 'Success missing'
    Assert-True ($script:Calls.IndexOf('InspectRO') -lt $script:Calls.IndexOf('StageRW') -and $script:Calls.IndexOf('StageRW') -lt $script:Calls.IndexOf('Attach')) 'Wrong operation order'
}
foreach($failureCase in @(
    @{Fault='write-failed';Error='WRITE_FAILED'},
    @{Fault='host-remounted';Error='HOST_DISMOUNT_UNCONFIRMED'},
    @{Fault='late-runner';Error='ENVIRONMENT_CHANGED'}
)){
    Test-Case ('stage failure preserves evidence and refuses attachment: '+$failureCase.Fault) {
        $script:VmAttached=$false;$script:Fault=$failureCase.Fault
        Expect-Failure {Invoke-Ai09NetworkStaging -Mode Stage} $failureCase.Error
        Assert-True (-not $script:Calls.Contains('Attach') -and $script:Calls.Contains('FailureReceipt')) 'Unsafe failure handling'
    }
}
Test-Case 'attachment failure cannot report guest or staging success' {
    $script:VmAttached=$false;$script:Fault='attach-failed'
    Expect-Failure {Invoke-Ai09NetworkStaging -Mode Stage} 'ATTACH_FAILED'
    Assert-True ($script:Calls.Contains('FailureReceipt') -and -not $script:Calls.Contains('SuccessReceipt')) 'False success'
}
Test-Case 'real staging action writes only the new payload and verifies all preserved files' {
    $dir=Join-Path ([IO.Path]::GetTempPath()) ('ai09-write-fixture-'+[guid]::NewGuid().ToString('N'))
    $null=[IO.Directory]::CreateDirectory($dir)
    $oldDigests=@{
        'seed.id'='AECB5D8BA490D9C58DC489A2A4D9527766A2D6A3AD4FE1A1C552EB3882ABB34E'
        'ai09-stdout.txt'='CAD77C296F367DE9293ACA445C3EE558A322C3F9F9229E3012CFAEF4B938D7C7'
        'ai09-stderr.txt'='ED82BCCDAE44FAA204C10944ED21E6B7ED0CA252830B6AEB297FEEE68123D596'
        'ai09-result.txt'='D8F02BBB50C19069B0ED691478D35E6C41E7F183E02F5B74CC45471DB124C1F5'
        'bridge.sh'='0306204EB6D8DFDD8C659938A6C92373A8CD89B659017F269FBF6C34DEE85A33'
    }
    foreach($name in $oldDigests.Keys){[IO.File]::WriteAllText((Join-Path $dir $name),$name,[Text.UTF8Encoding]::new($false))}
    try {
        & {
            function Test-Path {param($LiteralPath);return [IO.File]::Exists($LiteralPath)}
            function Get-Ai09ReadOnlySeedRoot {param($Scope,$Mounted);return $dir}
            function Get-Ai09WritableRepairRoot {param($Scope,$Mounted);return $dir}
            function Get-Ai09RepairHash {param([byte[]]$Bytes)
                # Real byte reads; only immutable baseline digests use fixture translations.
                $text=[Text.Encoding]::UTF8.GetString($Bytes)
                if($oldDigests.ContainsKey($text)){return $oldDigests[$text]}
                return & $script:RealHash $Bytes
            }
            function Get-Ai09NetworkPayloadHash {return & $script:RealHash ([Text.Encoding]::UTF8.GetBytes('fixture'))}
            function Assert-Ai09NetworkSeed {param($Scope,$Root,[switch]$AllowPayload);& $script:RealSeedGuard @PSBoundParameters}
            function Invoke-Ai09NetworkMount {param($Scope,[switch]$Writable,[scriptblock]$Action);& $script:RealMount @PSBoundParameters}
            $script:VmAttached=$false
            $result=Invoke-Ai09NetworkStaging -Mode Stage
            Assert-True ($result.Success -and $script:VmAttached -and -not $script:Attached) 'Staging or cleanup failed'
            Assert-True ([IO.File]::ReadAllText((Join-Path $dir 'recover.sh')) -ceq 'fixture') 'Actual action did not write reviewed bytes'
            foreach($name in $oldDigests.Keys){Assert-True ([IO.File]::ReadAllText((Join-Path $dir $name)) -ceq $name) 'Original bytes changed'}
            Assert-True ([IO.Directory]::GetFiles($dir).Count -eq 6) 'Unexpected seed file created'
        }
    } finally {
        foreach($name in @('seed.id','ai09-stdout.txt','ai09-stderr.txt','ai09-result.txt','bridge.sh','recover.sh')){
            $file=Join-Path $dir $name
            if([IO.File]::Exists($file)){Remove-Item -LiteralPath $file}
        }
        Remove-Item -LiteralPath $dir
    }
}
"PASS network staging fixtures: $script:Passed"
