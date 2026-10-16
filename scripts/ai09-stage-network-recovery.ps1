# Issue #1798: add one fixed recovery script to the already collected, detached seed.
[CmdletBinding()]
param([ValidateSet('Verify','Stage')][string]$Mode='Verify')
$ErrorActionPreference='Stop'

function Get-Ai09NetworkPayloadHash {
    # Filled with the reviewed LF artifact before any native staging is permitted.
    return '213E06BB5459C35E4535EB8C81C9DE5014D7BF85E30895F4C19F4864DEFE3CED'
}

function Assert-Ai09NetworkSourcePath {
    param([string]$Path)
    if(-not [IO.Path]::IsPathRooted($Path)){throw 'ABSOLUTE_SOURCE_PATH_REQUIRED'}
    $cursor=[IO.Path]::GetFullPath($Path)
    while($cursor){
        $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'SOURCE_REPARSE_POINT_REFUSED'}
        $parent=[IO.Path]::GetDirectoryName($cursor)
        if($parent -eq $cursor){break}
        $cursor=$parent
    }
}

function Get-Ai09NetworkPayload {
    $path=Join-Path $PSScriptRoot 'ai09-network-recovery.sh'
    Assert-Ai09NetworkSourcePath $path
    Assert-Ai09RepairFile $path
    $stream=[IO.File]::Open($path,'Open','Read','Read')
    try {
        $bytes=Read-Ai09RepairStream $stream
        if($bytes.Length -le 0 -or $bytes.Length -gt 32768){throw 'INVALID_RECOVERY_SOURCE_SIZE'}
        $utf8=[Text.UTF8Encoding]::new($false,$true)
        $text=$utf8.GetString($bytes).Replace("`r`n","`n")
        if($text.Contains("`r") -or $text.Contains([string][char]0) -or $text.StartsWith([string][char]0xFEFF,[StringComparison]::Ordinal)){throw 'INVALID_RECOVERY_SOURCE_ENCODING'}
        $canonical=$utf8.GetBytes($text)
        if((Get-Ai09RepairHash $canonical) -cne (Get-Ai09NetworkPayloadHash)){throw 'RECOVERY_SOURCE_HASH_MISMATCH'}
        return ,$canonical
    } finally {$stream.Dispose()}
}

function Assert-Ai09NetworkCollectionProof {
    $path='C:\GORIQ-AI09\Reports\bootstrap-02ea2f0d324543a1ab2973e73c97421d-86b4dff2e9ba4f6c8f2fe2f04b527739\collection.json'
    Assert-Ai09Path $path
    Assert-Ai09RepairFile $path
    $stream=[IO.File]::Open($path,'Open','Read','Read')
    try {
        $bytes=Read-Ai09RepairStream $stream
        if($bytes.Length -gt 16384 -or (Get-Ai09RepairHash $bytes) -cne 'CE800DD118AD3CA0D7701126FCD7E55869B29E4F139E7384CE3ECFA86A5A7C43'){throw 'INVALID_COLLECTION_PROOF'}
        $proof=[Text.UTF8Encoding]::new($false,$true).GetString($bytes) | ConvertFrom-Json
        if($proof.RunId -cne '02ea2f0d324543a1ab2973e73c97421d' -or $proof.CollectorExitCode -ne 0 -or
            $proof.GuestExitCode -ne 18 -or $proof.GuestStatus -cne 'FAILED' -or
            $proof.HostDismounted -ne $true -or $proof.SeedReattached -ne $false){throw 'INVALID_COLLECTION_PROOF'}
    } finally {$stream.Dispose()}
}

