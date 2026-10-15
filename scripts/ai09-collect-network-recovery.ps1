# Issue #1798: collect the fixed recovery run only after observed guest unmount.
[CmdletBinding()]
param([ValidateSet('Verify','Collect')][string]$Mode='Verify',[switch]$GuestUnmountConfirmed,[ValidateRange(0,255)][Nullable[int]]$ObservedGuestExitCode)
$ErrorActionPreference='Stop'

function ConvertFrom-Ai09NetworkResult {
    param([byte[]]$Bytes)
    try {
        if($Bytes.Length -eq 0 -or $Bytes.Length -gt 8192){throw 'size'}
        $text=[Text.UTF8Encoding]::new($false,$true).GetString($Bytes)
        $pattern='\ARUN_ID=network-recovery-20261016-v1\nSEED_RUN_ID=02ea2f0d324543a1ab2973e73c97421d\nTIMESTAMP=(?<time>[0-9T:Z-]{20})\nSTATUS=(?<status>DHCP_IPV4_VERIFIED|FAILED)\nEXIT_CODE=(?<code>[0-9]{1,3})\nPHASE=(?<phase>OPEN_EVIDENCE|PRESERVE_ORIGINAL|CREATE_CONFIG|RELOAD|RECONFIGURE|WAIT_DHCP|VERIFY_SELECTED_NETWORK|VERIFIED)\nCONFIG_CREATED=(?<created>[01])\nIPV4=(?<ip>[^\r\n]*)\nORIGINAL_SHA256=ad37eaf039455b7f058d4da73c3fd008752787db45e952d343551d6f8b437fc9\n\z'
        if($text -cnotmatch $pattern){throw 'format'}
        $code=[int]$Matches.code;$status=$Matches.status;$phase=$Matches.phase;$created=$Matches.created;$address=$Matches.ip;$time=$Matches.time
        $null=[DateTimeOffset]::ParseExact($time,"yyyy-MM-dd'T'HH:mm:ss'Z'",[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
        if($code -gt 255 -or (($status -ceq 'DHCP_IPV4_VERIFIED') -ne ($code -eq 0))){throw 'status'}
        if($address){
            if($address -cnotmatch '\A172\.29\.(?<third>8[0-9]|9[0-5])\.(?<fourth>0|[1-9][0-9]{0,2})/20\z'){throw 'address'}
            if([int]$Matches.fourth -gt 255 -or $address -in @('172.29.80.0/20','172.29.80.1/20','172.29.95.255/20')){throw 'address'}
        }
        if($code -eq 0 -and ($phase -cne 'VERIFIED' -or $created -cne '1' -or -not $address)){throw 'success'}
        return [pscustomobject]@{ExitCode=$code;Status=$status;Phase=$phase;ConfigCreated=($created -ceq '1');Address=$address;UntrustedGuestTimestamp=$time}
    } catch {throw ('INVALID_RECOVERY_RESULT: '+$_.Exception.Message)}
}

function Read-Ai09NetworkEvidenceFile {
    param([string]$Root,[string]$Name)
    $limits=@{'recover.sh'=32768;'recovery.id'=128;'recovery-stdout.txt'=1048576;'recovery-stderr.txt'=1048576;'recovery-result.txt'=8192;'recovery-original.network'=95}
    if(-not $limits.ContainsKey($Name)){throw 'UNEXPECTED_RECOVERY_FILE'}
    $path=Join-Path $Root $Name
    Assert-Ai09RepairFile $path
    $stream=[IO.File]::Open($path,'Open','Read','Read')
    try {
        if($stream.Length -gt $limits[$Name]){throw 'RECOVERY_FILE_TOO_LARGE'}
        return ,(Read-Ai09RepairStream $stream)
    } finally {$stream.Dispose()}
}

function Read-Ai09NetworkEvidence {
    param([string]$Root)
    $old=@{
        'seed.id'='AECB5D8BA490D9C58DC489A2A4D9527766A2D6A3AD4FE1A1C552EB3882ABB34E'
        'ai09-stdout.txt'='CAD77C296F367DE9293ACA445C3EE558A322C3F9F9229E3012CFAEF4B938D7C7'
        'ai09-stderr.txt'='ED82BCCDAE44FAA204C10944ED21E6B7ED0CA252830B6AEB297FEEE68123D596'
        'ai09-result.txt'='D8F02BBB50C19069B0ED691478D35E6C41E7F183E02F5B74CC45471DB124C1F5'
    }
    foreach($name in $old.Keys){if((Get-Ai09RepairHash (Read-Ai09BoundedSeedFile -Root $Root -Name $name)) -cne $old[$name]){throw 'ORIGINAL_SEED_EVIDENCE_CHANGED'}}
    if((Get-Ai09RepairHash (Read-Ai09RepairScript $Root)) -cne '0306204EB6D8DFDD8C659938A6C92373A8CD89B659017F269FBF6C34DEE85A33'){throw 'ORIGINAL_BRIDGE_CHANGED'}
    $files=@{}
    foreach($name in @('recover.sh','recovery.id','recovery-stdout.txt','recovery-stderr.txt','recovery-result.txt')){$files[$name]=Read-Ai09NetworkEvidenceFile -Root $Root -Name $name}
    if((Get-Ai09RepairHash $files['recover.sh']) -cne (Get-Ai09NetworkPayloadHash)){throw 'RECOVERY_SCRIPT_CHANGED'}
    if([Text.UTF8Encoding]::new($false,$true).GetString($files['recovery.id']) -cne "network-recovery-20261016-v1`n"){throw 'RECOVERY_RUN_MISMATCH'}
    $guest=ConvertFrom-Ai09NetworkResult $files['recovery-result.txt']
    if(Test-Path -LiteralPath (Join-Path $Root 'recovery-original.network')){
        $files['recovery-original.network']=Read-Ai09NetworkEvidenceFile -Root $Root -Name 'recovery-original.network'
        if((Get-Ai09RepairHash $files['recovery-original.network']) -cne 'AD37EAF039455B7F058D4DA73C3FD008752787DB45E952D343551D6F8B437FC9'){throw 'ORIGINAL_NETWORK_BACKUP_MISMATCH'}
    } elseif($guest.ConfigCreated -or $guest.ExitCode -eq 0){throw 'ORIGINAL_NETWORK_BACKUP_MISSING'}
    return [pscustomobject]@{Files=$files;Guest=$guest}
}

function Save-Ai09NetworkCollection {
    param($Evidence)
    $directory='C:\GORIQ-AI09\Reports\network-recovery-'+[guid]::NewGuid().ToString('N')
    Assert-Ai09Path $directory
    if(Test-Path -LiteralPath $directory){throw 'COLLECTION_DIRECTORY_EXISTS'}
    $null=New-Item -ItemType Directory -Path $directory -ErrorAction Stop
    Assert-Ai09Path $directory
    $hashes=[ordered]@{}
    foreach($name in $Evidence.Files.Keys){
        $bytes=[byte[]]$Evidence.Files[$name]
        $path=Join-Path $directory $name
        Write-Ai09RepairNewFile -Path $path -Bytes $bytes
        $hashes[$name]=[ordered]@{Bytes=$bytes.Length;Sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}
    }
    $result=[pscustomobject]@{
        Status=$(if($Evidence.Guest.ExitCode -eq 0){'NETWORK_RECOVERY_EVIDENCE_COLLECTED'}else{'NETWORK_RECOVERY_FAILED_EVIDENCE_COLLECTED'})
        RecoveryRunId='network-recovery-20261016-v1';SeedRunId='02ea2f0d324543a1ab2973e73c97421d'
        CollectorExitCode=0;GuestExitCode=$Evidence.Guest.ExitCode;GuestStatus=$Evidence.Guest.Status;GuestPhase=$Evidence.Guest.Phase
        GuestReportedAddress=$Evidence.Guest.Address;ConfigCreated=$Evidence.Guest.ConfigCreated;UntrustedGuestTimestamp=$Evidence.Guest.UntrustedGuestTimestamp
        HostCollectedAt=[DateTimeOffset]::UtcNow.ToString('o');HostDismounted=$true;SeedReattached=$false;SshVerified=$false
        EvidenceClass='UNTRUSTED_GUEST_DIAGNOSTICS';OutputDirectory=$directory;Files=$hashes
    }
    Write-Ai09RepairNewFile -Path (Join-Path $directory 'collection.json') -Bytes ([Text.UTF8Encoding]::new($false).GetBytes(($result | ConvertTo-Json -Depth 6)))
    return $result
}

function Invoke-Ai09NetworkCollection {
    param([ValidateSet('Verify','Collect')][string]$Mode='Verify',[switch]$GuestUnmountConfirmed,[ValidateRange(0,255)][Nullable[int]]$ObservedGuestExitCode)
    if($Mode -eq 'Collect' -and -not $GuestUnmountConfirmed){throw 'EXPLICIT_GUEST_UNMOUNT_CONFIRMATION_REQUIRED'}
    if($Mode -eq 'Collect' -and $null -eq $ObservedGuestExitCode){throw 'OBSERVED_GUEST_EXIT_REQUIRED'}
    $scope=Get-Ai09CollectionScope
    $seed=@(Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true)
    $null=Get-Ai09CollectionVhd $scope
    if($Mode -eq 'Verify'){return [pscustomobject]@{Status='READ_ONLY_NETWORK_COLLECTION_PREFLIGHT';GuestUnmountConfirmed=[bool]$GuestUnmountConfirmed;GuestFilesRead=$false}}
    Assert-Ai09Administrator
    $seed=@(Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true)
    $null=Get-Ai09CollectionVhd $scope
    Remove-VMHardDiskDrive -VMHardDiskDrive $seed[0] -ErrorAction Stop
    $attempted=$false;$evidence=$null
    try {
        $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
        if((Get-Ai09CollectionVhd $scope).Attached){throw 'SEED_IN_USE_DO_NOT_MOUNT'}
        $attempted=$true
        $mounted=Mount-VHD -Path $scope.SeedPath -ReadOnly -PassThru -ErrorAction Stop
        $root=Get-Ai09ReadOnlySeedRoot -Scope $scope -Mounted $mounted
        $evidence=Read-Ai09NetworkEvidence $root
        if($evidence.Guest.ExitCode -ne $ObservedGuestExitCode){throw 'OBSERVED_GUEST_EXIT_MISMATCH'}
    } finally {
        if($attempted){
            Assert-Ai09SeedDetachedFromVm $scope
            if((Get-Ai09CollectionVhd $scope).Attached){Dismount-VHD -Path $scope.SeedPath -ErrorAction Stop}
            if((Get-Ai09CollectionVhd $scope).Attached){throw 'HOST_DISMOUNT_UNCONFIRMED'}
        }
    }
    $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $false
    if((Get-Ai09CollectionVhd $scope).Attached){throw 'HOST_DISMOUNT_UNCONFIRMED'}
    return Save-Ai09NetworkCollection $evidence
}

if($MyInvocation.InvocationName -ne '.'){
    $locks=[Collections.Generic.List[IO.FileStream]]::new()
    try {
        if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess){throw 'NATIVE_WINDOWS_POWERSHELL_51_REQUIRED'}
        $requestedMode=$Mode;$confirmed=$GuestUnmountConfirmed;$observedCode=$ObservedGuestExitCode
        $helpers=@(
            @{Name='ai09-prepare-bootstrap-disk.ps1';Hash='E6E7B482E112609749C6982F051B1D35842EEE51FCDC563F4E9408B1D3C15B6B'},
            @{Name='ai09-collect-bootstrap-result.ps1';Hash='6A0E4D4264825A8D38C749F74BF9706FCCD39B59BDF8CF22CB8BFD3B6975F391'},
            @{Name='ai09-repair-seed-hostname.ps1';Hash='B46A1DD340E62705603448637763219224A6E5E3DEBF519EBB638406025EE7EE'},
            @{Name='ai09-stage-network-recovery.ps1';Hash='1624FF79246D462B2B28D01204E5ABCE50FC2893AE2F1C83E7A518C5567D79AF'}
        )
        foreach($helper in $helpers){
            $handle=[IO.File]::Open((Join-Path $PSScriptRoot $helper.Name),'Open','Read','Read');$locks.Add($handle)
            $hasher=[Security.Cryptography.SHA256]::Create()
            try {$hash=([BitConverter]::ToString($hasher.ComputeHash($handle))).Replace('-','')}finally{$hasher.Dispose()}
            if($hash -cne $helper.Hash){throw 'RECOVERY_COLLECTION_HELPER_HASH_MISMATCH'}
        }
        foreach($helper in $helpers){. (Join-Path $PSScriptRoot $helper.Name)}
        Invoke-Ai09NetworkCollection -Mode $requestedMode -GuestUnmountConfirmed:$confirmed -ObservedGuestExitCode $observedCode | ConvertTo-Json -Depth 6
    } catch {Write-Error $_;exit 1}
    finally {foreach($handle in $locks){$handle.Dispose()}}
}
