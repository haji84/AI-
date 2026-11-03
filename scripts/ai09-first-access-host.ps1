[CmdletBinding()]
param([ValidateSet('Inspect','Apply','Rollback')][string]$Mode='Inspect',[string]$PlanPath,[string]$ExpectedPlanSha256,[string]$AuthorizationReference,[string]$JournalPath)
# SOURCE ONLY until separately approved: one fixed NIC TCP22 permit. No probes,
# elevation, credential, guest, service, VM state or other policy changes.
# A plan hash/reference must arrive from the owner-controlled approval channel;
# JSON is not an approval issuer. Owner-controlled paths and one authorized
# Hyper-V writer are required (native ACL APIs have no compare-and-swap).
# expiresAt is an execution deadline, NOT native rule expiry or scheduled revoke.
$ai09FirstArguments=@{}+$PSBoundParameters; $script:Ai09FirstSource=$PSCommandPath
$script:Ai09FirstDependency='1e7f2ca24588c3cde6fc7808d14783b0cce8fb88790f6eded73dd0ab79632a64'
$dependency=Join-Path $PSScriptRoot 'ai09-access-host.ps1'
$dependencyLock=[IO.File]::Open($dependency,'Open','Read','Read')
try {
  $hash=[Security.Cryptography.SHA256]::Create()
  try {$actual=([BitConverter]::ToString($hash.ComputeHash($dependencyLock))).Replace('-','').ToLowerInvariant()} finally {$hash.Dispose()}
  if ($actual -cne $script:Ai09FirstDependency) {throw 'DEPENDENCY_PIN_MISMATCH'}
  . $dependency
} finally {$dependencyLock.Dispose()}
function Assert-Ai09FirstNetworkReaders {
  foreach($pair in @(@('NetAdapter','Get-NetAdapter'),@('NetTCPIP','Get-NetIPAddress'))) {
    $root=Join-Path ([Environment]::GetFolderPath('Windows')) ('System32\WindowsPowerShell\v1.0\Modules\'+$pair[0])
    Import-Module -Name (Join-Path $root ($pair[0]+'.psd1')) -ErrorAction Stop
    $c=Get-Command ($pair[0]+'\'+$pair[1]) -ErrorAction Stop
    # Inbox CDXML networking readers are Functions, not binary Cmdlets.
    if ($c.CommandType -notin @('Cmdlet','Function') -or -not $c.Module.Path.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'NATIVE_NETWORK_READER_REQUIRED'}
  }
}
function Get-Ai09FirstNativeSnapshot {
  Assert-Ai09FirstNetworkReaders
  $vm=Hyper-V\Get-VM -Id '453b139b-cceb-446e-99fb-f45bf5895436' -ErrorAction Stop
  $nics=@(Hyper-V\Get-VMNetworkAdapter -VM $vm -ErrorAction Stop); if ($nics.Count -ne 1) {throw 'NIC_AMBIGUOUS'}; $nic=$nics[0]
  if ([string]$nic.VMId -ne '453b139b-cceb-446e-99fb-f45bf5895436') {throw 'VM_BINDING_UNAVAILABLE'}
  $switch=Hyper-V\Get-VMSwitch -Id $nic.SwitchId -ErrorAction Stop
  $management=@(Hyper-V\Get-VMNetworkAdapter -ManagementOS -ErrorAction Stop|Where-Object {$_.SwitchId -eq $nic.SwitchId})
  if ($management.Count -ne 1 -or [string]$management[0].MacAddress -cnotmatch '^[A-Fa-f0-9]{12}$') {throw 'HOST_INTERFACE_AMBIGUOUS'}
  $interfaces=@(NetAdapter\Get-NetAdapter -IncludeHidden -ErrorAction Stop|Where-Object {$mac=([string]$_.MacAddress).Replace('-','');$mac -cmatch '^[A-Fa-f0-9]{12}$' -and $mac -eq $management[0].MacAddress})
  if ($interfaces.Count -ne 1) {throw 'HOST_INTERFACE_AMBIGUOUS'}
  $addresses=@(NetTCPIP\Get-NetIPAddress -InterfaceIndex $interfaces[0].ifIndex -AddressFamily IPv4 -ErrorAction Stop|Where-Object {$_.AddressState -eq 'Preferred' -and (Test-Ai09Address $_.IPAddress)})
  if ($addresses.Count -ne 1 -or @($nic.IPAddresses).Count -gt 64) {throw 'ADDRESS_UNAVAILABLE_OR_AMBIGUOUS'}
  $drives=@(Hyper-V\Get-VMHardDiskDrive -VM $vm -ErrorAction Stop); if ($drives.Count -ne 1) {throw 'DISK_BINDING_UNAVAILABLE'}
  $disks=@($drives|ForEach-Object {$vhd=Hyper-V\Get-VHD -Path $_.Path -ErrorAction Stop; [pscustomobject][ordered]@{path=[string]$_.Path;controllerType=[string]$_.ControllerType;controllerNumber=[int]$_.ControllerNumber;controllerLocation=[int]$_.ControllerLocation;diskIdentifier=[string]$vhd.DiskIdentifier;parentPath=[string]$vhd.ParentPath;vhdType=[string]$vhd.VhdType;vhdFormat=[string]$vhd.VhdFormat;size=[long]$vhd.Size;fileSize=[long]$vhd.FileSize}})
  return [pscustomobject][ordered]@{hostName=[Environment]::MachineName;vmId=[string]$vm.Id;vmName=[string]$vm.Name;vmState=[string]$vm.State;generation=[int]$vm.Generation
    nic=[pscustomobject][ordered]@{id=[string]$nic.Id;name=[string]$nic.Name;mac=[string]$nic.MacAddress;switchId=[string]$nic.SwitchId;switchName=[string]$nic.SwitchName}
    switch=[pscustomobject][ordered]@{id=[string]$switch.Id;name=[string]$switch.Name;type=[string]$switch.SwitchType}
    hostAddress=[string]$addresses[0].IPAddress;guestAddress='172.27.140.254';guestAddressCandidates=@($nic.IPAddresses);hostInterfaceIndex=[int]$interfaces[0].ifIndex;hostPrefixLength=[int]$addresses[0].PrefixLength
    disks=$disks;acls=@(Hyper-V\Get-VMNetworkAdapterExtendedAcl -VMNetworkAdapter $nic -ErrorAction Stop)}
}
function Get-Ai09FirstCanonical($Raw) {
  if (@($Raw.guestAddressCandidates).Count -gt 64) {throw 'ADDRESS_BOUND'}
  foreach($candidate in $Raw.guestAddressCandidates) {
    $ip=$null
    if (-not [Net.IPAddress]::TryParse([string]$candidate,[ref]$ip)) {throw 'KVP_ADDRESS_INVALID'}
    if ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and [string]$candidate -cne '172.27.140.254') {throw 'CONTRADICTORY_KVP_ADDRESS'}
  }
  $state=ConvertTo-Ai09State $Raw
  if ($state.generation -ne 2 -or $state.hostAddress -cne '172.27.128.1' -or $state.guestAddress -cne '172.27.140.254' -or $state.hostPrefixLength -ne 20 -or $state.nic.id -cne 'Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D' -or $state.switch.id -cne 'c08cb7b8-9b3c-408e-8e30-5e16a3aeb444' -or $state.switch.name -cne 'Default Switch' -or $state.switch.type -cne 'Internal') {throw 'FIRST_ACCESS_BINDING_INVALID'}
  if ($state.disks.Count -ne 1) {throw 'DISK_BINDING_UNAVAILABLE'}; $d=$state.disks[0]
  if ($d.path -cne 'C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx' -or $d.diskIdentifier -cne '9D28872E-0087-4A33-ABFA-AE0DEF1E66B8' -or $d.parentPath -cne 'C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu.vhdx' -or $d.controllerType -cne 'SCSI' -or $d.controllerNumber -ne 0 -or $d.controllerLocation -ne 0 -or $d.vhdType -cne 'Differencing' -or $d.vhdFormat -cne 'VHDX' -or $d.size -ne 42949672960) {throw 'DISK_BINDING_UNAVAILABLE'}
  # Allocation changes while the VM runs. Retain disk identity/topology/capacity,
  # but never confuse ordinary AVHDX file growth with replacement/drift.
  $d.PSObject.Properties.Remove('fileSize')
  return $state
}
function New-Ai09FirstRule {
  return [ordered]@{Action='Allow';Direction='Inbound';Weight=201;LocalIPAddress='172.27.140.254/32';RemoteIPAddress='172.27.128.1/32';LocalPort='22';RemotePort='ANY';Protocol='TCP';Stateful=$true;IdleSessionTimeout=60;IsolationID=0}
}
function Get-Ai09FirstOriginalRules {
  $rows=@()
  foreach($direction in @('Inbound','Outbound')) {$rows+=@([ordered]@{Action='Deny';Direction=$direction;Weight=1;LocalIPAddress='ANY';RemoteIPAddress='ANY';LocalPort='ANY';RemotePort='ANY';Protocol='ANY';Stateful=$false;IdleSessionTimeout=0;IsolationID=0})}
  $rows+=@([ordered]@{Action='Allow';Direction='Outbound';Weight=200;LocalIPAddress='ANY';RemoteIPAddress='255.255.255.255';LocalPort='ANY';RemotePort='67';Protocol='UDP';Stateful=$false;IdleSessionTimeout=0;IsolationID=0})
  $rows+=@([ordered]@{Action='Allow';Direction='Inbound';Weight=200;LocalIPAddress='ANY';RemoteIPAddress='ANY';LocalPort='68';RemotePort='67';Protocol='UDP';Stateful=$false;IdleSessionTimeout=0;IsolationID=0})
  return $rows
}
function Get-Ai09FirstPolicyDigest($Rules) {
  [string[]]$rows=@($Rules|ForEach-Object {Get-Ai09Json $_}); [Array]::Sort($rows,[StringComparer]::Ordinal); return Get-Ai09Digest @($rows)
}
function Assert-Ai09FirstPolicy($State,[bool]$Permit) {
  $wanted=@(Get-Ai09FirstOriginalRules); if ($Permit) {$wanted+=@(New-Ai09FirstRule)}
  if ((Get-Ai09FirstPolicyDigest $State.acls) -cne (Get-Ai09FirstPolicyDigest $wanted)) {throw 'ORIGINAL_POLICY_DRIFT'}
}
function Get-Ai09FirstObserved {
  $state=Get-Ai09FirstCanonical (Get-Ai09FirstNativeSnapshot)
  if ([Text.Encoding]::UTF8.GetByteCount((Get-Ai09Json $state)) -gt 65536) {throw 'BASELINE_BOUND'}
  if (@($state.acls).Count -notin @(4,5)) {throw 'ORIGINAL_POLICY_DRIFT'}
  Assert-Ai09FirstPolicy $state (@($state.acls).Count -eq 5)
  return [ordered]@{status='OBSERVED_NETWORK_ONLY';version=1;issue=1219;profile='AI09_FIRST_ACCESS_TCP22_V1';candidateSource='OWNER_APPROVED_VM_NIC_ENDPOINT';guestAddressVerified=$false;authenticatedConnectionVerified=$false;activationReady=$false;nativeAutomaticRuleExpiry=$false;observedAt=(Get-Ai09UtcNow).ToString('o');baselineSha256=(Get-Ai09Digest $state);baseline=$state}
}
function Get-Ai09FirstPlan($Path,$Expected,$Reference,$Action) {
  if ($Expected -cnotmatch '^[a-f0-9]{64}$' -or $Reference -notmatch '^[A-Za-z0-9:/#._-]{1,240}$') {throw 'INDEPENDENT_APPROVAL_REQUIRED'}
  $path=Get-Ai09SafePath $Path; $s=[IO.File]::Open($path,'Open','Read','Read'); try {$bytes=Read-Ai09Bytes $s 16384} finally {$s.Dispose()}
  if ((Get-Ai09ShaBytes $bytes) -cne $Expected) {throw 'PLAN_PIN_MISMATCH'}
  $p=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes)|ConvertFrom-Json
  Assert-Ai09Fields $p @('version','issue','profile','action','hostName','vmId','nicMac','switchId','hostAddress','guestAddress','candidateSource','guestAddressVerified','guestEndpointPhotoSha256','expiresAt','baselineObservedAt','baselineSha256','authorizationRef','executorSha256','dependencySha256','permitPlanSha256','journalSha256')
  if ($p.version -ne 1 -or $p.issue -ne 1219 -or $p.profile -cne 'AI09_FIRST_ACCESS_TCP22_V1' -or $p.action -cne $Action -or $p.authorizationRef -cne $Reference -or $p.hostName -cne 'HAJI' -or $p.vmId -cne '453b139b-cceb-446e-99fb-f45bf5895436' -or $p.nicMac -cne '00155DDC2C00' -or $p.switchId -cne 'c08cb7b8-9b3c-408e-8e30-5e16a3aeb444' -or $p.hostAddress -cne '172.27.128.1' -or $p.guestAddress -cne '172.27.140.254' -or $p.candidateSource -cne 'OWNER_APPROVED_VM_NIC_ENDPOINT' -or $p.guestAddressVerified -isnot [bool] -or $p.guestAddressVerified -or $p.guestEndpointPhotoSha256 -cne '1ae8090f7b9c5e6a2a2d7f3cde1c7a1855824d4a4ea5703ec388b39a90de96f4' -or $p.baselineSha256 -cnotmatch '^[a-f0-9]{64}$') {throw 'PLAN_SCOPE_INVALID'}
  if ($p.dependencySha256 -cne $script:Ai09FirstDependency -or $p.executorSha256 -cne (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($script:Ai09FirstSource))) -or (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'ai09-access-host.ps1')))) -cne $script:Ai09FirstDependency) {throw 'SOURCE_PIN_MISMATCH'}
  if (($Action -eq 'Apply' -and ($p.permitPlanSha256 -cne '' -or $p.journalSha256 -cne '')) -or ($Action -eq 'Rollback' -and ($p.permitPlanSha256 -cnotmatch '^[a-f0-9]{64}$' -or $p.journalSha256 -cnotmatch '^[a-f0-9]{64}$'))) {throw 'RECOVERY_BINDING_INVALID'}
  Assert-Ai09PlanFresh $p; return $p
}
function Invoke-Ai09FirstAccessHost {
  param([ValidateSet('Inspect','Apply','Rollback')]$Mode='Inspect',$PlanPath,$ExpectedPlanSha256,$AuthorizationReference,$JournalPath)
  $ErrorActionPreference='Stop'; $journal=$null; $mutating=$false
  try {
    Assert-Ai09NativeAuthority
    if ($Mode -eq 'Inspect') {return Get-Ai09FirstObserved}
    $plan=Get-Ai09FirstPlan $PlanPath $ExpectedPlanSha256 $AuthorizationReference $Mode
    $path=Get-Ai09SafePath $JournalPath; $observed=Get-Ai09FirstObserved; $state=$observed.baseline; $rule=New-Ai09FirstRule
    if ($observed.baselineSha256 -cne $plan.baselineSha256) {throw 'BASELINE_DRIFT'}
    if ($Mode -eq 'Apply') {
      Assert-Ai09FirstPolicy $state $false
      $journal=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
      Write-Ai09Journal $journal ([ordered]@{status='PREPARED';version=1;issue=1219;profile='AI09_FIRST_ACCESS_TCP22_V1';planSha256=$ExpectedPlanSha256;authorizationRef=$AuthorizationReference;baseline=$state;rule=$rule;observedAt=$observed.observedAt})
      $expected=Get-Ai09Json $state|ConvertFrom-Json; $expected.acls=@($expected.acls)+@([pscustomobject]$rule)
      [string[]]$rows=@($expected.acls|ForEach-Object {Get-Ai09Json $_}); [Array]::Sort($rows,[StringComparer]::Ordinal)
      $expected.acls=@($rows|ForEach-Object {$_|ConvertFrom-Json})
      $wanted=Get-Ai09Digest $expected; $status='APPLIED_NETWORK_ONLY'
    } else {
      Assert-Ai09FirstPolicy $state $true
      $journal=[IO.File]::Open($path,'Open','ReadWrite','None'); $bytes=Read-Ai09Bytes $journal 131072
      if ((Get-Ai09ShaBytes $bytes) -cne $plan.journalSha256) {throw 'JOURNAL_PIN_MISMATCH'}
      $lines=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes).Split("`n")
      if ($lines.Count -gt 32 -or $lines[-1] -cne '') {throw 'JOURNAL_INVALID'}; $record=$lines[0]|ConvertFrom-Json
      Assert-Ai09Fields $record @('status','version','issue','profile','planSha256','authorizationRef','baseline','rule','observedAt')
      if ($record.status -cne 'PREPARED' -or $record.version -ne 1 -or $record.issue -ne 1219 -or $record.profile -cne 'AI09_FIRST_ACCESS_TCP22_V1' -or $record.planSha256 -cne $plan.permitPlanSha256 -or $record.authorizationRef -notmatch '^[A-Za-z0-9:/#._-]{1,240}$' -or (Get-Ai09Json $record.rule) -cne (Get-Ai09Json $rule)) {throw 'JOURNAL_BINDING_INVALID'}
      $before=$record.baseline; Assert-Ai09FirstPolicy $before $false
      $expected=Get-Ai09Json $state|ConvertFrom-Json; $expected.acls=@($expected.acls|Where-Object {-not ($_.Direction -ceq 'Inbound' -and $_.Weight -eq 201)})
      $wanted=Get-Ai09Digest $before
      if ((Get-Ai09Digest $expected) -cne $wanted) {throw 'ROLLBACK_STATE_DRIFT'}
      Write-Ai09Journal $journal ([ordered]@{status='ROLLBACK_PREPARED';recoveryPlanSha256=$ExpectedPlanSha256;authorizationRef=$AuthorizationReference;observedAt=$observed.observedAt})
      $status='ROLLED_BACK_NETWORK_ONLY'
    }
    if ((Get-Ai09FirstObserved).baselineSha256 -cne $observed.baselineSha256) {throw 'BASELINE_DRIFT'}
    Assert-Ai09PlanFresh $plan
    $mutating=$true
    if ($Mode -eq 'Apply') {$null=Add-Ai09NativeRule $state $rule} else {$null=Remove-Ai09NativeRule $state $rule}
    $after=Get-Ai09FirstObserved; if ($after.baselineSha256 -cne $wanted) {throw 'AFTER_STATE_UNCONFIRMED'}
    $receipt=[ordered]@{status=$status;version=1;issue=1219;profile='AI09_FIRST_ACCESS_TCP22_V1';planSha256=$ExpectedPlanSha256;authorizationRef=$AuthorizationReference;baselineSha256=$observed.baselineSha256;afterSha256=$after.baselineSha256;expiresAt=$plan.expiresAt;observedAt=$after.observedAt;candidateSource='OWNER_APPROVED_VM_NIC_ENDPOINT';guestAddressVerified=$false;authenticatedConnectionVerified=$false;activationReady=$false;nativeAutomaticRuleExpiry=$false}
    Write-Ai09Journal $journal $receipt; return $receipt
  } catch {
    $status='BLOCKED'; if ($mutating) {$status='UNCERTAIN'}
    $code=[string]$_.Exception.Message; if ($code -cnotmatch '^[A-Z][A-Z0-9_]{1,80}$') {$code='NATIVE_OR_IO_FAILURE'}
    $result=@{status=$status;code=$code;issue=1219;observedAt=(Get-Ai09UtcNow).ToString('o');guestAddressVerified=$false;authenticatedConnectionVerified=$false;activationReady=$false;nativeAutomaticRuleExpiry=$false}
    if ($journal) {try {Write-Ai09Journal $journal $result} catch {$result.journalWriteUnconfirmed=$true}}
    return $result
  } finally {if ($journal) {$journal.Dispose()}}
}
if ($MyInvocation.InvocationName -ne '.') {
  $result=Invoke-Ai09FirstAccessHost @ai09FirstArguments; $result|ConvertTo-Json -Depth 20
  if ($result.status -in @('OBSERVED_NETWORK_ONLY','APPLIED_NETWORK_ONLY','ROLLED_BACK_NETWORK_ONLY')) {exit 0} else {exit 1}
}