function Assert-Ai09NetworkSeed {
    param($Scope,[string]$Root,[switch]$AllowPayload)
    $expected=@{
        'seed.id'='AECB5D8BA490D9C58DC489A2A4D9527766A2D6A3AD4FE1A1C552EB3882ABB34E'
        'ai09-stdout.txt'='CAD77C296F367DE9293ACA445C3EE558A322C3F9F9229E3012CFAEF4B938D7C7'
        'ai09-stderr.txt'='ED82BCCDAE44FAA204C10944ED21E6B7ED0CA252830B6AEB297FEEE68123D596'
        'ai09-result.txt'='D8F02BBB50C19069B0ED691478D35E6C41E7F183E02F5B74CC45471DB124C1F5'
    }
    foreach($name in $expected.Keys){
        $bytes=Read-Ai09BoundedSeedFile -Root $Root -Name $name
        if((Get-Ai09RepairHash $bytes) -cne $expected[$name]){throw ('SEED_EVIDENCE_CHANGED_'+$name)}
    }
    if((Get-Ai09RepairHash (Read-Ai09RepairScript $Root)) -cne '0306204EB6D8DFDD8C659938A6C92373A8CD89B659017F269FBF6C34DEE85A33'){throw 'SEED_BRIDGE_CHANGED'}
    foreach($name in @('recovery.id','recovery-stdout.txt','recovery-stderr.txt','recovery-result.txt','recovery-original.network')){
        if(Test-Path -LiteralPath (Join-Path $Root $name)){throw 'RECOVERY_ALREADY_STARTED'}
    }
    $payloadPath=Join-Path $Root 'recover.sh'
    if($AllowPayload){
        Assert-Ai09RepairFile $payloadPath
        if((Get-FileHash -LiteralPath $payloadPath -Algorithm SHA256).Hash -cne (Get-Ai09NetworkPayloadHash)){throw 'STAGED_PAYLOAD_HASH_MISMATCH'}
    } elseif(Test-Path -LiteralPath $payloadPath){throw 'RECOVERY_PAYLOAD_ALREADY_EXISTS'}
}

function Invoke-Ai09NetworkMount {
    param($Scope,[switch]$Writable,[scriptblock]$Action)
    $null=Assert-Ai09CollectionEnvironment -Scope $Scope -SeedAttached $false
    if((Get-Ai09CollectionVhd $Scope).Attached){throw 'SEED_IN_USE_DO_NOT_MOUNT'}
    $attempted=$false;$failure=$null
    try {
        $attempted=$true
        $mounted=Mount-VHD -Path $Scope.SeedPath -ReadOnly:(-not $Writable) -PassThru -ErrorAction Stop
        $root=if($Writable){Get-Ai09WritableRepairRoot -Scope $Scope -Mounted $mounted}else{Get-Ai09ReadOnlySeedRoot -Scope $Scope -Mounted $mounted}
        Assert-Ai09NetworkSeed -Scope $Scope -Root $root
        & $Action $root $mounted
        Assert-Ai09NetworkSeed -Scope $Scope -Root $root -AllowPayload:$Writable
    } catch {$failure=$_;throw}
    finally {
        if($attempted){
            try {
                Assert-Ai09SeedDetachedFromVm $Scope
                if((Get-Ai09CollectionVhd $Scope).Attached){Dismount-VHD -Path $Scope.SeedPath -ErrorAction Stop}
                if((Get-Ai09CollectionVhd $Scope).Attached){throw 'HOST_DISMOUNT_UNCONFIRMED'}
            } catch {throw "NETWORK_STAGING_CLEANUP_FAILED: $($_.Exception.Message); ORIGINAL_FAILURE: $failure"}
        }
    }
}

function Save-Ai09NetworkStageReceipt {
    param([string]$Directory,[string]$Phase,[bool]$Success,[string]$Failure)
    $record=[pscustomobject]@{
        Status=$(if($Success){'RECOVERY_SCRIPT_STAGED_GUEST_NOT_EXECUTED'}else{'STAGING_FAILED_INSPECTION_REQUIRED'})
        Phase=$Phase;Success=$Success;Failure=$Failure;HostRecordedAt=[DateTimeOffset]::UtcNow.ToString('o')
        SeedRunId='02ea2f0d324543a1ab2973e73c97421d';RecoveryRunId='network-recovery-20261016-v1'
        GuestScriptSha256=Get-Ai09NetworkPayloadHash;GuestExecuted=$false;SshVerified=$false
    }
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Depth 4))
    Write-Ai09RepairNewFile -Path (Join-Path $Directory 'staging.json') -Bytes $bytes
    return $record
}

