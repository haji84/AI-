Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../scripts/ai09-first-access-host.ps1'
if (-not (Test-Path -LiteralPath $source)) {throw 'ASSERT:FIRST_ACCESS_EXECUTOR_MISSING'}
. $source
$script:NativeSnapshot=(Get-Command Get-Ai09FirstNativeSnapshot).ScriptBlock
$script:NativeAdd=(Get-Command Add-Ai09NativeRule).ScriptBlock
$script:NativeRemove=(Get-Command Remove-Ai09NativeRule).ScriptBlock
$script:Assertions=0
function Equal($Actual,$Expected,$Label) {$script:Assertions++; if ($Actual -cne $Expected) {throw "ASSERT:$Label expected=$Expected actual=$Actual"}}
function Yes($Value,$Label) {$script:Assertions++; if (-not $Value) {throw "ASSERT:$Label"}}
function Assert-Ai09NativeAuthority {}
function Assert-Ai09FirstNetworkReaders {}
function Assert-Ai09OwnerPath {param($Path)}
function Get-Ai09UtcNow {return $script:Clock}
function Get-Ai09FirstNativeSnapshot {
  $script:Reads++; if ($script:DuringRead -and $script:Reads -eq 2) {$script:State.acls[0].RemotePort='9'}
  if ($script:DuringExpiry -and $script:Reads -eq 2) {$script:Clock=$script:Clock.AddHours(25)}
  return ($script:State|ConvertTo-Json -Depth 20|ConvertFrom-Json)
}
function Add-Ai09NativeRule {param($State,$Rule)
  Yes ((Get-Item -LiteralPath $script:Journal).Length -gt 0) 'intent precedes mutation'
  $script:Adds++; if ($script:NoEffect) {return}; $script:State.acls=@($script:State.acls)+@($Rule)
  if ($script:FailAfterAdd) {throw 'FIXTURE_MUTATION_FAILURE'}
}
function Remove-Ai09NativeRule {param($State,$Rule)
  $script:Removes++; Equal $Rule.Weight 201 'only owned weight removed'
  $script:State.acls=@($script:State.acls|Where-Object {-not ($_.Direction -eq 'Inbound' -and $_.Weight -eq 201)})
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('ai09-first-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $root
function Reset-Fixture {
  $script:Clock=[DateTimeOffset]::UtcNow; $script:Reads=0; $script:Adds=0; $script:Removes=0
  $script:DuringRead=$false; $script:DuringExpiry=$false; $script:NoEffect=$false; $script:FailAfterAdd=$false
  $script:State=[ordered]@{hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';vmName='GORIQ-AI09-Ubuntu';vmState='Running';generation=2
    nic=[ordered]@{id='Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D';name='Network Adapter';mac='00155DDC2C00';switchId='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';switchName='Default Switch'}
    switch=[ordered]@{id='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';name='Default Switch';type='Internal'}
    hostAddress='172.27.128.1';guestAddress='172.27.140.254';guestAddressCandidates=@();hostInterfaceIndex=21;hostPrefixLength=20
    disks=@([ordered]@{path='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx';controllerType='SCSI';controllerNumber=0;controllerLocation=0;diskIdentifier='9D28872E-0087-4A33-ABFA-AE0DEF1E66B8';parentPath='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu.vhdx';vhdType='Differencing';vhdFormat='VHDX';size=42949672960;fileSize=32768})
    acls=@((Rule 'Deny' 'Inbound' 1),(Rule 'Deny' 'Outbound' 1),(Rule 'Allow' 'Outbound' 200 'ANY' '255.255.255.255' 'ANY' '67' 'UDP'),(Rule 'Allow' 'Inbound' 200 'ANY' 'ANY' '68' '67' 'UDP'))}
}
function Rule($Action,$Direction,$Weight,$Local='ANY',$Remote='ANY',$LocalPort='ANY',$RemotePort='ANY',$Protocol='ANY') {
  return [ordered]@{Action=$Action;Direction=$Direction;Weight=$Weight;LocalIPAddress=$Local;RemoteIPAddress=$Remote;LocalPort=$LocalPort;RemotePort=$RemotePort;Protocol=$Protocol;Stateful=$false;IdleSessionTimeout=0;IsolationID=0}
}
function Plan($Inspect,$Changes=@{},$Mode='Apply',$Permit='',$JournalSha='') {
  $p=[ordered]@{version=1;issue=1219;profile='AI09_FIRST_ACCESS_TCP22_V1';action=$Mode;hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';nicMac='00155DDC2C00';switchId='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';hostAddress='172.27.128.1';guestAddress='172.27.140.254';candidateSource='OWNER_APPROVED_VM_NIC_ENDPOINT';guestAddressVerified=$false;guestEndpointPhotoSha256='1ae8090f7b9c5e6a2a2d7f3cde1c7a1855824d4a4ea5703ec388b39a90de96f4';expiresAt=$script:Clock.AddMinutes(10).ToString('o');baselineObservedAt=$Inspect.observedAt;baselineSha256=$Inspect.baselineSha256;authorizationRef='fixture-owner-reference';executorSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();dependencySha256='1e7f2ca24588c3cde6fc7808d14783b0cce8fb88790f6eded73dd0ab79632a64';permitPlanSha256=$Permit;journalSha256=$JournalSha}
  foreach($k in $Changes.Keys) {$p[$k]=$Changes[$k]}
  $path=Join-Path $root ([guid]::NewGuid().ToString('N')+'.json')
  [IO.File]::WriteAllText($path,($p|ConvertTo-Json -Depth 20 -Compress),(New-Object Text.UTF8Encoding($false)))
  if ($Mode -eq 'Apply') {$script:Journal=Join-Path $root ([guid]::NewGuid().ToString('N')+'.journal')}
  return @{Mode=$Mode;PlanPath=$path;ExpectedPlanSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();AuthorizationReference='fixture-owner-reference';JournalPath=$script:Journal}
}
function Revoke($Permit) {return Plan (Invoke-Ai09FirstAccessHost) @{} 'Rollback' $Permit (Get-FileHash -LiteralPath $script:Journal -Algorithm SHA256).Hash.ToLowerInvariant()}
try {
  # Exercise the actual fixed native command adapters through named fake modules;
  # authority/provenance boundaries are disabled only in this fixture process.
  Reset-Fixture; $global:Ai09FirstNativeState=$script:State; $global:Ai09FirstNativeCalls=0
  $global:Ai09FirstManagementMac='001122334455'
  $global:Ai09FirstInterfaces=@(@{MacAddress=$null;ifIndex=98},@{MacAddress='';ifIndex=97},@{MacAddress='00-99-88-77-66-55';ifIndex=96},@{MacAddress='00-11-22-33-44-55';ifIndex=21})
  $null=New-Module -Name Hyper-V -ScriptBlock {
    function Get-VM {param($Id) return @{Id=$global:Ai09FirstNativeState.vmId;Name=$global:Ai09FirstNativeState.vmName;State='Running';Generation=2}}
    function Get-VMNetworkAdapter {param($VM,$VMName,[switch]$ManagementOS)
      $s=$global:Ai09FirstNativeState
      if ($ManagementOS) {return @{SwitchId=$s.nic.switchId;MacAddress=$global:Ai09FirstManagementMac}}
      return @{Id=$s.nic.id;VMId=$s.vmId;Name=$s.nic.name;MacAddress=$s.nic.mac;SwitchId=$s.nic.switchId;SwitchName=$s.nic.switchName;IPAddresses=$s.guestAddressCandidates}
    }
    function Get-VMSwitch {param($Id) $s=$global:Ai09FirstNativeState.switch; return @{Id=$s.id;Name=$s.name;SwitchType=$s.type}}
    function Get-VMHardDiskDrive {param($VM) $d=$global:Ai09FirstNativeState.disks[0]; return @{Path=$d.path;ControllerType=$d.controllerType;ControllerNumber=$d.controllerNumber;ControllerLocation=$d.controllerLocation}}
    function Get-VHD {param($Path) $d=$global:Ai09FirstNativeState.disks[0]; return @{DiskIdentifier=$d.diskIdentifier;ParentPath=$d.parentPath;VhdType=$d.vhdType;VhdFormat=$d.vhdFormat;Size=$d.size;FileSize=$d.fileSize}}
    function Get-VMNetworkAdapterExtendedAcl {param($VMNetworkAdapter) return @($global:Ai09FirstNativeState.acls|ForEach-Object {[pscustomobject]$_})}
    function Add-VMNetworkAdapterExtendedAcl {param($VMNetworkAdapter,$Action,$Direction,$LocalIPAddress,$RemoteIPAddress,$LocalPort,$RemotePort,$Protocol,$Weight,$Stateful,$IdleSessionTimeout,$IsolationID) $global:Ai09FirstNativeCalls++; $global:Ai09FirstNativeAdd=$PSBoundParameters}
    function Remove-VMNetworkAdapterExtendedAcl {param($VMNetworkAdapter,$Direction,$Weight,[switch]$Confirm) $global:Ai09FirstNativeCalls++; $global:Ai09FirstNativeRemove=$PSBoundParameters}
    Export-ModuleMember -Function *
  }|Import-Module -PassThru
  $null=New-Module -Name NetAdapter -ScriptBlock {function Get-NetAdapter {param([switch]$IncludeHidden) return $global:Ai09FirstInterfaces};Export-ModuleMember -Function *}|Import-Module -PassThru
  $null=New-Module -Name NetTCPIP -ScriptBlock {function Get-NetIPAddress {param($InterfaceIndex,$AddressFamily) return @{IPAddress='172.27.128.1';PrefixLength=20;AddressState='Preferred'}};Export-ModuleMember -Function *}|Import-Module -PassThru
  $native=& $script:NativeSnapshot; $native.hostName='HAJI'; $projected=Get-Ai09FirstCanonical $native
  Equal $projected.nic.mac '00155DDC2C00' 'actual adapter projects fixed NIC'; Equal $projected.disks[0].diskIdentifier '9D28872E-0087-4A33-ABFA-AE0DEF1E66B8' 'actual adapter projects disk identity'
  Equal $projected.acls.Count 4 'actual adapter retains complete policy'; Equal @($native.guestAddressCandidates).Count 0 'no KVP fallback assertion'
  Equal $projected.hostInterfaceIndex 21 'MAC-less hidden adapters do not displace the exact host interface'
  $savedInterfaces=$global:Ai09FirstInterfaces
  foreach($case in @('MissingManagement','EmptyManagement','MalformedManagement','Duplicate','MissingMatch')){
    $global:Ai09FirstInterfaces=$savedInterfaces;$global:Ai09FirstManagementMac='001122334455'
    switch($case){
      'MissingManagement' {$global:Ai09FirstManagementMac=$null}
      'EmptyManagement' {$global:Ai09FirstManagementMac=''}
      'MalformedManagement' {$global:Ai09FirstManagementMac='00112233445Z';$global:Ai09FirstInterfaces=@(@{MacAddress='00-11-22-33-44-5Z';ifIndex=21})}
      'Duplicate' {$global:Ai09FirstInterfaces=@($savedInterfaces)+@(@{MacAddress='00-11-22-33-44-55';ifIndex=22})}
      'MissingMatch' {$global:Ai09FirstInterfaces=@($savedInterfaces|Where-Object {$_.ifIndex -ne 21})}
    }
    try{& $script:NativeSnapshot|Out-Null;throw 'ASSERT:EXPECTED_INTERFACE_REFUSAL'}catch{Equal $_.Exception.Message 'HOST_INTERFACE_AMBIGUOUS' "native host interface refuses $case"}
  }
  $global:Ai09FirstInterfaces=$savedInterfaces;$global:Ai09FirstManagementMac='001122334455'
  $permit=New-Ai09FirstRule; & $script:NativeAdd $projected $permit
  Equal $global:Ai09FirstNativeAdd.VMNetworkAdapter.Id $script:State.nic.id 'native add bound adapter'; Equal $global:Ai09FirstNativeAdd.LocalIPAddress '172.27.140.254/32' 'native add target only'; Equal $global:Ai09FirstNativeAdd.RemoteIPAddress '172.27.128.1/32' 'native add source only'; Equal $global:Ai09FirstNativeAdd.Weight 201 'native fixed weight'
  & $script:NativeRemove $projected $permit
  Equal $global:Ai09FirstNativeRemove.VMNetworkAdapter.Id $script:State.nic.id 'native remove bound adapter'; Equal $global:Ai09FirstNativeRemove.Weight 201 'native remove exact weight'; Equal $global:Ai09FirstNativeCalls 2 'only two fake ACL mutations'
  Reset-Fixture
  $before=Invoke-Ai09FirstAccessHost
  Equal $before.status 'OBSERVED_NETWORK_ONLY' 'default inspection'; Equal $script:Adds 0 'no default mutation'
  Equal $before.authenticatedConnectionVerified $false 'not authentication'; Equal $before.guestAddressVerified $false 'candidate remains unverified'
  Equal $before.nativeAutomaticRuleExpiry $false 'no native TTL'; Equal $before.candidateSource 'OWNER_APPROVED_VM_NIC_ENDPOINT' 'honest endpoint source'
  $script:State.disks[0].fileSize=65536; Equal (Invoke-Ai09FirstAccessHost).baselineSha256 $before.baselineSha256 'ordinary running disk size is not identity drift'
  $args=Plan $before; $applied=Invoke-Ai09FirstAccessHost @args
  Equal $applied.status 'APPLIED_NETWORK_ONLY' ('exact apply '+($applied|ConvertTo-Json -Compress)); Equal $script:Adds 1 'one add'; Equal $script:State.acls.Count 5 'four original rules retained'
  $rule=$script:State.acls[4]; Equal $rule.Weight 201 'fixed permit weight'; Equal $rule.LocalIPAddress '172.27.140.254/32' 'guest only'; Equal $rule.RemoteIPAddress '172.27.128.1/32' 'host only'; Equal $rule.LocalPort '22' 'only SSH'; Equal $rule.Stateful $true 'stateful return traffic'
  Equal $applied.authenticatedConnectionVerified $false 'network success not authentication'; Equal $applied.activationReady $false 'network success not verifier readiness'
  Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' 'replay refused'
  $rollback=Revoke $args.ExpectedPlanSha256; Equal (Invoke-Ai09FirstAccessHost @rollback).status 'ROLLED_BACK_NETWORK_ONLY' 'exact rollback'; Equal $script:Removes 1 'one owned remove'; Equal (Invoke-Ai09FirstAccessHost).baselineSha256 $before.baselineSha256 'original policy restored'
  foreach($change in @(@{guestAddress='172.27.140.253'},@{hostAddress='172.27.128.2'},@{nicMac='001122334455'},@{switchId='other'},@{candidateSource='KVP'},@{guestAddressVerified=$true},@{guestEndpointPhotoSha256=('0'*64)},@{dependencySha256=('0'*64)},@{executorSha256=('0'*64)},@{expiresAt=$script:Clock.AddSeconds(-1).ToString('o')},@{expiresAt=$script:Clock.AddHours(25).ToString('o')},@{baselineObservedAt=$script:Clock.AddMinutes(-16).ToString('o')},@{extraAuthority='install'})) {
    Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost) $change
    Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' 'bad approval refused'; Equal $script:Adds 0 'bad approval no mutation'
  }
  foreach($drift in @('ACL','NIC','Disk','Host','KVP','Switch')) {
    Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost)
    switch($drift) {'ACL' {$script:State.acls[0].RemotePort='9'} 'NIC' {$script:State.nic.id='replaced'} 'Disk' {$script:State.disks[0].diskIdentifier='other'} 'Host' {$script:State.hostPrefixLength=24} 'KVP' {$script:State.guestAddressCandidates=@('172.27.140.253')} 'Switch' {$script:State.switch.id='other'}}
    Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' "native drift:$drift"; Equal $script:Adds 0 'drift no mutation'
  }
  Reset-Fixture; $script:State.guestAddressCandidates=@('172.27.140.254'); Equal (Invoke-Ai09FirstAccessHost).status 'OBSERVED_NETWORK_ONLY' 'matching KVP still not auth'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $script:Reads=0; $script:DuringRead=$true
  Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' 'immediate policy recheck'; Equal $script:Adds 0 'late drift no add'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $script:Reads=0; $script:DuringExpiry=$true
  Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' 'immediate expiry recheck'; Equal $script:Adds 0 'expired no add'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $args.ExpectedPlanSha256='0'*64; Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' 'external plan pin required'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $args.AuthorizationReference='other'; Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' 'owner reference required'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); [IO.File]::WriteAllText($script:Journal,'original evidence'); Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' 'create-only journal'; Equal ([IO.File]::ReadAllText($script:Journal)) 'original evidence' 'no evidence overwrite'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $script:FailAfterAdd=$true; Equal (Invoke-Ai09FirstAccessHost @args).status 'UNCERTAIN' 'uncertain mutation retained'; Yes ([IO.File]::ReadAllText($script:Journal) -match 'UNCERTAIN') 'uncertain persisted'
  $script:Clock=$script:Clock.AddHours(26); $rollback=Revoke $args.ExpectedPlanSha256
  Equal (Invoke-Ai09FirstAccessHost @rollback).status 'ROLLED_BACK_NETWORK_ONLY' 'fresh revoke authorization works after permit expiry'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $script:NoEffect=$true; Equal (Invoke-Ai09FirstAccessHost @args).status 'UNCERTAIN' 'no mutation is not success'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $null=Invoke-Ai09FirstAccessHost @args; $rollback=Revoke $args.ExpectedPlanSha256; $script:State.acls[0].RemotePort='9'
  Equal (Invoke-Ai09FirstAccessHost @rollback).status 'BLOCKED' 'unrelated rollback drift refused'; Equal $script:Removes 0 'never broad remove'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $null=Invoke-Ai09FirstAccessHost @args; $rollback=Revoke $args.ExpectedPlanSha256; [IO.File]::AppendAllText($script:Journal,'tampered')
  Equal (Invoke-Ai09FirstAccessHost @rollback).status 'BLOCKED' 'journal independently pinned'; Equal $script:Removes 0 'tampered journal no remove'
  Reset-Fixture; $args=Plan (Invoke-Ai09FirstAccessHost); $args.JournalPath=Join-Path $PSScriptRoot 'forbidden.journal'; Equal (Invoke-Ai09FirstAccessHost @args).status 'BLOCKED' 'workspace journal refused'
  Write-Output "AI09_FIRST_ACCESS_FIXTURES_PASS assertions=$script:Assertions : SOURCE_ONLY no native VM/network calls"
} finally {
  $resolved=[IO.Path]::GetFullPath($root)
  if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'ai09-first-fixture-*') {Remove-Item -LiteralPath $resolved -Recurse -Force}
}
