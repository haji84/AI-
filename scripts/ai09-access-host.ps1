[CmdletBinding()]
param([ValidateSet('Inspect','BootstrapInspect','Apply','Rollback')][string]$Mode='Inspect',[string]$PlanPath,[string]$ExpectedPlanSha256,[string]$AuthorizationReference,[string]$JournalPath)
# No installation/elevation, keys, service operations, VM changes or IP probes.
# Approval reference and independent plan SHA must arrive through the owner-approved
# control path. A JSON file alone does not authenticate an owner or grant authority.
# Requires owner-controlled ancestor directories and a single authorized Hyper-V
# writer during the transaction: native ACL cmdlets provide no compare-and-swap.
# Rollback also refuses expired/stale approval; a fresh recovery authorization is
# required outside the 15-minute window. No implicit post-expiry permission exists.
$script:Ai09Source=$PSCommandPath
$script:Ai09Workspace=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
function Get-Ai09UtcNow { return [DateTimeOffset]::UtcNow }
function Get-Ai09Json($Value) { return (ConvertTo-Json -InputObject $Value -Depth 20 -Compress) }
function Get-Ai09ShaBytes([byte[]]$Bytes) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Get-Ai09Digest($Value) { return Get-Ai09ShaBytes ([Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $Value))) }
function Assert-Ai09Fields($Value,[string[]]$Names) {
  if ($null -eq $Value -or @($Value.PSObject.Properties).Count -ne $Names.Count) { throw 'SCHEMA_INVALID' }
  foreach($name in $Names) { if ($null -eq $Value.PSObject.Properties[$name]) { throw 'SCHEMA_INVALID' } }
}
function Test-Ai09Address([string]$Value) {
  if ($Value -notmatch '^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$') { return $false }
  $parts=@($Value.Split('.') | ForEach-Object { [int]$_ }); if (@($parts | Where-Object {$_ -gt 255}).Count) { return $false }
  return ($parts[0] -eq 10 -or ($parts[0] -eq 172 -and $parts[1] -ge 16 -and $parts[1] -le 31) -or ($parts[0] -eq 192 -and $parts[1] -eq 168))
}
function Get-Ai09HyperVManifest([string]$Root) {
  # The caller fixes System32's Hyper-V directory. Never resolve a module name
  # through PSModulePath or recursively discover arbitrary manifest locations.
  if (-not [IO.Path]::IsPathRooted($Root) -or -not (Test-Path -LiteralPath $Root -PathType Container)) { throw 'HYPERV_MANIFEST_UNAVAILABLE' }
  $rootItem=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'HYPERV_MANIFEST_ALIAS' }
  $children=@(Get-ChildItem -LiteralPath $Root -Directory -Force -ErrorAction Stop)
  if ($children.Count -gt 64) { throw 'HYPERV_MANIFEST_BOUND' }
  $directories=@($rootItem)+@($children | Where-Object {$_.Name -cmatch '^\d+\.\d+(\.\d+){0,2}$'})
  $manifests=@()
  foreach($directory in $directories) {
    if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'HYPERV_MANIFEST_ALIAS' }
    $candidate=Join-Path $directory.FullName 'Hyper-V.psd1'
    if (Test-Path -LiteralPath $candidate) {
      $item=Get-Item -LiteralPath $candidate -Force -ErrorAction Stop
      if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'HYPERV_MANIFEST_ALIAS' }
      $manifests+=($item.FullName)
    }
  }
  if ($manifests.Count -eq 0) { throw 'HYPERV_MANIFEST_UNAVAILABLE' }
  if ($manifests.Count -ne 1) { throw 'HYPERV_MANIFEST_AMBIGUOUS' }
  return $manifests[0]
}
function Assert-Ai09NativeAuthority {
  if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or [Environment]::MachineName -cne 'HAJI') { throw 'NATIVE_HOST_REQUIRED' }
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMIN_REQUIRED' }
  $module=Get-Ai09HyperVManifest (Join-Path ([Environment]::GetFolderPath('Windows')) 'System32/WindowsPowerShell/v1.0/Modules/Hyper-V')
  Import-Module -Name $module -ErrorAction Stop
  foreach($command in @('Get-VM','Get-VMNetworkAdapter','Get-VMNetworkAdapterExtendedAcl','Add-VMNetworkAdapterExtendedAcl','Remove-VMNetworkAdapterExtendedAcl','Get-VMSwitch','Get-VMHardDiskDrive','Get-VHD')) {
    $found=Get-Command -Name "Hyper-V\$command" -CommandType Cmdlet -ErrorAction Stop
    if (-not $found.Module.Path.StartsWith((Split-Path $module -Parent),[StringComparison]::OrdinalIgnoreCase)) { throw 'NATIVE_HYPERV_REQUIRED' }
  }
}
function Assert-Ai09OwnerPath([string]$Path) {
  $acl=Get-Acl -LiteralPath $Path -ErrorAction Stop
  $allowed=@('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  $owner=(New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin $allowed) { throw 'OWNER_PATH_REQUIRED' }
  $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach($ace in $acl.Access) {
    if ($ace.AccessControlType -eq 'Allow' -and ($ace.FileSystemRights -band $write) -and $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'OWNER_PATH_REQUIRED' }
  }
}
function Get-Ai09SafePath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path) -or $Path -match '^[\\/]{2}|[\x00-\x1f]') { throw 'PATH_INVALID' }
  $full=[IO.Path]::GetFullPath($Path)
  if ($full.Substring([IO.Path]::GetPathRoot($full).Length).Contains(':')) { throw 'PATH_ALIAS' }
  if ($full -cne $Path -or $full -eq $script:Ai09Workspace -or $full.StartsWith($script:Ai09Workspace+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'EXTERNAL_PATH_REQUIRED' }
  $parent=[IO.Path]::GetDirectoryName($full); if (-not [IO.Directory]::Exists($parent)) { throw 'PARENT_REQUIRED' }
  for($cursor=$full;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)) {
    if (Test-Path -LiteralPath $cursor) {
      $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PATH_ALIAS' }
      if ($item.PSObject.Properties['LinkType'] -and $item.LinkType) { throw 'PATH_ALIAS' }
    }
    if ([IO.Path]::GetPathRoot($cursor) -eq $cursor) { break }
  }
  Assert-Ai09OwnerPath $parent
  if (Test-Path -LiteralPath $full) { Assert-Ai09OwnerPath $full }
  return $full
}
function Read-Ai09Bytes($Stream,[int]$Limit) {
  if ($Stream.Length -lt 1 -or $Stream.Length -gt $Limit) { throw 'FILE_BOUND' }
  $bytes=New-Object byte[] ([int]$Stream.Length); $offset=0
  while($offset -lt $bytes.Length) { $n=$Stream.Read($bytes,$offset,$bytes.Length-$offset); if ($n -le 0) { throw 'FILE_CHANGED' }; $offset+=$n }
  return ,$bytes
}
function Get-Ai09NativeSnapshot {
  $vm=Hyper-V\Get-VM -Id '453b139b-cceb-446e-99fb-f45bf5895436' -ErrorAction Stop
  $nics=@(Hyper-V\Get-VMNetworkAdapter -VM $vm -ErrorAction Stop); if ($nics.Count -ne 1) { throw 'NIC_AMBIGUOUS' }; $nic=$nics[0]
  $switch=Hyper-V\Get-VMSwitch -Id $nic.SwitchId -ErrorAction Stop
  $management=@(Hyper-V\Get-VMNetworkAdapter -ManagementOS -ErrorAction Stop | Where-Object {$_.SwitchId -eq $nic.SwitchId})
  if ($management.Count -ne 1) { throw 'HOST_INTERFACE_AMBIGUOUS' }
  $interfaces=@(NetAdapter\Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { $_.MacAddress.Replace('-','') -eq $management[0].MacAddress })
  if ($interfaces.Count -ne 1) { throw 'HOST_INTERFACE_AMBIGUOUS' }
  $addresses=@(NetTCPIP\Get-NetIPAddress -InterfaceIndex $interfaces[0].ifIndex -AddressFamily IPv4 -ErrorAction Stop | Where-Object {$_.AddressState -eq 'Preferred' -and (Test-Ai09Address $_.IPAddress)})
  $guest=@($nic.IPAddresses | Where-Object {Test-Ai09Address $_})
  if ($addresses.Count -ne 1) { throw 'HOST_ADDRESS_UNAVAILABLE_OR_AMBIGUOUS' }
  if ($guest.Count -ne 1) { throw 'GUEST_ADDRESS_UNAVAILABLE_OR_AMBIGUOUS' }
  $disks=@(Hyper-V\Get-VMHardDiskDrive -VM $vm -ErrorAction Stop | ForEach-Object {
    $vhd=Hyper-V\Get-VHD -Path $_.Path -ErrorAction Stop
    [pscustomobject][ordered]@{path=[string]$_.Path;controllerType=[string]$_.ControllerType;controllerNumber=[int]$_.ControllerNumber;controllerLocation=[int]$_.ControllerLocation;diskIdentifier=[string]$vhd.DiskIdentifier;parentPath=[string]$vhd.ParentPath;vhdType=[string]$vhd.VhdType;vhdFormat=[string]$vhd.VhdFormat;size=[long]$vhd.Size;fileSize=[long]$vhd.FileSize}
  })
  return [pscustomobject][ordered]@{hostName=[Environment]::MachineName;vmId=[string]$vm.Id;vmName=[string]$vm.Name;vmState=[string]$vm.State;generation=[int]$vm.Generation
    nic=[pscustomobject][ordered]@{id=[string]$nic.Id;name=[string]$nic.Name;mac=[string]$nic.MacAddress;switchId=[string]$nic.SwitchId;switchName=[string]$nic.SwitchName}
    switch=[pscustomobject][ordered]@{id=[string]$switch.Id;name=[string]$switch.Name;type=[string]$switch.SwitchType}
    hostAddress=[string]$addresses[0].IPAddress;guestAddress=[string]$guest[0];hostInterfaceIndex=[int]$interfaces[0].ifIndex;hostPrefixLength=[int]$addresses[0].PrefixLength
    disks=$disks;acls=@(Hyper-V\Get-VMNetworkAdapterExtendedAcl -VMNetworkAdapter $nic -ErrorAction Stop)}
}
function ConvertTo-Ai09State($Raw) {
  if ($Raw.hostName -cne 'HAJI' -or $Raw.vmId -cne '453b139b-cceb-446e-99fb-f45bf5895436' -or $Raw.vmName -cne 'GORIQ-AI09-Ubuntu' -or $Raw.nic.mac -cne '00155DDC2C00' -or $Raw.vmState -ne 'Running') { throw 'VM_BINDING_UNAVAILABLE' }
  if (-not (Test-Ai09Address $Raw.hostAddress) -or -not (Test-Ai09Address $Raw.guestAddress) -or $Raw.hostAddress -eq $Raw.guestAddress -or $Raw.nic.switchId -ne $Raw.switch.id -or $Raw.nic.switchName -ne $Raw.switch.name) { throw 'NETWORK_BINDING_UNAVAILABLE' }
  foreach($value in @($Raw.nic.id,$Raw.nic.name,$Raw.nic.switchId,$Raw.switch.id,$Raw.switch.name,$Raw.switch.type)) {
    if ([string]::IsNullOrWhiteSpace([string]$value) -or ([string]$value).Length -gt 256) {throw 'NETWORK_BINDING_UNAVAILABLE'}
  }
  if ($Raw.generation -notin @(1,2) -or $Raw.hostInterfaceIndex -lt 1 -or $Raw.hostPrefixLength -lt 1 -or $Raw.hostPrefixLength -gt 32) {throw 'NETWORK_BINDING_UNAVAILABLE'}
  $rules=@(); if (@($Raw.acls).Count -gt 128) { throw 'ACL_BOUND' }
  foreach($r in $Raw.acls) {
    foreach($property in @('Action','Direction','Weight','LocalIPAddress','RemoteIPAddress','LocalPort','RemotePort','Protocol','Stateful','IdleSessionTimeout','IsolationID')) {
      if ($null -eq $r.PSObject.Properties[$property] -or ([string]$r.$property).Length -gt 256) { throw 'ACL_PROJECTION_UNAVAILABLE' }
    }
    if ([int]$r.Weight -lt 0 -or $r.Stateful -isnot [bool]) { throw 'ACL_PROJECTION_UNAVAILABLE' }
    $rules+=Get-Ai09Json ([ordered]@{Action=[string]$r.Action;Direction=[string]$r.Direction;Weight=[int]$r.Weight;LocalIPAddress=[string]$r.LocalIPAddress;RemoteIPAddress=[string]$r.RemoteIPAddress;LocalPort=[string]$r.LocalPort;RemotePort=[string]$r.RemotePort;Protocol=[string]$r.Protocol;Stateful=[bool]$r.Stateful;IdleSessionTimeout=[int]$r.IdleSessionTimeout;IsolationID=[int]$r.IsolationID})
  }
  [string[]]$orderedRules=$rules; [Array]::Sort($orderedRules,[StringComparer]::Ordinal)
  $disks=@(); if (@($Raw.disks).Count -lt 1 -or @($Raw.disks).Count -gt 8) { throw 'DISK_BOUND' }
  foreach($d in $Raw.disks) {
    $row=[ordered]@{}; foreach($key in @('path','controllerType','controllerNumber','controllerLocation','diskIdentifier','parentPath','vhdType','vhdFormat','size','fileSize')) {
      if ($null -eq $d.PSObject.Properties[$key] -or ([string]$d.$key).Length -gt 1024) { throw 'DISK_PROJECTION_UNAVAILABLE' }; $row[$key]=$d.$key
    }
    foreach($key in @('path','diskIdentifier','controllerType','vhdType','vhdFormat')) {if ([string]::IsNullOrWhiteSpace([string]$row[$key])) {throw 'DISK_PROJECTION_UNAVAILABLE'}}
    if ($row.size -lt 1 -or $row.fileSize -lt 1) {throw 'DISK_PROJECTION_UNAVAILABLE'}
    $disks+=Get-Ai09Json $row
  }
  [string[]]$orderedDisks=$disks; [Array]::Sort($orderedDisks,[StringComparer]::Ordinal)
  return [ordered]@{hostName=$Raw.hostName;vmId=$Raw.vmId;vmName=$Raw.vmName;vmState=$Raw.vmState;generation=[int]$Raw.generation
    nic=[ordered]@{id=[string]$Raw.nic.id;name=[string]$Raw.nic.name;mac=[string]$Raw.nic.mac;switchId=[string]$Raw.nic.switchId;switchName=[string]$Raw.nic.switchName}
    switch=[ordered]@{id=[string]$Raw.switch.id;name=[string]$Raw.switch.name;type=[string]$Raw.switch.type}
    hostAddress=$Raw.hostAddress;guestAddress=$Raw.guestAddress;hostInterfaceIndex=[int]$Raw.hostInterfaceIndex;hostPrefixLength=[int]$Raw.hostPrefixLength
    disks=@($orderedDisks | ForEach-Object {$_|ConvertFrom-Json});acls=@($orderedRules | ForEach-Object {$_|ConvertFrom-Json})}
}
function Get-Ai09Observed {
  $state=ConvertTo-Ai09State (Get-Ai09NativeSnapshot)
  if ([Text.Encoding]::UTF8.GetByteCount((Get-Ai09Json $state)) -gt 65536) {throw 'BASELINE_BOUND'}
  return @{status='OBSERVED';version=1;issue=1219;observedAt=(Get-Ai09UtcNow).ToString('o');baselineSha256=(Get-Ai09Digest $state);baseline=$state}
}
function Get-Ai09BootstrapObserved {
  # Public host observations only. No guest authentication, ACL baseline, probes
  # or file transfer. Incomplete addresses must not discard other observations.
  $vm=Hyper-V\Get-VM -Id '453b139b-cceb-446e-99fb-f45bf5895436' -ErrorAction Stop
  if ([string]$vm.Id -ne '453b139b-cceb-446e-99fb-f45bf5895436' -or [string]$vm.Name -cne 'GORIQ-AI09-Ubuntu') {throw 'VM_BINDING_UNAVAILABLE'}
  $nics=@(Hyper-V\Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)
  if ($nics.Count -ne 1) {throw 'NIC_AMBIGUOUS'}; $nic=$nics[0]
  if ([string]$nic.VMId -ne [string]$vm.Id -or [string]$nic.MacAddress -cne '00155DDC2C00') {throw 'VM_BINDING_UNAVAILABLE'}
  $switch=Hyper-V\Get-VMSwitch -Id $nic.SwitchId -ErrorAction Stop
  if ([string]$switch.Id -ne [string]$nic.SwitchId -or [string]$switch.Name -cne [string]$nic.SwitchName) {throw 'NETWORK_BINDING_UNAVAILABLE'}
  foreach($value in @($vm.State,$nic.Id,$nic.Name,$nic.SwitchId,$nic.SwitchName,$switch.SwitchType)) {
    if ([string]::IsNullOrWhiteSpace([string]$value) -or ([string]$value).Length -gt 256) {throw 'BOOTSTRAP_PROJECTION_UNAVAILABLE'}
  }
  $blockers=@('AUTHENTICATED_GUEST_TRANSPORT_UNVERIFIED'); $hostCandidates=@(); $guestCandidates=@()
  $guestAddresses=@($nic.IPAddresses)
  if ($guestAddresses.Count -gt 64) {throw 'ADDRESS_BOUND'}
  $guestCandidates=@($guestAddresses | Where-Object {Test-Ai09Address ([string]$_)} | ForEach-Object {[string]$_} | Sort-Object -Unique)
  try {
    $management=@(Hyper-V\Get-VMNetworkAdapter -ManagementOS -ErrorAction Stop | Where-Object {$_.SwitchId -eq $nic.SwitchId})
    if ($management.Count -ne 1) {throw 'HOST_INTERFACE_AMBIGUOUS'}
    $interfaces=@(NetAdapter\Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object {$_.MacAddress.Replace('-','') -eq $management[0].MacAddress})
    if ($interfaces.Count -ne 1) {throw 'HOST_INTERFACE_AMBIGUOUS'}
    $addresses=@(NetTCPIP\Get-NetIPAddress -InterfaceIndex $interfaces[0].ifIndex -AddressFamily IPv4 -ErrorAction Stop)
    if ($addresses.Count -gt 64) {throw 'ADDRESS_BOUND'}
    $hostCandidates=@($addresses | Where-Object {$_.AddressState -eq 'Preferred' -and (Test-Ai09Address $_.IPAddress)} | ForEach-Object {[string]$_.IPAddress} | Sort-Object -Unique)
  } catch {$blockers+=@('HOST_ADDRESS_OBSERVATION_UNAVAILABLE')}
  if ($hostCandidates.Count -eq 0) {$blockers+=@('HOST_ADDRESS_UNAVAILABLE')} elseif ($hostCandidates.Count -gt 1) {$blockers+=@('HOST_ADDRESS_AMBIGUOUS')}
  if ($guestCandidates.Count -eq 0) {$blockers+=@('GUEST_ADDRESS_UNAVAILABLE')} elseif ($guestCandidates.Count -gt 1) {$blockers+=@('GUEST_ADDRESS_AMBIGUOUS')}
  $integration=@{status='UNAVAILABLE';services=@();guestServiceInterface=$null}
  try {
    # The imported Get-VM was already pinned to the native module by authority
    # checks. Do not resolve the new read cmdlet from another module/function.
    $trusted=Get-Command 'Hyper-V\Get-VM' -ErrorAction Stop
    $reader=Get-Command 'Hyper-V\Get-VMIntegrationService' -ErrorAction Stop
    if ($reader.Module.Path -cne $trusted.Module.Path -or $reader.CommandType -ne $trusted.CommandType) {throw 'NATIVE_HYPERV_REQUIRED'}
    $services=@(Hyper-V\Get-VMIntegrationService -VM $vm -ErrorAction Stop)
    if ($services.Count -lt 1 -or $services.Count -gt 16) {throw 'INTEGRATION_SERVICES_BOUND'}
    $rows=@(); $ids=@()
    foreach($service in $services) {
      $id=[string]$service.Id
      if ($id -notmatch ('^Microsoft:'+([regex]::Escape([string]$vm.Id))+'\\[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') -or $id -in $ids -or $service.Enabled -isnot [bool]) {throw 'INTEGRATION_SERVICES_PROJECTION_UNAVAILABLE'}
      $ids+=@($id)
      foreach($name in @('Name','PrimaryStatusDescription','SecondaryStatusDescription')) {
        if ($null -eq $service.PSObject.Properties[$name] -or ([string]$service.$name).Length -gt 512) {throw 'INTEGRATION_SERVICES_PROJECTION_UNAVAILABLE'}
      }
      $rows+=@([ordered]@{id=$id;name=[string]$service.Name;enabled=[bool]$service.Enabled;primaryStatusDescription=[string]$service.PrimaryStatusDescription;secondaryStatusDescription=[string]$service.SecondaryStatusDescription})
    }
    $guestService=@($rows | Where-Object {$_.id -eq ('Microsoft:'+([string]$vm.Id)+'\6C09BB55-D683-4DA0-8931-C9BF705F6480')})
    $integration=@{status='OBSERVED';services=@($rows | Sort-Object {$_['id']});guestServiceInterface=$null}
    if ($guestService.Count -eq 1) {$integration.guestServiceInterface=$guestService[0]} else {$blockers+=@('GUEST_SERVICE_INTERFACE_UNAVAILABLE')}
  } catch {$blockers+=@('INTEGRATION_SERVICES_UNAVAILABLE')}
  $observations=[ordered]@{hostName=[Environment]::MachineName;vmId=[string]$vm.Id;vmName=[string]$vm.Name;vmState=[string]$vm.State
    nic=[ordered]@{id=[string]$nic.Id;name=[string]$nic.Name;mac=[string]$nic.MacAddress;switchId=[string]$nic.SwitchId;switchName=[string]$nic.SwitchName}
    switch=[ordered]@{id=[string]$switch.Id;name=[string]$switch.Name;type=[string]$switch.SwitchType}
    hostAddressCandidates=@($hostCandidates);guestAddressCandidates=@($guestCandidates);integrationServices=$integration}
  if ([Text.Encoding]::UTF8.GetByteCount((Get-Ai09Json $observations)) -gt 32768) {throw 'BOOTSTRAP_OBSERVATION_BOUND'}
  return @{status='INCOMPLETE';mode='BootstrapInspect';version=1;issue=1219;observedAt=(Get-Ai09UtcNow).ToString('o');observations=$observations;blockers=$blockers;authenticatedConnectionVerified=$false;activationReady=$false;mutationsPerformed=$false}
}
function Get-Ai09Timestamp($Value) {
  # PowerShell 7.5+ JSON eagerly parses ISO dates; PS5.1 keeps strings.
  if ($Value -is [DateTime]) { return [DateTimeOffset]$Value }
  return [DateTimeOffset]::Parse([string]$Value,[Globalization.CultureInfo]::InvariantCulture)
}
function Assert-Ai09PlanFresh($Plan) {
  $now=Get-Ai09UtcNow; $expires=Get-Ai09Timestamp $Plan.expiresAt; $observed=Get-Ai09Timestamp $Plan.baselineObservedAt
  if ($expires -le $now -or $expires -gt $now.AddHours(24) -or $observed -lt $now.AddMinutes(-15) -or $observed -gt $now.AddSeconds(5)) { throw 'PLAN_EXPIRED_OR_STALE' }
}
function Get-Ai09Plan($Path,$Expected,$Reference) {
  if ($Expected -cnotmatch '^[a-f0-9]{64}$' -or $Reference -notmatch '^[A-Za-z0-9:/#._-]{1,240}$') { throw 'INDEPENDENT_APPROVAL_REQUIRED' }
  $path=Get-Ai09SafePath $Path; $stream=[IO.File]::Open($path,'Open','Read','Read')
  try { $bytes=Read-Ai09Bytes $stream 16384 } finally {$stream.Dispose()}
  if ((Get-Ai09ShaBytes $bytes) -cne $Expected) { throw 'PLAN_PIN_MISMATCH' }
  $plan=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes)|ConvertFrom-Json
  Assert-Ai09Fields $plan @('version','issue','expiresAt','hostName','vmId','nicMac','hostAddress','guestAddress','baselineSha256','baselineObservedAt','authorizationRef','executorSha256')
  if ($plan.version -ne 1 -or $plan.issue -ne 1219 -or $plan.authorizationRef -cne $Reference -or $plan.hostName -cne 'HAJI' -or $plan.vmId -cne '453b139b-cceb-446e-99fb-f45bf5895436' -or $plan.nicMac -cne '00155DDC2C00' -or $plan.baselineSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'PLAN_SCOPE_INVALID' }
  if (-not (Test-Ai09Address $plan.hostAddress) -or -not (Test-Ai09Address $plan.guestAddress)) { throw 'PLAN_SCOPE_INVALID' }
  Assert-Ai09PlanFresh $plan
  if ($plan.executorSha256 -cne (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($script:Ai09Source)))) { throw 'EXECUTOR_PIN_MISMATCH' }
  return $plan
}
function New-Ai09Rule($State) {
  $weight=0; foreach($r in $State.acls) { if ($r.Weight -gt $weight) {$weight=$r.Weight} }; if ($weight -ge [int]::MaxValue) { throw 'ACL_WEIGHT_EXHAUSTED' }
  return [ordered]@{Action='Allow';Direction='Inbound';Weight=($weight+1);LocalIPAddress=($State.guestAddress+'/32');RemoteIPAddress=($State.hostAddress+'/32');LocalPort='22';RemotePort='ANY';Protocol='TCP';Stateful=$true;IdleSessionTimeout=60;IsolationID=0}
}
function Get-Ai09BoundNic($State) {
  $nic=@(Hyper-V\Get-VMNetworkAdapter -VMName 'GORIQ-AI09-Ubuntu' -ErrorAction Stop | Where-Object {$_.Id -eq $State.nic.id -and $_.MacAddress -ceq '00155DDC2C00' -and $_.SwitchId -eq $State.nic.switchId})
  if ($nic.Count -ne 1 -or [string]$nic[0].VMId -cne '453b139b-cceb-446e-99fb-f45bf5895436') { throw 'VM_BINDING_DRIFT' }; return $nic[0]
}
function Add-Ai09NativeRule($State,$Rule) {
  $nic=Get-Ai09BoundNic $State
  Hyper-V\Add-VMNetworkAdapterExtendedAcl -VMNetworkAdapter $nic -Action Allow -Direction Inbound -LocalIPAddress $Rule.LocalIPAddress -RemoteIPAddress $Rule.RemoteIPAddress -LocalPort '22' -RemotePort 'ANY' -Protocol TCP -Weight $Rule.Weight -Stateful $true -IdleSessionTimeout 60 -IsolationID 0 -ErrorAction Stop
}
function Remove-Ai09NativeRule($State,$Rule) {
  $nic=Get-Ai09BoundNic $State
  Hyper-V\Remove-VMNetworkAdapterExtendedAcl -VMNetworkAdapter $nic -Direction Inbound -Weight $Rule.Weight -Confirm:$false -ErrorAction Stop
}
function Write-Ai09Journal($Stream,$Record) {
  $bytes=[Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $Record)+"`n"); if ($Stream.Length+$bytes.Length -gt 131072) { throw 'JOURNAL_BOUND' }
  $null=$Stream.Seek(0,[IO.SeekOrigin]::End); $Stream.Write($bytes,0,$bytes.Length); $Stream.Flush($true)
}
function Invoke-Ai09AccessHost {
  param([ValidateSet('Inspect','BootstrapInspect','Apply','Rollback')]$Mode='Inspect',$PlanPath,$ExpectedPlanSha256,$AuthorizationReference,$JournalPath)
  $ErrorActionPreference='Stop'; $journal=$null; $mutating=$false
  try {
    Assert-Ai09NativeAuthority
    if ($Mode -eq 'BootstrapInspect') { return Get-Ai09BootstrapObserved }
    if ($Mode -eq 'Inspect') { return Get-Ai09Observed }
    $plan=Get-Ai09Plan $PlanPath $ExpectedPlanSha256 $AuthorizationReference
    $path=Get-Ai09SafePath $JournalPath; $observed=Get-Ai09Observed; $state=$observed.baseline
    if ($state.hostAddress -cne $plan.hostAddress -or $state.guestAddress -cne $plan.guestAddress) { throw 'ADDRESS_DRIFT' }
    if ($Mode -eq 'Apply') {
      if ($observed.baselineSha256 -cne $plan.baselineSha256) { throw 'BASELINE_DRIFT' }
      $rule=New-Ai09Rule $state
      $journal=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
      Write-Ai09Journal $journal ([ordered]@{status='PREPARED';version=1;issue=1219;planSha256=$ExpectedPlanSha256;authorizationRef=$AuthorizationReference;baseline=$state;rule=$rule;observedAt=$observed.observedAt})
      if ((Get-Ai09Observed).baselineSha256 -cne $plan.baselineSha256) { throw 'BASELINE_DRIFT' }
      Assert-Ai09PlanFresh $plan
      $mutating=$true; $null=Add-Ai09NativeRule $state $rule
      $expected=Get-Ai09Json $state|ConvertFrom-Json; $expected.acls=@($expected.acls)+@([pscustomobject]$rule)
      $wanted=Get-Ai09Digest (ConvertTo-Ai09State $expected); $status='APPLIED'
    } else {
      $journal=[IO.File]::Open($path,'Open','ReadWrite','None'); $bytes=Read-Ai09Bytes $journal 131072
      $lines=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes).Split("`n")
      if ($lines.Count -gt 32 -or $lines[-1] -ne '') { throw 'JOURNAL_INVALID' }; $record=$lines[0]|ConvertFrom-Json
      Assert-Ai09Fields $record @('status','version','issue','planSha256','authorizationRef','baseline','rule','observedAt')
      if ($record.status -cne 'PREPARED' -or $record.version -ne 1 -or $record.issue -ne 1219 -or $record.planSha256 -cne $ExpectedPlanSha256 -or $record.authorizationRef -cne $AuthorizationReference) { throw 'JOURNAL_BINDING_INVALID' }
      $before=ConvertTo-Ai09State $record.baseline; $rule=New-Ai09Rule $before
      if ((Get-Ai09Digest $before) -cne $plan.baselineSha256 -or (Get-Ai09Json $record.rule) -cne (Get-Ai09Json $rule)) { throw 'JOURNAL_BINDING_INVALID' }
      $expected=Get-Ai09Json $before|ConvertFrom-Json; $expected.acls=@($expected.acls)+@([pscustomobject]$rule)
      if ((Get-Ai09Digest (ConvertTo-Ai09State $expected)) -cne $observed.baselineSha256) { throw 'ROLLBACK_STATE_DRIFT' }
      Write-Ai09Journal $journal @{status='ROLLBACK_PREPARED';observedAt=$observed.observedAt}
      if ((Get-Ai09Observed).baselineSha256 -cne $observed.baselineSha256) { throw 'ROLLBACK_STATE_DRIFT' }
      Assert-Ai09PlanFresh $plan
      $mutating=$true; $null=Remove-Ai09NativeRule $state $rule; $wanted=$plan.baselineSha256; $status='ROLLED_BACK'
    }
    $after=Get-Ai09Observed; if ($after.baselineSha256 -cne $wanted) { throw 'AFTER_STATE_UNCONFIRMED' }
    $receipt=[ordered]@{status=$status;version=1;issue=1219;planSha256=$ExpectedPlanSha256;hostName=$plan.hostName;vmId=$plan.vmId;nicMac=$plan.nicMac;hostAddress=$plan.hostAddress;guestAddress=$plan.guestAddress;expiresAt=$plan.expiresAt;baselineSha256=$plan.baselineSha256;afterSha256=$after.baselineSha256;observedAt=$after.observedAt}
    Write-Ai09Journal $journal $receipt; return $receipt
  } catch {
    $status='BLOCKED'; if ($mutating) {$status='UNCERTAIN'}
    $code=[string]$_.Exception.Message; if ($code -cnotmatch '^[A-Z][A-Z0-9_]{1,80}$') {$code='NATIVE_OR_IO_FAILURE'}
    $result=@{status=$status;code=$code;issue=1219;observedAt=[DateTime]::UtcNow.ToString('o')}
    if ($journal) { try {Write-Ai09Journal $journal $result} catch {$result.journalWriteUnconfirmed=$true} }
    return $result
  } finally { if ($journal) {$journal.Dispose()} }
}
if ($MyInvocation.InvocationName -ne '.') {
  $result=Invoke-Ai09AccessHost @PSBoundParameters; $result|ConvertTo-Json -Depth 20
  if ($result.status -in @('OBSERVED','APPLIED','ROLLED_BACK')) {exit 0} else {exit 1}
}