function Invoke-Ai09NetworkStaging {
    param([ValidateSet('Verify','Stage')][string]$Mode='Verify')
    $scope=Get-Ai09CollectionScope
    $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
    if((Get-Ai09CollectionVhd $scope).Attached){throw 'SEED_IN_USE_DO_NOT_MOUNT'}
    Assert-Ai09NetworkCollectionProof
    if($Mode -eq 'Verify'){return [pscustomobject]@{Status='READ_ONLY_NETWORK_STAGING_PREFLIGHT';GuestExecuted=$false;SeedMounted=$false}}
    Assert-Ai09Administrator
    $payload=Get-Ai09NetworkPayload
    $directory='C:\GORIQ-AI09\Reports\network-stage-'+[guid]::NewGuid().ToString('N')
    Assert-Ai09Path $directory
    if(Test-Path -LiteralPath $directory){throw 'EVIDENCE_DIRECTORY_EXISTS'}
    $null=New-Item -ItemType Directory -Path $directory -ErrorAction Stop
    Assert-Ai09Path $directory
    $phase='READ_ONLY_INSPECTION'
    try {
        Invoke-Ai09NetworkMount -Scope $scope -Action {param($root,$mounted)}
        $phase='CREATE_NEW_RECOVERY_SCRIPT'
        Invoke-Ai09NetworkMount -Scope $scope -Writable -Action {
            param($root,$mounted)
            $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
            if((Get-Ai09WritableRepairRoot -Scope $scope -Mounted $mounted) -cne $root){throw 'SEED_ROOT_CHANGED'}
            Assert-Ai09NetworkSeed -Scope $scope -Root $root
            Write-Ai09RepairNewFile -Path (Join-Path $root 'recover.sh') -Bytes $payload
        }
        $phase='ATTACH_VERIFIED_SEED'
        $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
        if((Get-Ai09CollectionVhd $scope).Attached){throw 'HOST_DISMOUNT_UNCONFIRMED'}
        Add-VMHardDiskDrive -VMName $scope.VmName -ControllerType SCSI -ControllerNumber 0 -ControllerLocation 2 -Path $scope.SeedPath -ErrorAction Stop
        $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true
        $null=Get-Ai09CollectionVhd $scope
        return Save-Ai09NetworkStageReceipt -Directory $directory -Phase 'VERIFIED_ATTACHMENT' -Success $true
    } catch {
        $failure=$_
        try {$null=Save-Ai09NetworkStageReceipt -Directory $directory -Phase $phase -Success $false -Failure $failure.Exception.Message}
        catch {Write-Warning ('STAGING_RECEIPT_FAILED: '+$_.Exception.Message)}
        throw $failure
    }
}

if($MyInvocation.InvocationName -ne '.'){
    $locks=[Collections.Generic.List[IO.FileStream]]::new()
    try {
        if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess){throw 'NATIVE_WINDOWS_POWERSHELL_51_REQUIRED'}
        $requestedMode=$Mode
        $helpers=@(
            @{Name='ai09-prepare-bootstrap-disk.ps1';Hash='E6E7B482E112609749C6982F051B1D35842EEE51FCDC563F4E9408B1D3C15B6B'},
            @{Name='ai09-collect-bootstrap-result.ps1';Hash='6A0E4D4264825A8D38C749F74BF9706FCCD39B59BDF8CF22CB8BFD3B6975F391'},
            @{Name='ai09-repair-seed-hostname.ps1';Hash='B46A1DD340E62705603448637763219224A6E5E3DEBF519EBB638406025EE7EE'}
        )
        foreach($helper in $helpers){
            $path=Join-Path $PSScriptRoot $helper.Name
            $handle=[IO.File]::Open($path,'Open','Read','Read');$locks.Add($handle)
            $hasher=[Security.Cryptography.SHA256]::Create()
            try {$hash=([BitConverter]::ToString($hasher.ComputeHash($handle))).Replace('-','')}finally{$hasher.Dispose()}
            if($hash -cne $helper.Hash){throw 'NETWORK_STAGING_HELPER_HASH_MISMATCH'}
        }
        foreach($helper in $helpers){. (Join-Path $PSScriptRoot $helper.Name)}
        Invoke-Ai09NetworkStaging -Mode $requestedMode | ConvertTo-Json -Depth 5
    } catch {Write-Error $_;exit 1}
    finally {foreach($handle in $locks){$handle.Dispose()}}
}
