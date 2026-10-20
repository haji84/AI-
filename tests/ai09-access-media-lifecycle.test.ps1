# Filesystem fixtures and fake named modules only; never native Hyper-V, keys or ACLs.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/ai09-first-access-host.ps1')
. (Join-Path $PSScriptRoot '../scripts/ai09-access-media.ps1')
$script:RealMediaSnapshot=(Get-Command Get-Ai09MediaNativeSnapshot).ScriptBlock
$script:RealLease=(Get-Command Assert-Ai09MediaLease).ScriptBlock
$script:Assertions=0
function Yes($Value,$Label){$script:Assertions++;if(-not $Value){throw "ASSERT:$Label"}}
function Equal($Actual,$Expected,$Label){Yes ($Actual -ceq $Expected) "$Label expected=$Expected actual=$Actual"}
function Reject($Action,$Code){try{& $Action|Out-Null;throw 'ASSERT:EXPECTED_REFUSAL'}catch{Equal $_.Exception.Message $Code 'expected refusal'}}
function Assert-Ai09NativeAuthority {}
function Assert-Ai09FirstNetworkReaders {}
function Assert-Ai09OwnerPath {param($Path)}
function Get-Ai09SafePath {param($Path) return $Path}
function Get-Ai09MediaScope {return $global:MediaFixture.Scope}
function New-Ai09PrivateDirectory {param($Path) $null=[IO.Directory]::CreateDirectory($Path)}
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
  $null=Assert-Ai09MediaVhd $Record $true
  $d=Storage\Get-Disk -Number $Record.diskNumber
  if($Raw){return $d}
  return @{disk=$d;partition=[pscustomobject]@{DriveLetter='X';DiskNumber=7;PartitionNumber=1};root=$global:MediaFixture.Volume}
}
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
    New=0;Mounts=0;Dismounts=0;Adds=0;Removes=0;Formats=0;Keys=0;Reads=0;DriftAt=-1;NetworkAdds=0
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
      return @{Path=$Path;DiskIdentifier='fixture-vhd-id';Size=256MB;VhdType='Dynamic';VhdFormat='VHDX';ParentPath='';Attached=$f.HostMounted;DiskNumber=7}
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
      $f.Removes++;$f.GuestAttached=$false
    }
    Export-ModuleMember -Function *
  }|Import-Module -PassThru
  $null=New-Module -Name Storage -ScriptBlock {
    function Get-Volume {return @()}
    function Get-Disk {param($Number)
      $f=$global:MediaFixture;if($Number -ne 7){throw 'UNEXPECTED_DISK'}
      return @{Number=7;UniqueId='fixture-disk-id';Size=256MB;IsBoot=$false;IsSystem=$false;IsOffline=$false;PartitionStyle=$f.Style;Signature=$f.Signature;IsReadOnly=$f.ReadOnly}
    }
    function Initialize-Disk {param($Number,$PartitionStyle)
      $f=$global:MediaFixture;if($Number -ne 7 -or $PartitionStyle -cne 'MBR' -or $f.Style -cne 'RAW'){throw 'UNEXPECTED_INITIALIZE'}
      $f.Style='MBR'
    }
    function Get-Partition {param($DiskNumber)
      if($global:MediaFixture.Partitions){return @{DiskNumber=7;PartitionNumber=1;DriveLetter='X'}}
      return @()
    }
    function New-Partition {param($DiskNumber,[switch]$UseMaximumSize,[switch]$AssignDriveLetter)
      if($DiskNumber -ne 7 -or -not $UseMaximumSize -or -not $AssignDriveLetter){throw 'UNEXPECTED_PARTITION'}
      $global:MediaFixture.Partitions=1;return @{DiskNumber=7;PartitionNumber=1;DriveLetter='X'}
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
  Write-Output "AI09_MEDIA_LIFECYCLE_FIXTURES_PASS assertions=$script:Assertions SOURCE_ONLY no native mutation"
} finally {
  $resolved=[IO.Path]::GetFullPath($root)
  if($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'ai09-media-lifecycle-*'){
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
