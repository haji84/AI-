Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/ai09-access-host.ps1')
$script:NativeSnapshot=(Get-Command Get-Ai09NativeSnapshot).ScriptBlock
$script:NativeAdd=(Get-Command Add-Ai09NativeRule).ScriptBlock
$script:NativeRemove=(Get-Command Remove-Ai09NativeRule).ScriptBlock
$script:Assertions=0
function Assert-Equal($Actual,$Expected,$Label) { $script:Assertions++; if ($Actual -cne $Expected) { throw "ASSERT:$Label expected=$Expected actual=$Actual" } }
function Assert-True($Value,$Label) { $script:Assertions++; if (-not $Value) { throw "ASSERT:$Label" } }
function Assert-Ai09NativeAuthority { }
function Assert-Ai09OwnerPath { param($Path) }
function Get-Ai09UtcNow { return $script:Clock }
function Get-Ai09NativeSnapshot {
  $script:Reads++; if($script:AdvanceDuringRead -and $script:Reads -eq 2){$script:Clock=$script:Clock.AddMinutes(20)}
  return ($script:State | ConvertTo-Json -Depth 20 | ConvertFrom-Json)
}
function Add-Ai09NativeRule { param($State,$Rule)
  Assert-True ((Get-Item -LiteralPath $script:ExpectedJournal).Length -gt 0) 'journal flushed before fixture mutation'
  $locked=$false; try{$probe=[IO.File]::Open($script:ExpectedJournal,'Open','Read','ReadWrite');$probe.Dispose()}catch{$locked=$true}
  Assert-True $locked 'journal exclusive during fixture mutation'
  if($script:NoChangeAfterAdd){$script:Adds++;return}
  $script:Adds++; $script:State.acls=@($script:State.acls)+@($Rule)
  if ($script:FailAfterAdd) { throw 'fixture_add_uncertain' }
}
function Remove-Ai09NativeRule { param($State,$Rule)
  $script:Removes++; $script:RemovedRule=$Rule
  $script:State.acls=@($script:State.acls | Where-Object { -not ($_.Direction -eq $Rule.Direction -and $_.Weight -eq $Rule.Weight) })
}
function Reset-Fixture {
  $script:Adds=0; $script:Removes=0; $script:FailAfterAdd=$false
  $script:NoChangeAfterAdd=$false
  $script:Clock=[DateTimeOffset]::UtcNow; $script:Reads=0; $script:AdvanceDuringRead=$false
  $script:State=[ordered]@{hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';vmName='GORIQ-AI09-Ubuntu';vmState='Running';generation=2
    nic=[ordered]@{id='fixture-nic';name='Network Adapter';mac='00155DDC2C00';switchId='fixture-switch';switchName='Default Switch'}
    switch=[ordered]@{id='fixture-switch';name='Default Switch';type='Internal'}
    hostAddress='192.168.50.1';guestAddress='192.168.50.9';hostInterfaceIndex=21;hostPrefixLength=24
    disks=@([ordered]@{path='fixture-os.vhdx';controllerType='SCSI';controllerNumber=0;controllerLocation=0;diskIdentifier='fixture-disk';parentPath='';vhdType='Dynamic';vhdFormat='VHDX';size=65536;fileSize=32768})
    acls=@([ordered]@{Action='Deny';Direction='Inbound';Weight=1;LocalIPAddress='ANY';RemoteIPAddress='ANY';LocalPort='ANY';RemotePort='ANY';Protocol='ANY';Stateful=$false;IdleSessionTimeout=0;IsolationID=0},
      [ordered]@{Action='Allow';Direction='Outbound';Weight=200;LocalIPAddress='ANY';RemoteIPAddress='ANY';LocalPort='ANY';RemotePort='67';Protocol='UDP';Stateful=$false;IdleSessionTimeout=0;IsolationID=0})}
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('ai09-host-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $root
function Write-Plan($Inspect,$Changes=@{}) {
  $plan=[ordered]@{version=1;issue=1219;expiresAt=[DateTime]::UtcNow.AddMinutes(10).ToString('o');hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';nicMac='00155DDC2C00';hostAddress='192.168.50.1';guestAddress='192.168.50.9';baselineSha256=$Inspect.baselineSha256;baselineObservedAt=$Inspect.observedAt;authorizationRef='fixture-owner-approval';executorSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '../scripts/ai09-access-host.ps1') -Algorithm SHA256).Hash.ToLowerInvariant()}
  foreach($key in $Changes.Keys){$plan[$key]=$Changes[$key]}
  $path=Join-Path $root ([guid]::NewGuid().ToString('N')+'.json')
  [IO.File]::WriteAllText($path,($plan|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
  $script:ExpectedJournal=Join-Path $root ([guid]::NewGuid().ToString('N')+'.journal')
  return @{Mode='Apply';PlanPath=$path;ExpectedPlanSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();AuthorizationReference='fixture-owner-approval';JournalPath=$script:ExpectedJournal}
}
try {
  # Manifest discovery reads only this temporary tree; it must never import it.
  Assert-True ([bool](Get-Command Get-Ai09HyperVManifest -CommandType Function -ErrorAction SilentlyContinue)) 'bounded native manifest resolver exists'
  $moduleRoot=Join-Path $root 'Hyper-V'; $versionRoot=Join-Path $moduleRoot '2.0.0.0'
  $null=New-Item -ItemType Directory -Path $versionRoot -Force
  $versionManifest=Join-Path $versionRoot 'Hyper-V.psd1'
  [IO.File]::WriteAllText($versionManifest,"throw 'MANIFEST_MUST_NOT_EXECUTE_IN_DISCOVERY'")
  Assert-Equal (Get-Ai09HyperVManifest $moduleRoot) $versionManifest 'standard versioned Windows manifest found without import'
  $otherRoot=Join-Path $moduleRoot 'untrusted-extra'; $null=New-Item -ItemType Directory -Path $otherRoot
  [IO.File]::WriteAllText((Join-Path $otherRoot 'Hyper-V.psd1'),"throw 'NOT_A_VERSIONED_MANIFEST'")
  Assert-Equal (Get-Ai09HyperVManifest $moduleRoot) $versionManifest 'arbitrary nested manifests are ignored'
  $legacyManifest=Join-Path $moduleRoot 'Hyper-V.psd1'; [IO.File]::WriteAllText($legacyManifest,'@{}')
  $refused=$false; try { $null=Get-Ai09HyperVManifest $moduleRoot } catch { $refused=$_.Exception.Message -eq 'HYPERV_MANIFEST_AMBIGUOUS' }
  Assert-True $refused 'multiple supported manifests fail closed'
  [IO.File]::Delete($versionManifest)
  Assert-Equal (Get-Ai09HyperVManifest $moduleRoot) $legacyManifest 'single unversioned distribution remains supported'
  [IO.File]::Delete($legacyManifest)
  $refused=$false; try { $null=Get-Ai09HyperVManifest $moduleRoot } catch { $refused=$_.Exception.Message -eq 'HYPERV_MANIFEST_UNAVAILABLE' }
  Assert-True $refused 'missing trusted manifest cannot fall back to PSModulePath'
  # Real snapshot projection through fake native-module boundaries, never Hyper-V.
  $null=New-Module -Name Hyper-V -ScriptBlock {
    function Get-VM { param($Id) return @{Id=$Id;Name='GORIQ-AI09-Ubuntu';State='Running';Generation=2} }
    function Get-VMNetworkAdapter { param($VM,$VMName,[switch]$ManagementOS)
      if($ManagementOS){return @{SwitchId='fixture-switch';MacAddress='001122334455'}}
      return @{Id='fixture-nic';VMId='453b139b-cceb-446e-99fb-f45bf5895436';Name='Network Adapter';MacAddress='00155DDC2C00';SwitchId='fixture-switch';SwitchName='Default Switch';IPAddresses=$global:Ai09FixtureGuestAddresses}
    }
    function Get-VMSwitch {param($Id) return @{Id=$Id;Name='Default Switch';SwitchType='Internal'}}
    function Get-VMHardDiskDrive {param($VM) return @{Path='fixture.vhdx';ControllerType='SCSI';ControllerNumber=0;ControllerLocation=0}}
    function Get-VHD {param($Path) return @{DiskIdentifier='fixture-disk';ParentPath='';VhdType='Dynamic';VhdFormat='VHDX';Size=65536;FileSize=32768}}
    function Get-VMNetworkAdapterExtendedAcl {param($VMNetworkAdapter) return [pscustomobject]@{Action='Deny';Direction='Inbound';Weight=1;LocalIPAddress='ANY';RemoteIPAddress='ANY';LocalPort='ANY';RemotePort='ANY';Protocol='ANY';Stateful=$false;IdleSessionTimeout=0;IsolationID=0}}
    function Add-VMNetworkAdapterExtendedAcl {param($VMNetworkAdapter,$Action,$Direction,$LocalIPAddress,$RemoteIPAddress,$LocalPort,$RemotePort,$Protocol,$Weight,$Stateful,$IdleSessionTimeout,$IsolationID) $global:Ai09FixtureAdd=$PSBoundParameters}
    function Remove-VMNetworkAdapterExtendedAcl {param($VMNetworkAdapter,$Direction,$Weight,[switch]$Confirm) $global:Ai09FixtureRemove=$PSBoundParameters}
    Export-ModuleMember -Function *
  } | Import-Module -PassThru
  $null=New-Module -Name NetAdapter -ScriptBlock {function Get-NetAdapter {param([switch]$IncludeHidden) return @{MacAddress='00-11-22-33-44-55';ifIndex=21}}; Export-ModuleMember -Function *} | Import-Module -PassThru
  $null=New-Module -Name NetTCPIP -ScriptBlock {function Get-NetIPAddress {param($InterfaceIndex,$AddressFamily) return $global:Ai09FixtureHostAddresses}; Export-ModuleMember -Function *} | Import-Module -PassThru
  $global:Ai09FixtureGuestAddresses=@('192.168.50.9')
  $global:Ai09FixtureHostAddresses=@(@{IPAddress='192.168.50.1';PrefixLength=24;AddressState='Preferred'})
  $native=& $script:NativeSnapshot; $native.hostName='HAJI'
  $projected=ConvertTo-Ai09State $native
  Assert-Equal $projected.disks[0].diskIdentifier 'fixture-disk' 'native disk projection'
  $nativeRule=New-Ai09Rule $projected
  & $script:NativeAdd $projected $nativeRule
  Assert-Equal $global:Ai09FixtureAdd.VMNetworkAdapter.Id 'fixture-nic' 'native exact adapter'
  Assert-Equal $global:Ai09FixtureAdd.LocalIPAddress '192.168.50.9/32' 'native guest destination'
  Assert-Equal $global:Ai09FixtureAdd.RemoteIPAddress '192.168.50.1/32' 'native host source'
  Assert-Equal $global:Ai09FixtureAdd.LocalPort '22' 'native only TCP22'
  Assert-Equal $global:Ai09FixtureAdd.Stateful $true 'native stateful'
  & $script:NativeRemove $projected $nativeRule
  Assert-Equal $global:Ai09FixtureRemove.VMNetworkAdapter.Id 'fixture-nic' 'native remove exact adapter'
  Assert-Equal $global:Ai09FixtureRemove.Direction 'Inbound' 'native exact direction'
  Assert-Equal $global:Ai09FixtureRemove.Weight 2 'native exact recorded weight'
  $global:Ai09FixtureGuestAddresses=@()
  $refused=''; try {$null=& $script:NativeSnapshot} catch {$refused=$_.Exception.Message}
  Assert-Equal $refused 'GUEST_ADDRESS_UNAVAILABLE_OR_AMBIGUOUS' 'native missing guest address is distinguished'
  $global:Ai09FixtureGuestAddresses=@('192.168.50.9')
  $global:Ai09FixtureHostAddresses=@()
  $refused=''; try {$null=& $script:NativeSnapshot} catch {$refused=$_.Exception.Message}
  Assert-Equal $refused 'HOST_ADDRESS_UNAVAILABLE_OR_AMBIGUOUS' 'native missing host address is distinguished'
  $global:Ai09FixtureHostAddresses=@(@{IPAddress='192.168.50.1';PrefixLength=24;AddressState='Preferred'})
  Reset-Fixture
  $inspect=Invoke-Ai09AccessHost
  Assert-Equal $inspect.status 'OBSERVED' 'inspect default'
  Assert-Equal $script:Adds 0 'inspect no add'; Assert-Equal $script:Removes 0 'inspect no remove'
  Assert-True ($inspect.baselineSha256 -match '^[a-f0-9]{64}$') 'baseline digest'
  $again=Invoke-Ai09AccessHost; Assert-Equal $again.baselineSha256 $inspect.baselineSha256 'canonical repeat'
  $script:State.acls=@($script:State.acls[1],$script:State.acls[0]); $again=Invoke-Ai09AccessHost
  Assert-Equal $again.baselineSha256 $inspect.baselineSha256 'canonical ACL order'

  $args=Write-Plan $inspect
  $applied=Invoke-Ai09AccessHost @args
  Assert-Equal $applied.status 'APPLIED' ('single scoped rule '+($applied|ConvertTo-Json -Compress))
  Assert-Equal $script:Adds 1 'one add'; Assert-Equal $script:State.acls.Count 3 'preserve originals'
  $rule=$script:State.acls[2]
  Assert-Equal $rule.LocalIPAddress '192.168.50.9/32' 'guest is local destination'
  Assert-Equal $rule.RemoteIPAddress '192.168.50.1/32' 'host is remote source'
  Assert-Equal $rule.LocalPort '22' 'only SSH'; Assert-Equal $rule.Direction 'Inbound' 'inbound only'
  Assert-Equal $rule.Protocol 'TCP' 'TCP only'; Assert-Equal $rule.Stateful $true 'stateful'
  Assert-Equal $rule.Weight 201 'weight above existing'; Assert-Equal $applied.planSha256 $args.ExpectedPlanSha256 'receipt binding'
  foreach($key in @('hostName','vmId','nicMac','hostAddress','guestAddress','expiresAt','baselineSha256','afterSha256','observedAt')) { Assert-True ($null -ne $applied.$key) "receipt:$key" }
  $journal=[IO.File]::ReadAllText($args.JournalPath)
  Assert-True ($journal -match 'PREPARED' -and $journal -match 'APPLIED') 'durable mutation evidence'
  $replayed=Invoke-Ai09AccessHost @args; Assert-Equal $replayed.status 'BLOCKED' 'replay refused'; Assert-Equal $script:Adds 1 'replay no add'
  $args.Mode='Rollback'; $rolled=Invoke-Ai09AccessHost @args
  Assert-Equal $rolled.status 'ROLLED_BACK' 'rollback verified'; Assert-Equal $script:Removes 1 'one remove'
  Assert-Equal $rolled.afterSha256 $inspect.baselineSha256 'exact original baseline'
  Assert-Equal $script:RemovedRule.Weight 201 'remove recorded weight only'

  foreach($changes in @(@{expiresAt=[DateTime]::UtcNow.AddSeconds(-1).ToString('o')},@{baselineObservedAt=[DateTime]::UtcNow.AddMinutes(-16).ToString('o')},@{executorSha256=('0'*64)},@{hostAddress='10.0.0.2'},@{nicMac='001122334455'},@{extraAuthority='install'})) {
    Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost) $changes
    Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'invalid plan refused'
    Assert-Equal $script:Adds 0 'invalid no add'; Assert-True (-not (Test-Path -LiteralPath $args.JournalPath)) 'invalid no journal'
  }
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $args.ExpectedPlanSha256='0'*64
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'pin mismatch'; Assert-Equal $script:Adds 0 'pin no effect'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $args.AuthorizationReference='different'
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'owner ref mismatch'; Assert-Equal $script:Adds 0 'owner no effect'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $script:State.acls[0].RemotePort='9'
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'complete ACL drift'; Assert-Equal $script:Adds 0 'drift no effect'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $script:State.nic.id='replaced-nic'
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'same MAC different NIC'; Assert-Equal $script:Adds 0 'replacement no effect'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); [IO.File]::WriteAllText($args.JournalPath,'existing evidence')
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'exclusive journal'; Assert-Equal ([IO.File]::ReadAllText($args.JournalPath)) 'existing evidence' 'never overwrite'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $script:FailAfterAdd=$true
  $uncertain=Invoke-Ai09AccessHost @args; Assert-Equal $uncertain.status 'UNCERTAIN' 'mutation failure explicit'
  Assert-True ([IO.File]::ReadAllText($args.JournalPath) -match 'UNCERTAIN') 'uncertain retained'
  $args.Mode='Rollback'; Assert-Equal (Invoke-Ai09AccessHost @args).status 'ROLLED_BACK' 'rollback uncertain exact delta'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $null=Invoke-Ai09AccessHost @args
  $script:State.acls[2].RemoteIPAddress='192.168.50.2/32'; $args.Mode='Rollback'
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'rollback changed rule'; Assert-Equal $script:Removes 0 'no blanket remove'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $args.JournalPath=Join-Path $PSScriptRoot 'forbidden.journal'
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'journal outside workspace'; Assert-Equal $script:Adds 0 'path no effect'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $script:Reads=0; $script:AdvanceDuringRead=$true
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'expiry during baseline reads'
  Assert-Equal $script:Adds 0 'no mutation after expiry'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost)
  # Remove a key to model unsupported native-provider projection.
  $script:State.acls[0].Remove('IsolationID')
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'missing policy property'
  Assert-Equal $script:Adds 0 'unknown projection no effect'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $script:State.disks[0].diskIdentifier=''
  Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' 'unavailable disk identity'; Assert-Equal $script:Adds 0 'unbound disk no effect'
  Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $script:NoChangeAfterAdd=$true
  Assert-Equal (Invoke-Ai09AccessHost @args).code 'AFTER_STATE_UNCONFIRMED' 'successful call without effect is not acceptance'
  Assert-Equal $script:Removes 0 'uncertain postcondition no broad recovery'
  foreach($field in @('planSha256','authorizationRef')) {
    Reset-Fixture; $args=Write-Plan (Invoke-Ai09AccessHost); $null=Invoke-Ai09AccessHost @args
    $lines=[IO.File]::ReadAllLines($args.JournalPath); $record=$lines[0]|ConvertFrom-Json; $record.$field='substituted'
    $lines[0]=$record|ConvertTo-Json -Depth 20 -Compress; [IO.File]::WriteAllLines($args.JournalPath,$lines,(New-Object Text.UTF8Encoding($false)))
    $args.Mode='Rollback'; Assert-Equal (Invoke-Ai09AccessHost @args).status 'BLOCKED' "journal provenance:$field"
    Assert-Equal $script:Removes 0 'tampered journal no remove'
  }
  Write-Output "AI09_HOST_FIXTURES_PASS assertions=$script:Assertions : source-only Inspect, pin/scope/freshness/identity, exact Apply, journal, uncertain and Rollback"
} finally {
  if ([IO.Path]::GetFullPath($root).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $root -Leaf) -like 'ai09-host-fixture-*') { Remove-Item -LiteralPath $root -Recurse -Force }
}
