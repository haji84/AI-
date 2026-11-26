# Filesystem fixtures and fake named modules only; never native Hyper-V, keys or ACLs.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/ai09-first-access-host.ps1')
. (Join-Path $PSScriptRoot '../scripts/ai09-access-media.ps1')
$script:RealMediaSnapshot=(Get-Command Get-Ai09MediaNativeSnapshot).ScriptBlock
$script:RealLease=(Get-Command Assert-Ai09MediaLease).ScriptBlock
$script:RealVolume=(Get-Command Assert-Ai09MediaVolume).ScriptBlock
$script:Assertions=0
function Yes($Value,$Label){$script:Assertions++;if(-not $Value){throw "ASSERT:$Label"}}
function Equal($Actual,$Expected,$Label){Yes ($Actual -ceq $Expected) "$Label expected=$Expected actual=$Actual"}
function Reject($Action,$Code){try{& $Action|Out-Null;throw 'ASSERT:EXPECTED_REFUSAL'}catch{Equal $_.Exception.Message $Code 'expected refusal'}}
function Assert-Ai09NativeAuthority {}
function Assert-Ai09FirstNetworkReaders {}
function Assert-Ai09OwnerPath {param($Path)}
function Assert-Ai09MediaAllowedWriter {param($Path)}
function Get-Ai09SafePath {param($Path)
  if($global:MediaFixture -and ($global:MediaFixture.UnsafePath -or $Path -ceq $global:MediaFixture.AliasPath)){throw 'PATH_ALIAS'}
  if($global:MediaFixture -and $Path -ceq $global:MediaFixture.UntrustedPath){throw 'OWNER_PATH_REQUIRED'}
  return $Path
}
function Get-Ai09MediaScope {return $global:MediaFixture.Scope}
function New-Ai09PrivateDirectory {param($Path) $global:MediaFixture.PrivateDirs++;$null=[IO.Directory]::CreateDirectory($Path)}
function New-Ai09MediaClientKey {param($Key)
  $global:MediaFixture.Keys++
  [IO.File]::WriteAllText($Key,'TEST FIXTURE ONLY: NOT AN SSH PRIVATE KEY')
  [IO.File]::WriteAllText($Key+'.pub','ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4f fixture')
}
function Assert-Ai09MediaLease {param($Expiry)
  if($global:MediaFixture.ExpireNow){throw 'APPROVAL_EXPIRED_OR_TOO_LONG'}
  & $script:RealLease $Expiry
}
function Read-FixtureState {
  $global:MediaFixture.Reads++
  if($global:MediaFixture.DriftAt -eq $global:MediaFixture.Reads){$global:MediaFixture.State.acls[0].RemotePort='9'}
  return ($global:MediaFixture.State|ConvertTo-Json -Depth 20|ConvertFrom-Json)
}
function Get-Ai09FirstNativeSnapshot {return Read-FixtureState}
function Get-Ai09MediaNativeSnapshot {return Read-FixtureState}
function Assert-Ai09MediaVolume {param($Record,[bool]$Raw=$false)
  $v=& $script:RealVolume $Record $Raw
  if(-not $Raw){$v.root=$global:MediaFixture.Volume}
  return $v
}
function Assert-Ai09MediaPrivateKeyMetadata {param($Path)
  if($global:MediaFixture.UnsafeMetadata){throw 'MEDIA_PRIVATE_KEY_METADATA_INVALID'}
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw 'MEDIA_PRIVATE_KEY_METADATA_INVALID'}
}
function Get-Ai09MediaResumeOrigin {return $global:MediaFixture.Origin}
function Get-Ai09MediaCollectOrigin {return $global:MediaFixture.CollectionOrigin}
function Get-CimInstance {param($ClassName,$Filter)
  if($ClassName -cne 'Win32_LogicalDisk' -or $Filter -cne "DeviceID='X:'"){throw 'UNEXPECTED_CIM_QUERY'}
  return @{VolumeSerialNumber=$global:MediaFixture.Serial}
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('ai09-media-lifecycle-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($root)
$sourceFiles=Join-Path $root 'source'
$null=[IO.Directory]::CreateDirectory($sourceFiles)
foreach($name in @('ai09-access-media.ps1','ai09-owner-key-enroll.py','ai09-first-access-inspect.py','ai09-first-access-host.ps1','ai09-access-host.ps1')){
  [IO.File]::Copy((Join-Path $script:Ai09MediaScripts $name),(Join-Path $sourceFiles $name))
}
$script:Ai09MediaScripts=$sourceFiles
$script:Bundle=Get-Ai09MediaBundle
$script:OldMedia=Join-Path $root 'old-seed-sentinel.vhdx'
[IO.File]::WriteAllText($script:OldMedia,'UNRELATED OLD MEDIA MUST REMAIN')
function Reset-Fixture {
  $case=Join-Path $root ([guid]::NewGuid().ToString('N'));$null=[IO.Directory]::CreateDirectory($case)
  $volume=Join-Path $case 'volume';$null=[IO.Directory]::CreateDirectory($volume)
  $global:MediaFixture=[ordered]@{
    Scope=[ordered]@{Media=(Join-Path $case 'new.vhdx');State=(Join-Path $case 'state');Slot=3;Label='A09'}
    Volume=$volume;HostMounted=$false;GuestAttached=$false;ReadOnly=$false;Style='RAW';Partitions=0
    New=0;Mounts=0;Dismounts=0;Adds=0;Removes=0;Formats=0;Keys=0;Reads=0;DriftAt=-1;NetworkAdds=0;Initializes=0;PartitionWrites=0
    EnumerationFail=$false;UnsafeMetadata=$false;UnsafePath=$false;Origin=$null;BindingPath='';BindingSha256='';WrongUniqueId=$false;WrongVhd=$false;PrivateDirs=0;CheckOriginLocks=$false;OriginLocksChecked=0
    AliasPath='';UntrustedPath='';CollectionOrigin=$null;CollectBindingPath='';CollectBindingSha256='';CollectionBundle=$null;CollectionReference='fixture-collect-owner';CheckCollectionLocks=$false;CollectionLocksChecked=0
    FormatFail=$false;ExpireAfterFormat=$false;ExpireNow=$false;ForceWritable=$false;WrongAttachment=$false;DismountNoEffect=$false
    Serial='CA771234';Signature=[uint32]0x12345678;LastMountReadOnly=$false
    ManagementMac='001122334455';Interfaces=@(@{MacAddress=$null;ifIndex=98},@{MacAddress='';ifIndex=97},@{MacAddress='00-11-22-33-44-55';ifIndex=21})
    Expiry=[DateTimeOffset]::UtcNow.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    State=[ordered]@{hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';vmName='GORIQ-AI09-Ubuntu';vmState='Running';generation=2
      nic=[ordered]@{id='Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D';name='Network Adapter';mac='00155DDC2C00';switchId='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';switchName='Default Switch'}
      switch=[ordered]@{id='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';name='Default Switch';type='Internal'}
      hostAddress='172.27.128.1';guestAddress='172.27.140.254';guestAddressCandidates=@();hostInterfaceIndex=21;hostPrefixLength=20
      disks=@([ordered]@{path='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx';controllerType='SCSI';controllerNumber=0;controllerLocation=0;diskIdentifier='9D28872E-0087-4A33-ABFA-AE0DEF1E66B8';parentPath='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu.vhdx';vhdType='Differencing';vhdFormat='VHDX';size=42949672960;fileSize=32768})
      acls=@(Get-Ai09FirstOriginalRules)}
  }
}
function Prepare-Fixture {
  return Invoke-Ai09MediaOperation -Mode Prepare -LockedBundle $script:Bundle -AuthorizationReference 'fixture-owner' -ExpiresAt $global:MediaFixture.Expiry
}
function Guest-Results {
  [IO.File]::WriteAllText((Join-Path $global:MediaFixture.Volume 'baseline.txt'),'fixture baseline')
  [IO.File]::WriteAllText((Join-Path $global:MediaFixture.Volume 'enrollment.json'),'{"status":"BLOCKED","code":"FIXTURE_ONLY"}')
  [IO.File]::WriteAllText((Join-Path $global:MediaFixture.Volume 'exit.txt'),'1')
}
function Collect-Fixture([switch]$PermitNetwork) {
  return Invoke-Ai09MediaOperation -Mode Collect -LockedBundle $script:Bundle -AuthorizationReference 'fixture-owner' -ExpiresAt $global:MediaFixture.Expiry -GuestUnmountConfirmed -PermitNetwork:$PermitNetwork
}
function Guest-AppliedFixture {
  $f=$global:MediaFixture
  $p=Read-Ai09MediaJson (Join-Path $f.Volume 'plan.json')
  $base=[ordered]@{status='AUTHENTICATED_ROOT_BASELINE';nonce=$p.runId;effectiveUid=0;hostname='848484';mac='00:15:5d:dc:2c:00';addresses=@('172.27.140.254/20');hostKeyFingerprint='SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA';observedAt=[DateTimeOffset]::UtcNow.ToString('o')}
  $receipt=[ordered]@{status='APPLIED';runId=$p.runId;authorizationRef=$p.authorizationRef;expiresAt=$p.expiresAt;planSha256=(Get-Ai09ShaBytes ([IO.File]::ReadAllBytes((Join-Path $f.Volume 'plan.json'))));executorSha256=$script:Bundle.files['ai09-owner-key-enroll.py']}
  [IO.File]::WriteAllText((Join-Path $f.Volume 'baseline.txt'),("AI09_FIRST_ACCESS_BEGIN`n"+(Get-Ai09Json $base)+"`nAI09_FIRST_ACCESS_END`n"))
  [IO.File]::WriteAllText((Join-Path $f.Volume 'enrollment.json'),(Get-Ai09Json $receipt))
  [IO.File]::WriteAllText((Join-Path $f.Volume 'exit.txt'),'0')
}
function Reset-ResumeFixture {
  Reset-Fixture;$f=$global:MediaFixture
  $null=[IO.Directory]::CreateDirectory($f.Scope.State)
  New-Ai09MediaClientKey (Join-Path $f.Scope.State 'client_ed25519');$f.Keys=0
  [IO.File]::WriteAllText($f.Scope.Media,'FAKE EXISTING VHD')
  $baseline=Get-Ai09FirstCanonical (Read-FixtureState)
  $r=[ordered]@{version=1;issue=1219;runId=('a'*32);authorizationRef='old-fixture-owner';expiresAt=$f.Expiry;bundleSha256=('b'*64);baselineSha256=(Get-Ai09Digest $baseline);baseline=$baseline;vhdIdentifier='';diskUniqueId='';diskNumber=-1;fileSystemUuid='';partitionUuid='';payloadSha256=@{}}
  Write-Ai09MediaNew (Join-Path $f.Scope.State 'intent.json') ([Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $r)))
  $r.vhdIdentifier='fixture-vhd-id';$r.diskUniqueId='fixture-disk-id';$r.diskNumber=983
  Write-Ai09MediaNew (Join-Path $f.Scope.State 'prepared.json') ([Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $r)))
  $failure=Join-Path $f.Scope.State 'failure.json'
  [IO.File]::WriteAllText($failure,'{"status":"NATIVE_PREPARATION_FAILED","errorId":"CmdletizationQuery_NotFound_DiskNumber,Get-Partition"}')
  $f.Origin=[ordered]@{runId=$r.runId;vhdIdentifier=$r.vhdIdentifier;diskUniqueId=$r.diskUniqueId;baselineSha256=$r.baselineSha256;bundleSha256=$r.bundleSha256;authorizationRef=$r.authorizationRef;expiresAt=$r.expiresAt;failurePath=$failure}
  foreach($pair in @(@('intentSha256','intent.json'),@('preparedSha256','prepared.json'),@('publicKeySha256','client_ed25519.pub'),@('failureSha256','failure.json'))){$f.Origin[$pair[0]]=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes((Join-Path $f.Scope.State $pair[1])))}
  $f.BindingPath=Join-Path $f.Scope.State 'resume-binding.json'
  $binding=[ordered]@{version=1;issue=1219;profile='AI09_RESUME_EMPTY_MBR_V1';bundleSha256=$script:Bundle.sha256;authorizationRef='fixture-owner';expiresAt=$f.Expiry;originBundleSha256=$f.Origin.bundleSha256;intentSha256=$f.Origin.intentSha256;preparedSha256=$f.Origin.preparedSha256;failureSha256=$f.Origin.failureSha256;publicKeySha256=$f.Origin.publicKeySha256}
  [IO.File]::WriteAllText($f.BindingPath,(Get-Ai09Json $binding))
  $f.BindingSha256=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($f.BindingPath));$f.Style='MBR'
}
function Resume-Fixture {
  return Invoke-Ai09MediaOperation -Mode ResumeEmptyMbr -LockedBundle $script:Bundle -AuthorizationReference 'fixture-owner' -ExpiresAt $global:MediaFixture.Expiry -ResumeBindingPath $global:MediaFixture.BindingPath -ResumeBindingSha256 $global:MediaFixture.BindingSha256
}
function Collect-ResumeFixture([string]$CompletionSha256,[switch]$PermitNetwork) {
  return Invoke-Ai09MediaOperation -Mode Collect -LockedBundle $script:Bundle -AuthorizationReference 'fixture-owner' -ExpiresAt $global:MediaFixture.Expiry -GuestUnmountConfirmed -ResumeBindingPath $global:MediaFixture.BindingPath -ResumeBindingSha256 $global:MediaFixture.BindingSha256 -CompletionRecordSha256 $CompletionSha256 -PermitNetwork:$PermitNetwork
}
function Change-ResumeBinding($Change) {
  $f=$global:MediaFixture;$b=Read-Ai09MediaJson $f.BindingPath;& $Change $b
  [IO.File]::WriteAllText($f.BindingPath,(Get-Ai09Json $b));$f.BindingSha256=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($f.BindingPath))
}
function Reset-CollectionFixture {
  Reset-ResumeFixture;$resumed=Resume-Fixture;Guest-AppliedFixture;$f=$global:MediaFixture
  $f.CollectionOrigin=@{bundleSha256=$script:Bundle.sha256;authorizationRef='fixture-owner';expiresAt=$f.Expiry;resumeBindingSha256=$f.BindingSha256;completionRecordSha256=$resumed.completionRecordSha256}
  $f.CollectionBundle=@{sha256=('c'*64);files=$script:Bundle.files}
  $witness=Join-Path $f.Scope.State 'origin-failure-witness-0f1b61b1.json'
  [IO.File]::Copy($f.Origin.failurePath,$witness)
  $f.UntrustedPath=$f.Origin.failurePath
  $f.CollectBindingPath=Join-Path $f.Scope.State 'collect-binding.json'
  $binding=[ordered]@{version=1;issue=1219;profile='AI09_RESUMED_COLLECT_V1';bundleSha256=$f.CollectionBundle.sha256;authorizationRef='fixture-collect-owner';expiresAt=$f.Expiry;permitNetwork=$true;resumeBundleSha256=$script:Bundle.sha256;resumeBindingSha256=$f.BindingSha256;completionRecordSha256=$resumed.completionRecordSha256;failureWitnessSha256=$f.Origin.failureSha256}
  [IO.File]::WriteAllText($f.CollectBindingPath,(Get-Ai09Json $binding));$f.CollectBindingSha256=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($f.CollectBindingPath))
}
function Collect-ContinuationFixture([switch]$WithoutNetwork,[switch]$WithoutUnmount) {
  $f=$global:MediaFixture
  return Invoke-Ai09MediaOperation -Mode Collect -LockedBundle $f.CollectionBundle -AuthorizationReference $f.CollectionReference -ExpiresAt $f.Expiry -GuestUnmountConfirmed:(-not $WithoutUnmount) -PermitNetwork:(-not $WithoutNetwork) -ResumeBindingPath $f.BindingPath -ResumeBindingSha256 $f.BindingSha256 -CompletionRecordSha256 $f.CollectionOrigin.completionRecordSha256 -CollectBindingPath $f.CollectBindingPath -CollectBindingSha256 $f.CollectBindingSha256
}
function Change-CollectBinding($Change) {
  $f=$global:MediaFixture;$b=Read-Ai09MediaJson $f.CollectBindingPath;& $Change $b
  [IO.File]::WriteAllText($f.CollectBindingPath,(Get-Ai09Json $b));$f.CollectBindingSha256=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($f.CollectBindingPath))
}
function Change-CollectionCompletion($Change) {
  $f=$global:MediaFixture;$path=Join-Path $f.Scope.State 'resume-empty-mbr-completed.json';$v=Read-Ai09MediaJson $path;& $Change $v
  [IO.File]::WriteAllText($path,(Get-Ai09Json $v));$f.CollectionOrigin.completionRecordSha256=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($path))
  Change-CollectBinding {param($b) $b.completionRecordSha256=$global:MediaFixture.CollectionOrigin.completionRecordSha256}
}
try {
  $null=New-Module -Name Hyper-V -ScriptBlock {
    function Get-VM {param($Id) $s=$global:MediaFixture.State;return @{Id=$s.vmId;Name=$s.vmName;State='Running';Generation=2}}
    function Get-VMNetworkAdapter {param($VM,[switch]$ManagementOS)
      $s=$global:MediaFixture.State
      if($ManagementOS){return @{SwitchId=$s.nic.switchId;MacAddress=$global:MediaFixture.ManagementMac}}
      return @{Id=$s.nic.id;VMId=$s.vmId;Name=$s.nic.name;MacAddress=$s.nic.mac;SwitchId=$s.nic.switchId;SwitchName=$s.nic.switchName;IPAddresses=$s.guestAddressCandidates}
    }
    function Get-VMSwitch {param($Id) $s=$global:MediaFixture.State.switch;return @{Id=$s.id;Name=$s.name;SwitchType=$s.type}}
    function Get-VMNetworkAdapterExtendedAcl {param($VMNetworkAdapter) return @($global:MediaFixture.State.acls|ForEach-Object {[pscustomobject]$_})}
    function Add-VMNetworkAdapterExtendedAcl {param($VMNetworkAdapter,$Action,$Direction,$LocalIPAddress,$RemoteIPAddress,$LocalPort,$RemotePort,$Protocol,$Weight,[switch]$Stateful,$IdleSessionTimeout,$IsolationID)
      $f=$global:MediaFixture;$f.NetworkAdds++
      $f.State.acls+=@([ordered]@{Action=[string]$Action;Direction=[string]$Direction;Weight=[int]$Weight;LocalIPAddress=[string]$LocalIPAddress;RemoteIPAddress=[string]$RemoteIPAddress;LocalPort=[string]$LocalPort;RemotePort=[string]$RemotePort;Protocol=[string]$Protocol;Stateful=[bool]$Stateful;IdleSessionTimeout=[int]$IdleSessionTimeout;IsolationID=[int]$IsolationID})
    }
    function Get-VMDvdDrive {param($VM) return @()}
    function Get-VMHardDiskDrive {param($VM,$VMName)
      $f=$global:MediaFixture;$d=$f.State.disks[0]
      $rows=@([pscustomobject]@{Path=$d.path;ControllerType=$d.controllerType;ControllerNumber=0;ControllerLocation=0})
      if($f.GuestAttached){
        $location=3;if($f.WrongAttachment){$location=2}
        $rows+=@([pscustomobject]@{Path=$f.Scope.Media;ControllerType='SCSI';ControllerNumber=0;ControllerLocation=$location})
      }
      return $rows
    }
    function New-VHD {param($Path,[switch]$Dynamic,$SizeBytes)
      $f=$global:MediaFixture;if($Path -cne $f.Scope.Media -or -not $Dynamic -or $SizeBytes -ne 256MB){throw 'UNEXPECTED_NEW_VHD'}
      $f.New++;[IO.File]::WriteAllText($Path,'FAKE VHD FIXTURE')
    }
    function Get-VHD {param($Path)
      $f=$global:MediaFixture
      if($Path -ceq $f.State.disks[0].path){return $f.State.disks[0]}
      if($Path -cne $f.Scope.Media){throw 'UNEXPECTED_VHD_PATH'}
      $id='fixture-vhd-id';if($f.WrongVhd){$id='unrelated-vhd'}
      return @{Path=$Path;DiskIdentifier=$id;Size=256MB;VhdType='Dynamic';VhdFormat='VHDX';ParentPath='';Attached=$f.HostMounted;DiskNumber=7}
    }
    function Mount-VHD {param($Path,[switch]$ReadOnly,[switch]$PassThru)
      $f=$global:MediaFixture;if($Path -cne $f.Scope.Media -or $f.GuestAttached){throw 'UNSAFE_MOUNT'}
      $f.Mounts++;$f.HostMounted=$true;$f.LastMountReadOnly=[bool]$ReadOnly;$f.ReadOnly=[bool]$ReadOnly -and -not $f.ForceWritable
    }
    function Dismount-VHD {param($Path)
      $f=$global:MediaFixture;if($Path -cne $f.Scope.Media){throw 'UNEXPECTED_DISMOUNT'}
      $f.Dismounts++;if(-not $f.DismountNoEffect){$f.HostMounted=$false}
    }
    function Add-VMHardDiskDrive {param($VMName,$ControllerType,$ControllerNumber,$ControllerLocation,$Path)
      $f=$global:MediaFixture
      if($VMName -cne 'GORIQ-AI09-Ubuntu' -or $ControllerType -cne 'SCSI' -or $ControllerNumber -ne 0 -or $ControllerLocation -ne 3 -or $Path -cne $f.Scope.Media -or $f.HostMounted){throw 'UNEXPECTED_ATTACH'}
      $f.Adds++;$f.GuestAttached=$true
    }
    function Remove-VMHardDiskDrive {param($VMHardDiskDrive)
      $f=$global:MediaFixture
      if($VMHardDiskDrive.Path -cne $f.Scope.Media -or $VMHardDiskDrive.ControllerLocation -ne 3){throw 'UNEXPECTED_REMOVE'}
      if($f.CheckCollectionLocks){
        foreach($path in @($f.CollectBindingPath,$f.BindingPath,(Join-Path $f.Scope.State 'intent.json'),(Join-Path $f.Scope.State 'prepared.json'),(Join-Path $f.Scope.State 'origin-failure-witness-0f1b61b1.json'),(Join-Path $f.Scope.State 'client_ed25519.pub'),(Join-Path $f.Scope.State 'resume-empty-mbr-attempt.json'),(Join-Path $f.Scope.State 'resume-empty-mbr-completed.json'))){
          $denied=$false;$writer=$null
          try{$writer=[IO.File]::Open($path,'Open','Write','None')}catch [IO.IOException]{$denied=$true}finally{if($writer){$writer.Dispose()}}
          if(-not $denied){throw 'COLLECTION_RECORD_NOT_READ_LOCKED'};$f.CollectionLocksChecked++
        }
      }
      $f.Removes++;$f.GuestAttached=$false
    }
    Export-ModuleMember -Function *
  }|Import-Module -PassThru
  $null=New-Module -Name Storage -ScriptBlock {
    function Get-Volume {param($Partition)
      if($Partition){return @{FileSystem='FAT32';FileSystemLabel='A09'}}
      return @()
    }
    function Get-Disk {param($Number)
      $f=$global:MediaFixture;if($Number -ne 7){throw 'UNEXPECTED_DISK'}
      $id='fixture-disk-id';if($f.WrongUniqueId){$id='unrelated-disk'}
      return @{Number=7;UniqueId=$id;Size=256MB;IsBoot=$false;IsSystem=$false;IsOffline=$false;PartitionStyle=$f.Style;Signature=$f.Signature;IsReadOnly=$f.ReadOnly}
    }
    function Initialize-Disk {param($Number,$PartitionStyle)
      $f=$global:MediaFixture;if($Number -ne 7 -or $PartitionStyle -cne 'MBR' -or $f.Style -cne 'RAW'){throw 'UNEXPECTED_INITIALIZE'}
      $f.Initializes++;$f.Style='MBR'
    }
    function Get-Partition {param($DiskNumber)
      if($global:MediaFixture.EnumerationFail){throw 'GENUINE_STORAGE_ENUMERATION_FAILURE'}
      if($PSBoundParameters.ContainsKey('DiskNumber') -and -not $global:MediaFixture.Partitions){throw 'CmdletizationQuery_NotFound_DiskNumber'}
      if(-not $PSBoundParameters.ContainsKey('DiskNumber')){Write-Output @{DiskNumber=99;PartitionNumber=1;DriveLetter='Z'}}
      if($global:MediaFixture.Partitions){return @{DiskNumber=7;PartitionNumber=1;DriveLetter='X'}}
      return @()
    }
    function New-Partition {param($DiskNumber,[switch]$UseMaximumSize,[switch]$AssignDriveLetter)
      if($DiskNumber -ne 7 -or -not $UseMaximumSize -or -not $AssignDriveLetter){throw 'UNEXPECTED_PARTITION'}
      $f=$global:MediaFixture
      if($f.CheckOriginLocks){
        foreach($path in @($f.BindingPath,(Join-Path $f.Scope.State 'intent.json'),(Join-Path $f.Scope.State 'prepared.json'),$f.Origin.failurePath,(Join-Path $f.Scope.State 'client_ed25519.pub'))){
          $denied=$false;$writer=$null
          try{$writer=[IO.File]::Open($path,'Open','Write','None')}catch [IO.IOException]{$denied=$true}finally{if($writer){$writer.Dispose()}}
          if(-not $denied){throw 'ORIGIN_NOT_READ_LOCKED'};$f.OriginLocksChecked++
        }
      }
      $global:MediaFixture.PartitionWrites++;$global:MediaFixture.Partitions=1;return @{DiskNumber=7;PartitionNumber=1;DriveLetter='X'}
    }
    function Format-Volume {param($Partition,$FileSystem,$NewFileSystemLabel,[switch]$Confirm)
      $f=$global:MediaFixture
      if($Partition.DiskNumber -ne 7 -or $FileSystem -cne 'FAT32' -or $NewFileSystemLabel -cne 'A09'){throw 'UNEXPECTED_FORMAT'}
      $f.Formats++;if($f.FormatFail){throw 'FIXTURE_FORMAT_FAILURE'}
      if($f.ExpireAfterFormat){$f.ExpireNow=$true}
    }
    Export-ModuleMember -Function *
  }|Import-Module -PassThru
  $null=New-Module -Name NetAdapter -ScriptBlock {function Get-NetAdapter {param([switch]$IncludeHidden) return $global:MediaFixture.Interfaces};Export-ModuleMember -Function *}|Import-Module -PassThru
  $null=New-Module -Name NetTCPIP -ScriptBlock {function Get-NetIPAddress {param($InterfaceIndex,$AddressFamily) return @{IPAddress='172.27.128.1';PrefixLength=20;AddressState='Preferred'}};Export-ModuleMember -Function *}|Import-Module -PassThru

  Reset-Fixture
  $prepared=Prepare-Fixture;$f=$global:MediaFixture
  Equal $prepared.status 'NEW_MEDIA_ATTACHED_GUEST_NOT_EXECUTED' 'prepare status excludes guest execution'
  Equal $prepared.authenticatedConnectionVerified $false 'prepare not authentication'
  Equal $f.Adds 1 'one exact attachment';Equal $f.Dismounts 1 'host dismount before guest attach'
  Equal $f.Reads 4 'baseline and precreate/pre/post attach observations'
  $record=[IO.File]::ReadAllText((Join-Path $f.Scope.State 'prepared.json'))|ConvertFrom-Json
  Equal $record.fileSystemUuid 'CA77-1234' 'filesystem identity retained'
  Equal $record.partitionUuid '12345678-01' 'partition identity retained'
  Equal @($record.payloadSha256.PSObject.Properties).Count 4 'four pinned payloads'
  Yes (-not (Test-Path (Join-Path $f.Volume 'client_ed25519'))) 'private key never on media'
  Guest-Results
  $collected=Collect-Fixture
  Equal $collected.status 'NEW_MEDIA_COLLECTED_NOT_SSH_VERIFIED' 'collection not authentication'
  Equal $f.Removes 1 'only exact new attachment removed'
  Equal $f.LastMountReadOnly $true 'collect asks read-only mount'
  Equal $f.Dismounts 2 'collect finally dismounts'
  Equal ([IO.File]::ReadAllText((Join-Path $f.Scope.State 'collected-enrollment.json'))) '{"status":"BLOCKED","code":"FIXTURE_ONLY"}' 'failed guest result retained honestly'

  Reset-Fixture;$global:MediaFixture.FormatFail=$true
  Reject {Prepare-Fixture} 'FIXTURE_FORMAT_FAILURE'
  Equal $global:MediaFixture.Adds 0 'format failure never attaches'
  Equal $global:MediaFixture.Dismounts 1 'format failure finally dismounts'
  Yes (Test-Path (Join-Path $global:MediaFixture.Scope.State 'intent.json')) 'format failure preserves intent'
  Reset-Fixture;$global:MediaFixture.ExpireAfterFormat=$true
  Reject {Prepare-Fixture} 'APPROVAL_EXPIRED_OR_TOO_LONG'
  Equal $global:MediaFixture.Adds 0 'midflight expiry never attaches'
  Equal $global:MediaFixture.Dismounts 1 'midflight expiry finally dismounts'
  Reset-Fixture;$global:MediaFixture.DriftAt=3
  Reject {Prepare-Fixture} 'ORIGINAL_POLICY_DRIFT'
  Equal $global:MediaFixture.Adds 0 'ACL drift before attachment refused'
  Reset-Fixture;$global:MediaFixture.DriftAt=4
  Reject {Prepare-Fixture} 'ORIGINAL_POLICY_DRIFT'
  Equal $global:MediaFixture.Adds 1 'post-attach verification runs after exactly one attach'
  Yes $global:MediaFixture.GuestAttached 'post-attach uncertainty is retained for explicit reconciliation'
  Equal $global:MediaFixture.Removes 0 'post-attach drift does not silently mutate attachment again'
  Reset-Fixture;$global:MediaFixture.Expiry=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Reject {Prepare-Fixture} 'APPROVAL_EXPIRED_OR_TOO_LONG'
  Equal $global:MediaFixture.Keys 0 'expired approval creates no key'
  Equal $global:MediaFixture.New 0 'expired approval creates no disk'
  Reset-Fixture
  $enrollSource=Join-Path $sourceFiles 'ai09-owner-key-enroll.py'
  $savedEnroll=[IO.File]::ReadAllBytes($enrollSource)
  try {
    [IO.File]::AppendAllText($enrollSource,"`n# fixture unapproved change")
    Reject {Prepare-Fixture} 'APPROVED_PAYLOAD_DRIFT'
    Equal $global:MediaFixture.Adds 0 'unapproved payload never attaches'
    Equal $global:MediaFixture.Dismounts 1 'payload drift finally dismounts'
  } finally {[IO.File]::WriteAllBytes($enrollSource,$savedEnroll)}

  Reset-Fixture;$null=Prepare-Fixture
  Reject {Invoke-Ai09MediaOperation -Mode Collect -LockedBundle $script:Bundle -AuthorizationReference 'fixture-owner' -ExpiresAt $global:MediaFixture.Expiry} 'OWNER_OBSERVED_UNMOUNT_REQUIRED'
  Equal $global:MediaFixture.Removes 0 'missing unmount observation never detaches'
  foreach($variant in @('Writable','UUID','Size','Payload')){
    Reset-Fixture;$null=Prepare-Fixture;Guest-Results;$f=$global:MediaFixture
    switch($variant){
      'Writable' {$f.ForceWritable=$true;$code='MEDIA_READONLY_MOUNT_UNCONFIRMED'}
      'UUID' {$f.Serial='DEADBEEF';$code='MEDIA_VOLUME_IDENTITY_DRIFT'}
      'Size' {[IO.File]::WriteAllBytes((Join-Path $f.Volume 'baseline.txt'),(New-Object byte[] 131073));$code='MEDIA_RESULT_BOUND'}
      'Payload' {[IO.File]::AppendAllText((Join-Path $f.Volume 'enroll.py'),'tampered');$code='MEDIA_PAYLOAD_CHANGED'}
    }
    Reject {Collect-Fixture} $code
    Equal $f.Dismounts 2 "collect $variant failure dismounts"
    Equal $f.LastMountReadOnly $true "collect $variant requested readonly"
    Yes (-not $f.HostMounted) "collect $variant leaves host unmounted"
  }

  # Exercise actual two-disk projection, rather than mocking the projection under test.
  Reset-Fixture;$null=Prepare-Fixture;Guest-AppliedFixture
  $global:MediaFixture.DismountNoEffect=$true
  Reject {Collect-Fixture -PermitNetwork} 'MEDIA_HOST_STILL_MOUNTED'
  Equal $global:MediaFixture.NetworkAdds 0 'unconfirmed dismount never grants TCP22'
  Yes $global:MediaFixture.HostMounted 'no-op dismount is retained as uncertainty'
  Reset-Fixture;$null=Prepare-Fixture;Guest-AppliedFixture
  $permitted=Collect-Fixture -PermitNetwork
  Equal $permitted.network.status 'APPLIED_NETWORK_ONLY' 'real network core accepts newly approved fresh guest receipt fixture'
  Equal $global:MediaFixture.NetworkAdds 1 'exactly one TCP22 rule'
  Equal $permitted.authenticatedConnectionVerified $false 'network is not authentication'
  foreach($variant in @('Failed','Stale','Endpoint','PlanHash','NonzeroExit','MalformedExit','MissingExit')){
    Reset-Fixture;$null=Prepare-Fixture;Guest-AppliedFixture;$f=$global:MediaFixture
    switch($variant){
      'Failed' {Guest-Results;$code='FRESH_GUEST_BASELINE_REQUIRED'}
      'Stale' {$p=Join-Path $f.Volume 'baseline.txt';$v=[IO.File]::ReadAllText($p);$v=$v -replace '"observedAt":"[^"]+"',('"observedAt":"'+[DateTimeOffset]::UtcNow.AddHours(-1).ToString('o')+'"');[IO.File]::WriteAllText($p,$v);$code='FRESH_GUEST_BASELINE_REQUIRED'}
      'Endpoint' {$p=Join-Path $f.Volume 'baseline.txt';[IO.File]::WriteAllText($p,[IO.File]::ReadAllText($p).Replace('172.27.140.254/20','172.27.140.253/20'));$code='FRESH_GUEST_BASELINE_REQUIRED'}
      'PlanHash' {$p=Join-Path $f.Volume 'enrollment.json';$v=Read-Ai09MediaJson $p;$v.planSha256=('f'*64);[IO.File]::WriteAllText($p,(Get-Ai09Json $v));$code='ENROLLMENT_NOT_CONFIRMED'}
      'NonzeroExit' {[IO.File]::WriteAllText((Join-Path $f.Volume 'exit.txt'),'124');$code='GUEST_PROCESS_EXIT_NOT_SUCCESS'}
      'MalformedExit' {[IO.File]::WriteAllText((Join-Path $f.Volume 'exit.txt'),"0`n124");$code='GUEST_PROCESS_EXIT_NOT_SUCCESS'}
      'MissingExit' {[IO.File]::Delete((Join-Path $f.Volume 'exit.txt'));$code='MEDIA_RESULT_MISSING'}
    }
    Reject {Collect-Fixture -PermitNetwork} $code
    Equal $f.NetworkAdds 0 "$variant never grants network"
    Equal $f.LastMountReadOnly $true "$variant collection read-only"
  }
  Reset-Fixture;$global:MediaFixture.GuestAttached=$true
  $native=& $script:RealMediaSnapshot;$native.hostName='HAJI'
  $canonical=Get-Ai09FirstCanonical $native
  Equal @($native.disks).Count 1 'two attachments project only the original OS identity'
  Equal $canonical.disks[0].diskIdentifier '9D28872E-0087-4A33-ABFA-AE0DEF1E66B8' 'OS identity is preserved'
  Equal @($native.acls).Count 4 'native reader retains all ACLs'
  Equal $native.hostInterfaceIndex 21 'media native reader ignores MAC-less adapters'
  $savedInterfaces=$global:MediaFixture.Interfaces
  foreach($case in @('MissingManagement','EmptyManagement','MalformedManagement','Duplicate','MissingMatch')){
    $global:MediaFixture.Interfaces=$savedInterfaces;$global:MediaFixture.ManagementMac='001122334455'
    switch($case){
      'MissingManagement' {$global:MediaFixture.ManagementMac=$null}
      'EmptyManagement' {$global:MediaFixture.ManagementMac=''}
      'MalformedManagement' {$global:MediaFixture.ManagementMac='00112233445Z';$global:MediaFixture.Interfaces=@(@{MacAddress='00-11-22-33-44-5Z';ifIndex=21})}
      'Duplicate' {$global:MediaFixture.Interfaces=@($savedInterfaces)+@(@{MacAddress='00-11-22-33-44-55';ifIndex=22})}
      'MissingMatch' {$global:MediaFixture.Interfaces=@($savedInterfaces|Where-Object {$_.ifIndex -ne 21})}
    }
    Reject {& $script:RealMediaSnapshot} 'HOST_INTERFACE_AMBIGUOUS'
  }
  $global:MediaFixture.Interfaces=$savedInterfaces;$global:MediaFixture.ManagementMac='001122334455'
  $global:MediaFixture.WrongAttachment=$true
  Reject {& $script:RealMediaSnapshot} 'MEDIA_TOPOLOGY_DRIFT'
  $locks=New-Object 'Collections.Generic.List[IO.FileStream]'
  try {
    $locked=Get-Ai09MediaBundle $locks
    Equal $locked.sha256 $script:Bundle.sha256 'locked source bytes match approved bundle'
    Equal $locks.Count 5 'all executable source dependencies locked'
    foreach($name in $locked.files.Keys){
      $denied=$false;$writer=$null
      try{$writer=[IO.File]::Open((Join-Path $sourceFiles $name),'Open','Write','None')}catch [IO.IOException]{$denied=$true}finally{if($writer){$writer.Dispose()}}
      Yes $denied "source lock refuses writes to $name"
    }
  } finally {foreach($lock in $locks){$lock.Dispose()}}
  Equal ([IO.File]::ReadAllText($script:OldMedia)) 'UNRELATED OLD MEDIA MUST REMAIN' 'old media untouched'
  Reset-Fixture;$global:MediaFixture.EnumerationFail=$true
  Reject {Prepare-Fixture} 'GENUINE_STORAGE_ENUMERATION_FAILURE'
  Equal $global:MediaFixture.PartitionWrites 0 'genuine enumeration failure never partitions'
  Equal $global:MediaFixture.Formats 0 'genuine enumeration failure never formats'
  Equal $global:MediaFixture.Adds 0 'genuine enumeration failure never attaches'

  Reset-ResumeFixture;$f=$global:MediaFixture
  $originals=@{};foreach($name in @('intent.json','prepared.json','failure.json','client_ed25519.pub')){$originals[$name]=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes((Join-Path $f.Scope.State $name)))}
  $f.CheckOriginLocks=$true;$resumed=Resume-Fixture
  Equal $resumed.status 'RESUMED_MEDIA_ATTACHED_GUEST_NOT_EXECUTED' 'bounded resume succeeds'
  Equal $f.Keys 0 'resume never generates keys';Equal $f.New 0 'resume never creates VHD';Equal $f.Initializes 0 'resume never initializes disk'
  Equal $f.PrivateDirs 0 'resume never changes private directory ACL';Equal $f.OriginLocksChecked 5 'origin and binding held read-locked through partition write'
  Equal $f.PartitionWrites 1 'resume partitions exact owned disk only';Equal $f.Formats 1 'resume formats exact owned partition only'
  Equal $f.NetworkAdds 0 'resume never changes network ACL';Equal $f.Dismounts 1 'resume dismounts before attachment';Equal $f.Adds 1 'resume attaches exactly once'
  foreach($name in $originals.Keys){Equal (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes((Join-Path $f.Scope.State $name)))) $originals[$name] "origin $name bytes unchanged"}
  Reject {Collect-Fixture} 'MEDIA_RECEIPT_SCOPE_INVALID'
  Equal $f.Removes 0 'no automatic discovery of resume completion'
  Reject {Collect-ResumeFixture ('f'*64)} 'MEDIA_ORIGIN_HASH_DRIFT'
  Equal $f.Removes 0 'wrong completion pin never detaches'
  Guest-AppliedFixture
  $collected=Collect-ResumeFixture $resumed.completionRecordSha256 -PermitNetwork
  Equal $collected.network.status 'APPLIED_NETWORK_ONLY' 'explicit completion pin connects to guarded Collect'
  Equal $f.Removes 1 'pinned resume collection detaches exact media'
  Equal $f.LastMountReadOnly $true 'resumed collection is readonly'
  Equal $collected.authenticatedConnectionVerified $false 'resumed collection is not SSH proof'

  foreach($variant in @('RAW','GPT','Nonempty','UniqueId','VhdIdentity','Enumeration','UnsafeMetadata','UnsafePath','HostMounted','GuestAttached','Baseline','OriginHash','PreparedHash','FailureHash','PublicHash','MissingOrigin','Source','OldBundle','Schema','Extended','Expired','Stage','DuplicateAttempt','DuplicateCompletion','Dismount','ExpiryAfterFormat')){
    Reset-ResumeFixture;$f=$global:MediaFixture;$beforeMount=$false
    switch($variant){
      'RAW' {$f.Style='RAW';$code='MEDIA_RESUME_EMPTY_MBR_REQUIRED'}
      'GPT' {$f.Style='GPT';$code='MEDIA_RESUME_EMPTY_MBR_REQUIRED'}
      'Nonempty' {$f.Partitions=1;$code='MEDIA_RESUME_EMPTY_MBR_REQUIRED'}
      'UniqueId' {$f.WrongUniqueId=$true;$code='MEDIA_RESUME_EMPTY_MBR_REQUIRED'}
      'VhdIdentity' {$f.WrongVhd=$true;$code='MEDIA_VHD_IDENTITY_DRIFT';$beforeMount=$true}
      'Enumeration' {$f.EnumerationFail=$true;$code='GENUINE_STORAGE_ENUMERATION_FAILURE'}
      'UnsafeMetadata' {$f.UnsafeMetadata=$true;$code='MEDIA_PRIVATE_KEY_METADATA_INVALID';$beforeMount=$true}
      'UnsafePath' {$f.UnsafePath=$true;$code='PATH_ALIAS';$beforeMount=$true}
      'HostMounted' {$f.HostMounted=$true;$code='MEDIA_HOST_MUST_BE_DETACHED';$beforeMount=$true}
      'GuestAttached' {$f.GuestAttached=$true;$code='MEDIA_TOPOLOGY_DRIFT';$beforeMount=$true}
      'Baseline' {$f.State.acls[0].RemotePort='9';$code='ORIGINAL_POLICY_DRIFT';$beforeMount=$true}
      'OriginHash' {[IO.File]::AppendAllText((Join-Path $f.Scope.State 'intent.json'),' ');$code='MEDIA_ORIGIN_HASH_DRIFT';$beforeMount=$true}
      'PreparedHash' {[IO.File]::AppendAllText((Join-Path $f.Scope.State 'prepared.json'),' ');$code='MEDIA_ORIGIN_HASH_DRIFT';$beforeMount=$true}
      'FailureHash' {[IO.File]::AppendAllText($f.Origin.failurePath,' ');$code='MEDIA_ORIGIN_HASH_DRIFT';$beforeMount=$true}
      'PublicHash' {[IO.File]::AppendAllText((Join-Path $f.Scope.State 'client_ed25519.pub'),' ');$code='MEDIA_ORIGIN_HASH_DRIFT';$beforeMount=$true}
      'MissingOrigin' {$f.Origin.failurePath=Join-Path $f.Scope.State 'absent-failure.json';$code=$null;$beforeMount=$true}
      'Source' {Change-ResumeBinding {param($b) $b.bundleSha256=('f'*64)};$code='MEDIA_RESUME_SCOPE_INVALID';$beforeMount=$true}
      'OldBundle' {Change-ResumeBinding {param($b) $b.originBundleSha256=('f'*64)};$code='MEDIA_RESUME_SCOPE_INVALID';$beforeMount=$true}
      'Schema' {Change-ResumeBinding {param($b) $b|Add-Member -NotePropertyName executablePath -NotePropertyValue 'arbitrary.exe'};$code='SCHEMA_INVALID';$beforeMount=$true}
      'Extended' {$f.Expiry=[DateTimeOffset]::Parse($f.Expiry).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');Change-ResumeBinding {param($b) $b.expiresAt=$global:MediaFixture.Expiry};$code='MEDIA_RESUME_SCOPE_INVALID';$beforeMount=$true}
      'Expired' {$f.Expiry=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');Change-ResumeBinding {param($b) $b.expiresAt=$global:MediaFixture.Expiry};$code='APPROVAL_EXPIRED_OR_TOO_LONG';$beforeMount=$true}
      'Stage' {$path=Join-Path $f.Scope.State 'prepared.json';$v=Read-Ai09MediaJson $path;$v.fileSystemUuid='CA77-1234';[IO.File]::WriteAllText($path,(Get-Ai09Json $v));$f.Origin.preparedSha256=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($path));Change-ResumeBinding {param($b) $b.preparedSha256=$global:MediaFixture.Origin.preparedSha256};$code='MEDIA_ORIGIN_STAGE_INVALID';$beforeMount=$true}
      'DuplicateAttempt' {[IO.File]::WriteAllText((Join-Path $f.Scope.State 'resume-empty-mbr-attempt.json'),'existing');$code='MEDIA_RESUME_ALREADY_ATTEMPTED';$beforeMount=$true}
      'DuplicateCompletion' {[IO.File]::WriteAllText((Join-Path $f.Scope.State 'resume-empty-mbr-completed.json'),'existing');$code='MEDIA_RESUME_ALREADY_ATTEMPTED';$beforeMount=$true}
      'Dismount' {$f.DismountNoEffect=$true;$code='MEDIA_HOST_STILL_MOUNTED'}
      'ExpiryAfterFormat' {$f.ExpireAfterFormat=$true;$code='APPROVAL_EXPIRED_OR_TOO_LONG'}
    }
    if($variant -eq 'MissingOrigin'){
      $refused=$false;try{Resume-Fixture|Out-Null}catch{$refused=$true};Yes $refused 'missing origin metadata refuses'
    }else{Reject {Resume-Fixture} $code}
    Equal $f.Adds 0 "$variant resume never attaches"
    Equal $f.Keys 0 "$variant no key generation";Equal $f.New 0 "$variant no VHD creation";Equal $f.Initializes 0 "$variant no initialize"
    if($beforeMount){Equal $f.Mounts 0 "$variant refusal before mount";Equal $f.PartitionWrites 0 "$variant refusal before partition"}
    elseif($variant -notin @('Dismount','ExpiryAfterFormat')){Equal $f.PartitionWrites 0 "$variant no partition writes";Equal $f.Formats 0 "$variant no format";Equal $f.Dismounts 1 "$variant cleans host mount"}
    if(Test-Path -LiteralPath (Join-Path $f.Scope.State 'resume-empty-mbr-attempt.json')){Reject {Resume-Fixture} 'MEDIA_RESUME_ALREADY_ATTEMPTED'}
  }
  foreach($variant in @('BindingSelection','OriginLink','AttemptLink')){
    Reset-ResumeFixture;$resumed=Resume-Fixture;$f=$global:MediaFixture
    $completionPath=Join-Path $f.Scope.State 'resume-empty-mbr-completed.json'
    $completion=Read-Ai09MediaJson $completionPath
    switch($variant){
      'BindingSelection' {$completion.resumeBindingSha256=('f'*64)}
      'OriginLink' {$completion.origin.originBundleSha256=('f'*64)}
      'AttemptLink' {$path=Join-Path $f.Scope.State 'resume-empty-mbr-attempt.json';$attempt=Read-Ai09MediaJson $path;$attempt.runId=('f'*32);[IO.File]::WriteAllText($path,(Get-Ai09Json $attempt));$completion.attemptSha256=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($path))}
    }
    [IO.File]::WriteAllText($completionPath,(Get-Ai09Json $completion))
    Reject {Collect-ResumeFixture (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($completionPath)))} 'MEDIA_RESUME_COMPLETION_INVALID'
    Equal $f.Removes 0 "$variant forged pinned completion never detaches"
    Equal $f.NetworkAdds 0 "$variant forged completion never grants network"
  }
  Reset-CollectionFixture;$f=$global:MediaFixture
  Reject {Collect-ResumeFixture $f.CollectionOrigin.completionRecordSha256} 'OWNER_PATH_REQUIRED'
  Equal $f.Removes 0 'unsafe historical witness refuses before detach'
  $historical=@{};foreach($name in @('intent.json','prepared.json','resume-empty-mbr-attempt.json','resume-empty-mbr-completed.json','resume-binding.json')){$historical[$name]=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes((Join-Path $f.Scope.State $name)))}
  $f.CheckCollectionLocks=$true;$continued=Collect-ContinuationFixture
  Equal $continued.network.status 'APPLIED_NETWORK_ONLY' 'new executor collects historical completion with protected exact witness'
  Equal $f.Removes 1 'continuation detaches exact media once';Equal $f.LastMountReadOnly $true 'continuation mounts readonly'
  Equal $f.CollectionLocksChecked 8 'new binding and complete historical chain read-locked before detach'
  Equal $continued.authenticatedConnectionVerified $false 'continuation is not SSH proof'
  Equal $continued.collection.executorBundleSha256 $f.CollectionBundle.sha256 'result links current executor'
  Equal $continued.collection.historicalBundleSha256 $script:Bundle.sha256 'result preserves historical executor'
  $networkPlan=Read-Ai09MediaJson (Join-Path $f.Scope.State 'network-plan.json')
  Equal $networkPlan.authorizationRef 'fixture-collect-owner' 'network uses new execution authorization'
  foreach($name in $historical.Keys){Equal (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes((Join-Path $f.Scope.State $name)))) $historical[$name] "historical $name unchanged"}
  Equal $f.Keys 0 'continuation creates no key';Equal $f.New 0 'continuation creates no VHD';Equal $f.Initializes 0 'continuation never initializes'
  Reset-CollectionFixture;$f=$global:MediaFixture
  $f.Expiry=[DateTimeOffset]::Parse($f.Expiry).AddMinutes(-10).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Change-CollectBinding {param($b) $b.permitNetwork=$false;$b.expiresAt=$global:MediaFixture.Expiry}
  $collectedOnly=Collect-ContinuationFixture -WithoutNetwork
  Equal $collectedOnly.status 'NEW_MEDIA_COLLECTED_NOT_SSH_VERIFIED' 'explicit false network binding collects only'
  Equal $f.NetworkAdds 0 'collection-only binding creates no TCP22 rule'
  Equal $collectedOnly.collection.expiresAt $f.Expiry 'shorter execution lease accepts unchanged longer historical lease'
  Yes (-not(Test-Path -LiteralPath (Join-Path $f.Scope.State 'network-plan.json'))) 'collection-only writes no network plan'
  foreach($variant in @('WitnessHash','WitnessAlias','WitnessWriter','CollectHash','CollectAlias','CollectWriter','ResumeHash','ResumeSelector','CompletionHash','CompletionRun','CompletionAuth','CompletionOrigin','PreparedHash','AttemptHash','HistoricalAuth','HistoricalBundle','ExecutorBundle','ExecutionRef','ReusedHistoricalRef','ReusedOriginRef','NetworkMismatch','NetworkString','SchemaPath','Extended','Expired','NoUnmount')){
    Reset-CollectionFixture;$f=$global:MediaFixture;$witness=Join-Path $f.Scope.State 'origin-failure-witness-0f1b61b1.json'
    switch($variant){
      'WitnessHash' {[IO.File]::AppendAllText($witness,' ');$code='MEDIA_ORIGIN_HASH_DRIFT'}
      'WitnessAlias' {$f.AliasPath=$witness;$code='PATH_ALIAS'}
      'WitnessWriter' {$f.UntrustedPath=$witness;$code='OWNER_PATH_REQUIRED'}
      'CollectHash' {[IO.File]::AppendAllText($f.CollectBindingPath,' ');$code='MEDIA_ORIGIN_HASH_DRIFT'}
      'CollectAlias' {$f.AliasPath=$f.CollectBindingPath;$code='PATH_ALIAS'}
      'CollectWriter' {$f.UntrustedPath=$f.CollectBindingPath;$code='OWNER_PATH_REQUIRED'}
      'ResumeHash' {[IO.File]::AppendAllText($f.BindingPath,' ');$code='MEDIA_ORIGIN_HASH_DRIFT'}
      'ResumeSelector' {$f.BindingSha256=('f'*64);$code='MEDIA_COLLECT_SELECTION_INVALID'}
      'CompletionHash' {[IO.File]::AppendAllText((Join-Path $f.Scope.State 'resume-empty-mbr-completed.json'),' ');$code='MEDIA_ORIGIN_HASH_DRIFT'}
      'CompletionRun' {Change-CollectionCompletion {param($v) $v.runId=('f'*32)};$code='MEDIA_RESUME_COMPLETION_INVALID'}
      'CompletionAuth' {Change-CollectionCompletion {param($v) $v.authorizationRef='different-history'};$code='MEDIA_RECEIPT_SCOPE_INVALID'}
      'CompletionOrigin' {Change-CollectionCompletion {param($v) $v.origin.originBundleSha256=('f'*64)};$code='MEDIA_RESUME_COMPLETION_INVALID'}
      'PreparedHash' {[IO.File]::AppendAllText((Join-Path $f.Scope.State 'prepared.json'),' ');$code='MEDIA_ORIGIN_HASH_DRIFT'}
      'AttemptHash' {[IO.File]::AppendAllText((Join-Path $f.Scope.State 'resume-empty-mbr-attempt.json'),' ');$code='MEDIA_ORIGIN_HASH_DRIFT'}
      'HistoricalAuth' {
        Change-ResumeBinding {param($b) $b.authorizationRef='different-history'}
        $f.CollectionOrigin.resumeBindingSha256=$f.BindingSha256
        Change-CollectBinding {param($b) $b.resumeBindingSha256=$global:MediaFixture.BindingSha256};$code='MEDIA_RESUME_SCOPE_INVALID'
      }
      'HistoricalBundle' {Change-CollectBinding {param($b) $b.resumeBundleSha256=('f'*64)};$code='MEDIA_COLLECT_BINDING_SCOPE_INVALID'}
      'ExecutorBundle' {$f.CollectionBundle.sha256=('f'*64);$code='MEDIA_COLLECT_BINDING_SCOPE_INVALID'}
      'ExecutionRef' {Change-CollectBinding {param($b) $b.authorizationRef='different-executor'};$code='MEDIA_COLLECT_BINDING_SCOPE_INVALID'}
      'ReusedHistoricalRef' {$f.CollectionReference='fixture-owner';Change-CollectBinding {param($b) $b.authorizationRef='fixture-owner'};$code='MEDIA_COLLECT_BINDING_SCOPE_INVALID'}
      'ReusedOriginRef' {$f.CollectionReference=$f.Origin.authorizationRef;Change-CollectBinding {param($b) $b.authorizationRef=$global:MediaFixture.CollectionReference};$code='MEDIA_COLLECT_BINDING_SCOPE_INVALID'}
      'NetworkMismatch' {Change-CollectBinding {param($b) $b.permitNetwork=$false};$code='MEDIA_COLLECT_BINDING_SCOPE_INVALID'}
      'NetworkString' {Change-CollectBinding {param($b) $b.permitNetwork='true'};$code='MEDIA_COLLECT_BINDING_SCOPE_INVALID'}
      'SchemaPath' {Change-CollectBinding {param($b) $b|Add-Member -NotePropertyName failurePath -NotePropertyValue 'arbitrary'};$code='SCHEMA_INVALID'}
      'Extended' {$f.Expiry=[DateTimeOffset]::Parse($f.Expiry).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');Change-CollectBinding {param($b) $b.expiresAt=$global:MediaFixture.Expiry};$code='MEDIA_COLLECT_BINDING_SCOPE_INVALID'}
      'Expired' {$f.Expiry=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');Change-CollectBinding {param($b) $b.expiresAt=$global:MediaFixture.Expiry};$code='APPROVAL_EXPIRED_OR_TOO_LONG'}
      'NoUnmount' {$code='OWNER_OBSERVED_UNMOUNT_REQUIRED'}
    }
    Reject {Collect-ContinuationFixture -WithoutUnmount:($variant -eq 'NoUnmount')} $code
    Equal $f.Removes 0 "$variant continuation refuses before detach";Equal $f.NetworkAdds 0 "$variant no network change"
    Equal $f.Mounts 1 "$variant does not mount again after original resume"
  }
  foreach($forbiddenMode in @('Prepare','ResumeEmptyMbr')){
    Reset-CollectionFixture;$f=$global:MediaFixture
    Reject {Invoke-Ai09MediaOperation -Mode $forbiddenMode -LockedBundle $f.CollectionBundle -AuthorizationReference $f.CollectionReference -ExpiresAt $f.Expiry -CollectBindingPath $f.CollectBindingPath -CollectBindingSha256 $f.CollectBindingSha256} 'MEDIA_COLLECT_SELECTION_INVALID'
    Equal $f.Keys 0 "$forbiddenMode collection profile never generates keys";Equal $f.New 0 "$forbiddenMode collection profile never creates VHD";Equal $f.Removes 0 "$forbiddenMode no detach"
  }
  foreach($variant in @('StaleBaseline','EnrollmentExecutionRef','EnrollmentExpiry','ExitNonzero')){
    Reset-CollectionFixture;$f=$global:MediaFixture
    switch($variant){
      'StaleBaseline' {$path=Join-Path $f.Volume 'baseline.txt';$v=[IO.File]::ReadAllText($path);$v=$v -replace '"observedAt":"[^"]+"',('"observedAt":"'+[DateTimeOffset]::UtcNow.AddMinutes(-16).ToString('o')+'"');[IO.File]::WriteAllText($path,$v);$code='FRESH_GUEST_BASELINE_REQUIRED'}
      'EnrollmentExecutionRef' {$path=Join-Path $f.Volume 'enrollment.json';$v=Read-Ai09MediaJson $path;$v.authorizationRef=$f.CollectionReference;[IO.File]::WriteAllText($path,(Get-Ai09Json $v));$code='ENROLLMENT_NOT_CONFIRMED'}
      'EnrollmentExpiry' {$path=Join-Path $f.Volume 'enrollment.json';$v=Read-Ai09MediaJson $path;$v.expiresAt=[DateTimeOffset]::Parse($v.expiresAt).AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');[IO.File]::WriteAllText($path,(Get-Ai09Json $v));$code='ENROLLMENT_NOT_CONFIRMED'}
      'ExitNonzero' {[IO.File]::WriteAllText((Join-Path $f.Volume 'exit.txt'),'1');$code='GUEST_PROCESS_EXIT_NOT_SUCCESS'}
    }
    Reject {Collect-ContinuationFixture} $code
    Equal $f.NetworkAdds 0 "$variant preserves new-executor network guard";Equal $f.Removes 1 "$variant retains safely collected evidence";Yes (-not $f.HostMounted) "$variant leaves host unmounted"
  }
  Write-Output "AI09_MEDIA_LIFECYCLE_FIXTURES_PASS assertions=$script:Assertions SOURCE_ONLY no native mutation"
} finally {
  $resolved=[IO.Path]::GetFullPath($root)
  if($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'ai09-media-lifecycle-*'){
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
