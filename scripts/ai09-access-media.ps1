[CmdletBinding()]
param([ValidateSet('Verify','Prepare','ResumeEmptyMbr','Collect')][string]$Mode='Verify',
  [string]$ExpectedBundleSha256,[string]$AuthorizationReference,[string]$ExpiresAt,
  [string]$ResumeBindingPath,[string]$ResumeBindingSha256,[string]$CompletionRecordSha256,
  [switch]$GuestUnmountConfirmed,[switch]$PermitNetwork)
# Issue1219. Source preparation is unprivileged; Prepare/Collect are separately
# owner-approved native administrator operations. A reference string is NOT consent.
$script:Ai09MediaArguments=@{}+$PSBoundParameters
$script:Ai09MediaSource=$PSCommandPath
$script:Ai09MediaScripts=$PSScriptRoot

function Get-Ai09MediaScope {
  return [ordered]@{Media='C:\Users\qq113\.codex\AI09-ACCESS-1219-20261020.vhdx';
    State='C:\Users\qq113\.codex\ai09-access-1219-20261020';Slot=3;Label='A09'}
}
function Assert-Ai09MediaDrives($Drives,$Dvd,[bool]$Attached) {
  $s=Get-Ai09MediaScope
  $root=@($Drives|Where-Object {$_.Path -ceq 'C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx' -and [string]$_.ControllerType -ceq 'SCSI' -and $_.ControllerNumber -eq 0 -and $_.ControllerLocation -eq 0})
  $new=@($Drives|Where-Object {$_.Path -ceq $s.Media -and [string]$_.ControllerType -ceq 'SCSI' -and $_.ControllerNumber -eq 0 -and $_.ControllerLocation -eq $s.Slot})
  if (@($Dvd|Where-Object {$_.ControllerNumber -eq 0 -and $_.ControllerLocation -eq $s.Slot}).Count) {throw 'MEDIA_SLOT_OCCUPIED'}
  $count=1; if($Attached){$count=2}
  if ($root.Count -ne 1 -or @($Drives).Count -ne $count -or $new.Count -ne [int]$Attached) {throw 'MEDIA_TOPOLOGY_DRIFT'}
}
function Write-Ai09MediaNew([string]$Path,[byte[]]$Bytes) {
  $stream=[IO.File]::Open($Path,'CreateNew','Write','None')
  try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Assert-Ai09MediaLease($Expiry) {
  if([DateTimeOffset]::UtcNow -ge $Expiry){throw 'APPROVAL_EXPIRED_OR_TOO_LONG'}
}
function ConvertFrom-Ai09MediaJson([string]$Json) {
  $parameters=@{}
  if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$parameters.DateKind='String'}
  return ($Json|ConvertFrom-Json @parameters)
}
function Read-Ai09MediaJson([string]$Path) {
  $null=Get-Ai09SafePath $Path
  $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($item.PSIsContainer -or $item.Length -gt 131072){throw 'MEDIA_RESULT_BOUND'}
  return ConvertFrom-Ai09MediaJson ([IO.File]::ReadAllText($Path))
}
function Assert-Ai09MediaSourcePath([string]$Path) {
  Assert-Ai09MediaAllowedWriter $Path
  Assert-Ai09MediaAllowedWriter ([IO.Path]::GetDirectoryName($Path))
  for($cursor=[IO.Path]::GetFullPath($Path);$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){
    if(Test-Path -LiteralPath $cursor){
      $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'MEDIA_PATH_ALIAS'}
    }
    if([IO.Path]::GetPathRoot($cursor) -eq $cursor){break}
  }
}
function Assert-Ai09MediaAllowedWriter([string]$Path) {
  $acl=Get-Acl -LiteralPath $Path -ErrorAction Stop
  $allowed=@('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  $owner=(New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
  $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  if($owner -notin $allowed){throw 'OWNER_PATH_REQUIRED'}
  foreach($ace in $acl.Access){if($ace.AccessControlType -eq 'Allow' -and ($ace.FileSystemRights -band $write) -and $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw 'OWNER_PATH_REQUIRED'}}
}
function New-Ai09MediaWrapper($Plan,[string]$FsUuid,[string]$PartUuid,$Pins) {
  if($Plan.runId -cnotmatch '^[a-f0-9]{32}$' -or $Plan.authorizationRef -cnotmatch '^[A-Za-z0-9._:-]{1,128}$' -or $FsUuid -cnotmatch '^[A-F0-9]{4}-[A-F0-9]{4}$' -or $PartUuid -cnotmatch '^[a-f0-9]{8}-01$'){throw 'MEDIA_IDENTITY_INVALID'}
  if(@($Pins.Keys).Count -ne 3){throw 'PAYLOAD_HASH_INVALID'}
  foreach($name in @('enroll.py','plan.json','inspect.py')){if($Pins[$name] -cnotmatch '^[a-f0-9]{64}$'){throw 'PAYLOAD_HASH_INVALID'}}
  # Start outside the media and relocate all code before unmount. No private key
  # is ever put on FAT. The new /a09 mountpoint must be owner-created, never /mnt.
  $text=@'
#!/bin/sh
set -eu
cd /
[ "$(/usr/bin/id -u)" = 0 ] || exit 20
[ ! -L /a09 ] && [ "$(/usr/bin/stat -c %u:%g /a09)" = 0:0 ] || exit 21
[ "$(/usr/bin/findmnt -rn -M /a09 -o FSTYPE)" = vfat ] || exit 22
dev=$(/usr/bin/findmnt -rn -M /a09 -o SOURCE)
[ -b "$dev" ] || exit 23
[ "$(/usr/sbin/blkid -s LABEL -o value "$dev")" = A09 ] || exit 24
[ "$(/usr/sbin/blkid -s UUID -o value "$dev")" = __FS__ ] || exit 25
[ "$(/usr/sbin/blkid -s PARTUUID -o value "$dev")" = __PART__ ] || exit 26
[ "$(/usr/sbin/blkid -t LABEL=A09 -o device | /usr/bin/wc -l)" -eq 1 ] || exit 27
[ "$(/usr/bin/findmnt -rn -S "$dev" -o TARGET)" = /a09 ] || exit 28
[ ! -L /a09/go ] || exit 29
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C /usr/bin/python3 -I -B - <<'PY'
import hashlib,os,pathlib,stat
base=pathlib.Path('/a09')
pins={'enroll.py':'__ENROLL__','plan.json':'__PLAN__','inspect.py':'__INSPECT__'}
target=pathlib.Path('/run/ai09-1219-__RUN__')
os.mkdir(target,0o700)
for name,expected in pins.items():
    source=base/name
    info=source.lstat()
    if not stat.S_ISREG(info.st_mode) or source.is_symlink() or info.st_size>131072:
        raise SystemExit('PAYLOAD_METADATA_INVALID')
    data=source.read_bytes()
    if hashlib.sha256(data).hexdigest()!=expected:raise SystemExit('PAYLOAD_HASH_MISMATCH')
    with (target/name).open('xb') as stream:stream.write(data)
    os.chmod(target/name,0o600)
runner=r'''import os,pathlib,subprocess,sys
os.closerange(3,65536)
os.chdir('/')
root=pathlib.Path('/run/ai09-1219-__RUN__')
dev=subprocess.check_output(['/usr/bin/findmnt','-rn','-M','/a09','-o','SOURCE'],text=True).strip()
def invoke(args,name):
    with (pathlib.Path('/a09')/name).open('xb') as out:
        process=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.DEVNULL,start_new_session=True,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C','LC_ALL':'C'})
        try:return process.wait(timeout=90)
        except subprocess.TimeoutExpired:
            import signal
            os.killpg(process.pid,signal.SIGKILL)
            process.wait(timeout=3)
            return 124
code=invoke(['/usr/bin/python3','-I','-B',str(root/'inspect.py'),'__RUN__'],'baseline.txt')
if code==0:
    code=invoke(['/usr/bin/python3','-I','-B',str(root/'enroll.py'),'apply',str(root/'plan.json'),'__PLAN__','__REF__'],'enrollment.json')
else:
    (pathlib.Path('/a09')/'enrollment.json').write_text('{"status":"BLOCKED","code":"BASELINE_REFUSED"}\n')
(pathlib.Path('/a09')/'exit.txt').write_text(str(code)+'\n')
os.sync()
subprocess.run(['/usr/bin/umount','/a09'],check=True,timeout=15)
check=subprocess.run(['/usr/bin/findmnt','-rn','-S',dev],capture_output=True,timeout=5)
if check.returncode!=1 or check.stdout.strip():raise SystemExit('DEVICE_STILL_MOUNTED_OR_UNKNOWN')
print('A09_UNMOUNTED exit='+str(code)+' run=__RUN__',flush=True)
raise SystemExit(code)
'''
with (target/'runner.py').open('x') as stream:stream.write(runner)
os.chmod(target/'runner.py',0o600)
PY
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C /usr/bin/python3 -I -B /run/ai09-1219-__RUN__/runner.py
'@
  return $text.Replace('__FS__',$FsUuid).Replace('__PART__',$PartUuid).Replace('__RUN__',$Plan.runId).Replace('__REF__',$Plan.authorizationRef).Replace('__ENROLL__',$Pins['enroll.py']).Replace('__PLAN__',$Pins['plan.json']).Replace('__INSPECT__',$Pins['inspect.py']).Replace("`r`n","`n")+"`n"
}
function Get-Ai09MediaLocalSha([byte[]]$Bytes) {
  $hash=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
}
function Get-Ai09MediaBundle($Locks=$null) {
  $names=@('ai09-access-media.ps1','ai09-owner-key-enroll.py','ai09-first-access-inspect.py','ai09-first-access-host.ps1','ai09-access-host.ps1')
  $pins=[ordered]@{}
  foreach($name in $names){
    $path=Join-Path $script:Ai09MediaScripts $name
    Assert-Ai09MediaSourcePath $path
    if($null -ne $Locks){
      $stream=[IO.File]::Open($path,'Open','Read','Read');$Locks.Add($stream)
      $bytes=New-Object byte[] ([int]$stream.Length);$offset=0
      while($offset -lt $bytes.Length){$n=$stream.Read($bytes,$offset,$bytes.Length-$offset);if($n -le 0){throw 'SOURCE_READ_FAILED'};$offset+=$n}
      $pins[$name]=Get-Ai09MediaLocalSha $bytes
    }else{$pins[$name]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
  }
  $json=ConvertTo-Json -InputObject $pins -Compress
  return [ordered]@{files=$pins;sha256=(Get-Ai09MediaLocalSha ([Text.Encoding]::UTF8.GetBytes($json)))}
}
function Get-Ai09MediaNativeSnapshot {
  # Media-specific reader; the old first-access reader intentionally accepts one
  # disk only. Validate both attachments before projecting the original OS disk.
  Assert-Ai09FirstNetworkReaders
  $s=Get-Ai09MediaScope
  $vm=Hyper-V\Get-VM -Id '453b139b-cceb-446e-99fb-f45bf5895436' -ErrorAction Stop
  $nics=@(Hyper-V\Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)
  if($nics.Count -ne 1 -or [string]$nics[0].VMId -cne '453b139b-cceb-446e-99fb-f45bf5895436'){throw 'VM_BINDING_UNAVAILABLE'}
  $nic=$nics[0];$switch=Hyper-V\Get-VMSwitch -Id $nic.SwitchId -ErrorAction Stop
  $management=@(Hyper-V\Get-VMNetworkAdapter -ManagementOS -ErrorAction Stop|Where-Object {$_.SwitchId -eq $nic.SwitchId})
  if($management.Count -ne 1 -or [string]$management[0].MacAddress -cnotmatch '^[A-Fa-f0-9]{12}$'){throw 'HOST_INTERFACE_AMBIGUOUS'}
  $interfaces=@(NetAdapter\Get-NetAdapter -IncludeHidden -ErrorAction Stop|Where-Object {$mac=([string]$_.MacAddress).Replace('-','');$mac -cmatch '^[A-Fa-f0-9]{12}$' -and $mac -eq $management[0].MacAddress})
  if($interfaces.Count -ne 1){throw 'HOST_INTERFACE_AMBIGUOUS'}
  $addresses=@(NetTCPIP\Get-NetIPAddress -InterfaceIndex $interfaces[0].ifIndex -AddressFamily IPv4 -ErrorAction Stop|Where-Object {$_.AddressState -eq 'Preferred' -and (Test-Ai09Address $_.IPAddress)})
  if($addresses.Count -ne 1 -or @($nic.IPAddresses).Count -gt 64){throw 'ADDRESS_UNAVAILABLE_OR_AMBIGUOUS'}
  $drives=@(Hyper-V\Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
  Assert-Ai09MediaDrives $drives @(Hyper-V\Get-VMDvdDrive -VM $vm -ErrorAction Stop) $true
  $root=@($drives|Where-Object {$_.Path -cne $s.Media})
  $disks=@($root|ForEach-Object {$v=Hyper-V\Get-VHD -Path $_.Path -ErrorAction Stop;[pscustomobject][ordered]@{path=[string]$_.Path;controllerType=[string]$_.ControllerType;controllerNumber=[int]$_.ControllerNumber;controllerLocation=[int]$_.ControllerLocation;diskIdentifier=[string]$v.DiskIdentifier;parentPath=[string]$v.ParentPath;vhdType=[string]$v.VhdType;vhdFormat=[string]$v.VhdFormat;size=[long]$v.Size;fileSize=[long]$v.FileSize}})
  return [pscustomobject][ordered]@{hostName=[Environment]::MachineName;vmId=[string]$vm.Id;vmName=[string]$vm.Name;vmState=[string]$vm.State;generation=[int]$vm.Generation;
    nic=[pscustomobject][ordered]@{id=[string]$nic.Id;name=[string]$nic.Name;mac=[string]$nic.MacAddress;switchId=[string]$nic.SwitchId;switchName=[string]$nic.SwitchName};
    switch=[pscustomobject][ordered]@{id=[string]$switch.Id;name=[string]$switch.Name;type=[string]$switch.SwitchType};
    hostAddress=[string]$addresses[0].IPAddress;guestAddress='172.27.140.254';guestAddressCandidates=@($nic.IPAddresses);hostInterfaceIndex=[int]$interfaces[0].ifIndex;hostPrefixLength=[int]$addresses[0].PrefixLength;
    disks=$disks;acls=@(Hyper-V\Get-VMNetworkAdapterExtendedAcl -VMNetworkAdapter $nic -ErrorAction Stop)}
}
function Assert-Ai09MediaState([bool]$Attached,$Record=$null) {
  Assert-Ai09NativeAuthority
  $s=Get-Ai09MediaScope
  $vm=Hyper-V\Get-VM -Id '453b139b-cceb-446e-99fb-f45bf5895436' -ErrorAction Stop
  $drives=@(Hyper-V\Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
  $dvd=@(Hyper-V\Get-VMDvdDrive -VM $vm -ErrorAction Stop)
  Assert-Ai09MediaDrives $drives $dvd $Attached
  if($Attached){$raw=Get-Ai09MediaNativeSnapshot}else{$raw=Get-Ai09FirstNativeSnapshot}
  $canonical=Get-Ai09FirstCanonical $raw
  Assert-Ai09FirstPolicy $canonical $false
  if($Record -and (Get-Ai09Digest $canonical) -cne $Record.baselineSha256){throw 'MEDIA_BASELINE_DRIFT'}
  return $canonical
}
function Assert-Ai09MediaVhd($Record,[bool]$HostMounted) {
  $s=Get-Ai09MediaScope
  $v=Hyper-V\Get-VHD -Path $s.Media -ErrorAction Stop
  if($v.Path -cne $s.Media -or [string]$v.DiskIdentifier -cne $Record.vhdIdentifier -or $v.Size -ne 256MB -or [string]$v.VhdType -cne 'Dynamic' -or [string]$v.VhdFormat -cne 'VHDX' -or $v.ParentPath){throw 'MEDIA_VHD_IDENTITY_DRIFT'}
  if($HostMounted -and (-not $v.Attached -or $v.DiskNumber -ne $Record.diskNumber)){throw 'MEDIA_HOST_MOUNT_DRIFT'}
  return $v
}
function Assert-Ai09MediaVolume($Record,[bool]$Raw=$false) {
  $v=Assert-Ai09MediaVhd $Record $true
  $d=Storage\Get-Disk -Number $v.DiskNumber -ErrorAction Stop
  if($d.UniqueId -cne $Record.diskUniqueId -or $d.Size -ne 256MB -or $d.IsBoot -or $d.IsSystem -or $d.IsOffline){throw 'MEDIA_DISK_IDENTITY_DRIFT'}
  if($Raw){if([string]$d.PartitionStyle -cne 'RAW'){throw 'NEW_RAW_MEDIA_REQUIRED'};return $d}
  $parts=@(Get-Ai09MediaPartitions $d.Number)
  if($parts.Count -ne 1 -or $parts[0].PartitionNumber -ne 1 -or -not $parts[0].DriveLetter){throw 'MEDIA_PARTITION_DRIFT'}
  $volume=Storage\Get-Volume -Partition $parts[0] -ErrorAction Stop
  if([string]$volume.FileSystem -cne 'FAT32' -or $volume.FileSystemLabel -cne 'A09'){throw 'MEDIA_VOLUME_DRIFT'}
  return [ordered]@{disk=$d;partition=$parts[0];volume=$volume;root=([string]$parts[0].DriveLetter+':\')}
}
function Get-Ai09MediaPartitions([int]$DiskNumber) {
  # CDXML's filtered query throws for a valid disk with no partitions. Enumerate
  # and filter locally; genuine provider failures must still terminate the run.
  return @(Storage\Get-Partition -ErrorAction Stop|Where-Object {$_.DiskNumber -eq $DiskNumber})
}
function Get-Ai09MediaResumeOrigin {
  return [ordered]@{
    runId='028cc365d24b48d3a8ddfbbe07d0ac95';vhdIdentifier='BB6408C8-49AE-4575-B5F0-69AC73DDFE86';diskUniqueId='60022480C80864BBAE4969AC73DDFE86'
    baselineSha256='00753d23bc2c5d4c24b1d131d13b2e6e184699ad621712cdee9fb4a7e9ac098b'
    bundleSha256='31e1c7a45abb7ef9b3834f0763da4ae4d4e219a9d8a2d4a48511f93e942dcd02';authorizationRef='owner-1219-ai09-key-media-nullmac-20261021';expiresAt='2026-10-21T09:00:00.000Z'
    intentSha256='f9dc1e81ca498ac0c2b5a5d576b48b5aa044e557a238654de7b64bb4a391b8f5';preparedSha256='75409f7caf39af78a1d6c4b000e6de377fd6b8e075f1496620c75b425f4cb56d'
    publicKeySha256='faa888c14c4453fdb365cb49a26770f32095d12f527c420d51207de8c00114bd'
    failurePath='C:\Users\qq113\.codex\worktrees\goriq-1219-verifier\checks\ai09-key-media-20261020\native-prepare-0f1b61b1-20261020T1705Z.json'
    failureSha256='8e551f6bff745fb5b08d80578b63a2c44c2e287130741887fc0ebc483bc4a298'
  }
}
function Read-Ai09MediaLocked([string]$Path,[string]$Sha256,$Locks) {
  $null=Get-Ai09SafePath $Path
  $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($item.PSIsContainer -or $item.Length -gt 131072){throw 'MEDIA_RESULT_BOUND'}
  $stream=[IO.File]::Open($Path,'Open','Read','Read');$Locks.Add($stream)
  $bytes=Read-Ai09Bytes $stream 131072
  if($Sha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-Ai09ShaBytes $bytes) -cne $Sha256){throw 'MEDIA_ORIGIN_HASH_DRIFT'}
  return [Text.Encoding]::UTF8.GetString($bytes)
}
function Assert-Ai09MediaPrivateKeyMetadata([string]$Path) {
  $null=Get-Ai09SafePath $Path
  $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($item.PSIsContainer -or $item.Length -le 0 -or $item.Length -gt 131072){throw 'MEDIA_PRIVATE_KEY_METADATA_INVALID'}
  $allowed=@('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  foreach($ace in (Get-Acl -LiteralPath $Path -ErrorAction Stop).Access){
    if($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw 'MEDIA_PRIVATE_KEY_METADATA_INVALID'}
  }
}
function Read-Ai09MediaResumeChain($Bundle,[string]$Reference,[string]$Expiry,[string]$BindingPath,[string]$BindingSha256,$Locks) {
  $s=Get-Ai09MediaScope;$origin=Get-Ai09MediaResumeOrigin
  $binding=ConvertFrom-Ai09MediaJson (Read-Ai09MediaLocked $BindingPath $BindingSha256 $Locks)
  Assert-Ai09Fields $binding @('version','issue','profile','bundleSha256','authorizationRef','expiresAt','originBundleSha256','intentSha256','preparedSha256','failureSha256','publicKeySha256')
  if($binding.version -ne 1 -or $binding.issue -ne 1219 -or $binding.profile -cne 'AI09_RESUME_EMPTY_MBR_V1' -or $binding.bundleSha256 -cne $Bundle.sha256 -or $binding.authorizationRef -cne $Reference -or $binding.expiresAt -cne $Expiry -or $binding.originBundleSha256 -cne $origin.bundleSha256 -or [DateTimeOffset]::Parse($Expiry) -gt [DateTimeOffset]::Parse($origin.expiresAt)){throw 'MEDIA_RESUME_SCOPE_INVALID'}
  foreach($name in @('intentSha256','preparedSha256','failureSha256','publicKeySha256')){if($binding.$name -cne $origin[$name]){throw 'MEDIA_RESUME_SCOPE_INVALID'}}
  Assert-Ai09MediaPrivateKeyMetadata (Join-Path $s.State 'client_ed25519')
  $intent=ConvertFrom-Ai09MediaJson (Read-Ai09MediaLocked (Join-Path $s.State 'intent.json') $origin.intentSha256 $Locks)
  $record=ConvertFrom-Ai09MediaJson (Read-Ai09MediaLocked (Join-Path $s.State 'prepared.json') $origin.preparedSha256 $Locks)
  $failure=ConvertFrom-Ai09MediaJson (Read-Ai09MediaLocked $origin.failurePath $origin.failureSha256 $Locks)
  $public=(Read-Ai09MediaLocked (Join-Path $s.State 'client_ed25519.pub') $origin.publicKeySha256 $Locks).Trim().Split(' ')
  if($public.Count -ne 3 -or $public[0] -cne 'ssh-ed25519' -or $public[1] -cnotmatch '^[A-Za-z0-9+/]+={0,2}$'){throw 'PUBLIC_KEY_INVALID'}
  foreach($r in @($intent,$record)){
    Assert-Ai09Fields $r @('version','issue','runId','authorizationRef','expiresAt','bundleSha256','baselineSha256','baseline','vhdIdentifier','diskUniqueId','diskNumber','fileSystemUuid','partitionUuid','payloadSha256')
    if($r.version -ne 1 -or $r.issue -ne 1219 -or $r.runId -cne $origin.runId -or $r.authorizationRef -cne $origin.authorizationRef -or $r.expiresAt -cne $origin.expiresAt -or $r.bundleSha256 -cne $origin.bundleSha256 -or $r.baselineSha256 -cne $origin.baselineSha256 -or (Get-Ai09Digest $r.baseline) -cne $origin.baselineSha256 -or $r.fileSystemUuid -cne '' -or $r.partitionUuid -cne '' -or @($r.payloadSha256.PSObject.Properties).Count -ne 0){throw 'MEDIA_ORIGIN_STAGE_INVALID'}
  }
  if($intent.vhdIdentifier -cne '' -or $intent.diskUniqueId -cne '' -or $intent.diskNumber -ne -1 -or $record.vhdIdentifier -cne $origin.vhdIdentifier -or $record.diskUniqueId -cne $origin.diskUniqueId -or $failure.status -cne 'NATIVE_PREPARATION_FAILED' -or $failure.errorId -cne 'CmdletizationQuery_NotFound_DiskNumber,Get-Partition'){throw 'MEDIA_ORIGIN_STAGE_INVALID'}
  return @{origin=$origin;record=$record;binding=$binding;publicKey=($public[0]+' '+$public[1])}
}
function New-Ai09PrivateDirectory([string]$Path) {
  if(Test-Path -LiteralPath $Path){throw 'ACCESS_STATE_ALREADY_EXISTS'}
  $parent=[IO.Path]::GetDirectoryName($Path)
  Assert-Ai09OwnerPath $parent
  $null=[IO.Directory]::CreateDirectory($Path)
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($sid)
  foreach($id in @($sid.Value,'S-1-5-18','S-1-5-32-544')){
    $rule=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($id)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
  $check=Get-Acl -LiteralPath $Path
  if(-not $check.AreAccessRulesProtected -or @($check.Access).Count -ne 3){throw 'PRIVATE_DIRECTORY_ACL_UNCONFIRMED'}
  foreach($a in $check.Access){if($a.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){throw 'PRIVATE_DIRECTORY_ACL_UNCONFIRMED'}}
}
function New-Ai09MediaClientKey([string]$Key) {
    $keygen=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\OpenSSH\ssh-keygen.exe'
    if((Get-AuthenticodeSignature -LiteralPath $keygen).Status -ne 'Valid'){throw 'NATIVE_KEYGEN_REQUIRED'}
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$keygen;$start.Arguments='-q -t ed25519 -N "" -C goriq-1219-20261020 -f "'+$Key+'"'
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $proc=[Diagnostics.Process]::Start($start)
    try{if(-not $proc.WaitForExit(15000)){ $proc.Kill();throw 'KEYGEN_TIMEOUT' };if($proc.ExitCode -ne 0){throw 'KEYGEN_FAILED'}}finally{$proc.Dispose()}
}
function Complete-Ai09MediaNetwork($Record,$Bundle,[string]$Reference,[string]$ExpiresAt) {
  $s=Get-Ai09MediaScope
  $plan=Read-Ai09MediaJson (Join-Path $s.State 'collected-plan.json')
  $enrollment=Read-Ai09MediaJson (Join-Path $s.State 'collected-enrollment.json')
  $baselineText=[IO.File]::ReadAllText((Join-Path $s.State 'collected-baseline.txt'))
  $lines=@($baselineText.Trim().Split("`n")|ForEach-Object {$_.TrimEnd("`r")})
  if($lines.Count -ne 3 -or $lines[0] -cne 'AI09_FIRST_ACCESS_BEGIN' -or $lines[2] -cne 'AI09_FIRST_ACCESS_END'){throw 'FRESH_GUEST_BASELINE_REQUIRED'}
  $baseline=ConvertFrom-Ai09MediaJson $lines[1]
  $observed=[DateTimeOffset]::Parse($baseline.observedAt)
  $age=([DateTimeOffset]::UtcNow-$observed).TotalSeconds
  if($age -lt -60 -or $age -gt 900 -or $baseline.status -cne 'AUTHENTICATED_ROOT_BASELINE' -or $baseline.nonce -cne $Record.runId -or $baseline.effectiveUid -ne 0 -or $baseline.hostname -cne '848484' -or $baseline.mac -cne '00:15:5d:dc:2c:00' -or @($baseline.addresses).Count -ne 1 -or $baseline.addresses[0] -cne '172.27.140.254/20' -or $baseline.hostKeyFingerprint -cne 'SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA'){throw 'FRESH_GUEST_BASELINE_REQUIRED'}
  if($enrollment.status -cne 'APPLIED' -or $enrollment.runId -cne $Record.runId -or $enrollment.authorizationRef -cne $Reference -or $enrollment.expiresAt -cne $ExpiresAt -or $enrollment.planSha256 -cne $Record.payloadSha256.'plan.json' -or $enrollment.executorSha256 -cne $Bundle.files['ai09-owner-key-enroll.py'] -or $plan.runId -cne $Record.runId -or $plan.authorizationRef -cne $Reference -or $plan.expiresAt -cne $ExpiresAt){throw 'ENROLLMENT_NOT_CONFIRMED'}
  $exitPath=Join-Path $s.State 'collected-exit.txt'
  $null=Get-Ai09SafePath $exitPath
  $exitFile=Get-Item -LiteralPath $exitPath -Force -ErrorAction Stop
  if($exitFile.PSIsContainer -or $exitFile.Length -gt 16 -or [IO.File]::ReadAllText($exitPath).Trim() -cne '0'){throw 'GUEST_PROCESS_EXIT_NOT_SUCCESS'}
  $before=Invoke-Ai09FirstAccessHost -Mode Inspect
  if($before.status -cne 'OBSERVED_NETWORK_ONLY'){throw 'FRESH_NETWORK_BASELINE_REQUIRED'}
  Assert-Ai09FirstPolicy $before.baseline $false
  $network=[ordered]@{version=1;issue=1219;profile='AI09_FIRST_ACCESS_TCP22_V1';action='Apply';hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';nicMac='00155DDC2C00';switchId='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';hostAddress='172.27.128.1';guestAddress='172.27.140.254';candidateSource='OWNER_APPROVED_VM_NIC_ENDPOINT';guestAddressVerified=$false;guestEndpointPhotoSha256='1ae8090f7b9c5e6a2a2d7f3cde1c7a1855824d4a4ea5703ec388b39a90de96f4';expiresAt=$ExpiresAt;baselineObservedAt=$before.observedAt;baselineSha256=$before.baselineSha256;authorizationRef=$Reference;executorSha256=$Bundle.files['ai09-first-access-host.ps1'];dependencySha256=$Bundle.files['ai09-access-host.ps1'];permitPlanSha256='';journalSha256=''}
  $path=Join-Path $s.State 'network-plan.json'
  Write-Ai09MediaNew $path ([Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $network)))
  $result=Invoke-Ai09FirstAccessHost -Mode Apply -PlanPath $path -ExpectedPlanSha256 (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($path))) -AuthorizationReference $Reference -JournalPath (Join-Path $s.State 'network-journal.ndjson')
  Write-Ai09MediaNew (Join-Path $s.State 'network-receipt.json') ([Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $result)))
  if($result.status -cne 'APPLIED_NETWORK_ONLY'){throw 'NETWORK_APPLY_NOT_CONFIRMED'}
  return $result
}
function Complete-Ai09MediaPayload($record,$plan,$bundle,$expiry,$d) {
  Assert-Ai09MediaLease $expiry
  $p=Storage\New-Partition -DiskNumber $d.Number -UseMaximumSize -AssignDriveLetter -ErrorAction Stop
  if($p.DiskNumber -ne $record.diskNumber -or $p.PartitionNumber -ne 1 -or -not $p.DriveLetter){throw 'NEW_PARTITION_UNCONFIRMED'}
  # Format ONLY the new partition object on the exact owned 256MiB VHD.
  Assert-Ai09MediaLease $expiry
  Storage\Format-Volume -Partition $p -FileSystem FAT32 -NewFileSystemLabel 'A09' -Confirm:$false -ErrorAction Stop|Out-Null
  $volume=Assert-Ai09MediaVolume $record
  $logical=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='"+$p.DriveLetter+":'") -ErrorAction Stop
  $serial=[string]$logical.VolumeSerialNumber
  if($serial -cnotmatch '^[A-Fa-f0-9]{8}$' -or -not $volume.disk.Signature){throw 'MEDIA_UUID_UNAVAILABLE'}
  $record.fileSystemUuid=$serial.ToUpperInvariant().Insert(4,'-');$record.partitionUuid=('{0:x8}-01' -f [uint32]$volume.disk.Signature)
  $payload=@{'enroll.py'=[IO.File]::ReadAllBytes((Join-Path $script:Ai09MediaScripts 'ai09-owner-key-enroll.py'));'inspect.py'=[IO.File]::ReadAllBytes((Join-Path $script:Ai09MediaScripts 'ai09-first-access-inspect.py'));'plan.json'=[Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $plan))}
  if((Get-Ai09ShaBytes $payload['enroll.py']) -cne $bundle.files['ai09-owner-key-enroll.py'] -or (Get-Ai09ShaBytes $payload['inspect.py']) -cne $bundle.files['ai09-first-access-inspect.py']){throw 'APPROVED_PAYLOAD_DRIFT'}
  foreach($name in $payload.Keys){Assert-Ai09MediaLease $expiry;$record.payloadSha256[$name]=Get-Ai09ShaBytes $payload[$name];Write-Ai09MediaNew (Join-Path $volume.root $name) $payload[$name]}
  $go=[Text.Encoding]::UTF8.GetBytes((New-Ai09MediaWrapper $plan $record.fileSystemUuid $record.partitionUuid $record.payloadSha256))
  $record.payloadSha256['go']=Get-Ai09ShaBytes $go;Assert-Ai09MediaLease $expiry;Write-Ai09MediaNew (Join-Path $volume.root 'go') $go
}
function Get-Ai09MediaResumeAttempt($Chain,[string]$BindingSha256) {
  return [ordered]@{version=1;issue=1219;profile='AI09_RESUME_EMPTY_MBR_ATTEMPT_V1';runId=$Chain.record.runId;bundleSha256=$Chain.binding.bundleSha256;authorizationRef=$Chain.binding.authorizationRef;expiresAt=$Chain.binding.expiresAt;resumeBindingSha256=$BindingSha256}
}
function Invoke-Ai09MediaOperation {
  param([ValidateSet('Prepare','ResumeEmptyMbr','Collect')]$Mode,$LockedBundle,$AuthorizationReference,$ExpiresAt,[switch]$GuestUnmountConfirmed,[switch]$PermitNetwork,
    [string]$ResumeBindingPath,[string]$ResumeBindingSha256,[string]$CompletionRecordSha256)
  $locks=New-Object 'Collections.Generic.List[IO.FileStream]'
  try{
    $chain=$null;$selected=$null;$s=Get-Ai09MediaScope
    $selection=($ResumeBindingPath -or $ResumeBindingSha256 -or $CompletionRecordSha256)
    if($Mode -eq 'ResumeEmptyMbr' -or $selection){
      if($Mode -eq 'Prepare' -or -not $ResumeBindingPath -or $ResumeBindingSha256 -cnotmatch '^[a-f0-9]{64}$' -or ($Mode -eq 'ResumeEmptyMbr' -and ($CompletionRecordSha256 -or $PermitNetwork -or $GuestUnmountConfirmed)) -or ($Mode -eq 'Collect' -and $CompletionRecordSha256 -cnotmatch '^[a-f0-9]{64}$')){throw 'MEDIA_RESUME_SELECTION_INVALID'}
      $chain=Read-Ai09MediaResumeChain $LockedBundle $AuthorizationReference $ExpiresAt $ResumeBindingPath $ResumeBindingSha256 $locks
      if($Mode -eq 'Collect'){
        $selected=ConvertFrom-Ai09MediaJson (Read-Ai09MediaLocked (Join-Path $s.State 'resume-empty-mbr-completed.json') $CompletionRecordSha256 $locks)
        Assert-Ai09Fields $selected @('version','issue','runId','authorizationRef','expiresAt','bundleSha256','baselineSha256','baseline','vhdIdentifier','diskUniqueId','diskNumber','fileSystemUuid','partitionUuid','payloadSha256','resumeBindingSha256','origin','attemptSha256')
        $attempt=ConvertFrom-Ai09MediaJson (Read-Ai09MediaLocked (Join-Path $s.State 'resume-empty-mbr-attempt.json') $selected.attemptSha256 $locks)
        if((Get-Ai09Digest $attempt) -cne (Get-Ai09Digest (Get-Ai09MediaResumeAttempt $chain $ResumeBindingSha256)) -or $selected.resumeBindingSha256 -cne $ResumeBindingSha256 -or (Get-Ai09Digest $selected.origin) -cne (Get-Ai09Digest $chain.binding)){throw 'MEDIA_RESUME_COMPLETION_INVALID'}
        foreach($name in @('version','issue','runId','baselineSha256','vhdIdentifier','diskUniqueId')){if($selected.$name -cne $chain.record.$name){throw 'MEDIA_RESUME_COMPLETION_INVALID'}}
        if((Get-Ai09Digest $selected.baseline) -cne $chain.record.baselineSha256 -or $selected.fileSystemUuid -cnotmatch '^[A-F0-9]{4}-[A-F0-9]{4}$' -or $selected.partitionUuid -cnotmatch '^[a-f0-9]{8}-01$'){throw 'MEDIA_RESUME_COMPLETION_INVALID'}
        Assert-Ai09Fields $selected.payloadSha256 @('enroll.py','inspect.py','plan.json','go')
        foreach($p in $selected.payloadSha256.PSObject.Properties){if($p.Value -cnotmatch '^[a-f0-9]{64}$'){throw 'MEDIA_RESUME_COMPLETION_INVALID'}}
      }
    }
    return Invoke-Ai09MediaCore -Mode $Mode -LockedBundle $LockedBundle -AuthorizationReference $AuthorizationReference -ExpiresAt $ExpiresAt -GuestUnmountConfirmed:$GuestUnmountConfirmed -PermitNetwork:$PermitNetwork -ResumeChain $chain -ResumeBindingSha256 $ResumeBindingSha256 -SelectedRecord $selected
  }finally{foreach($lock in $locks){$lock.Dispose()}}
}
function Invoke-Ai09MediaCore {
  param([ValidateSet('Prepare','ResumeEmptyMbr','Collect')]$Mode,$LockedBundle,$AuthorizationReference,$ExpiresAt,[switch]$GuestUnmountConfirmed,[switch]$PermitNetwork,$ResumeChain,[string]$ResumeBindingSha256,$SelectedRecord)
  $ErrorActionPreference='Stop';$s=Get-Ai09MediaScope;$bundle=$LockedBundle
  if($AuthorizationReference -cnotmatch '^[A-Za-z0-9._:-]{1,128}$'){throw 'APPROVED_BUNDLE_REQUIRED'}
  $expiry=[DateTimeOffset]::ParseExact($ExpiresAt,'yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
  $now=[DateTimeOffset]::UtcNow
  if($expiry -le $now -or $expiry -gt $now.AddHours(24)){throw 'APPROVAL_EXPIRED_OR_TOO_LONG'}
  $null=Get-Ai09SafePath $s.Media
  $null=Get-Ai09SafePath $s.State
  if($Mode -eq 'ResumeEmptyMbr'){
    $attemptPath=Join-Path $s.State 'resume-empty-mbr-attempt.json';$completionPath=Join-Path $s.State 'resume-empty-mbr-completed.json'
    foreach($path in @($attemptPath,$completionPath)){$null=Get-Ai09SafePath $path;if(Test-Path -LiteralPath $path){throw 'MEDIA_RESUME_ALREADY_ATTEMPTED'}}
    $record=[ordered]@{};foreach($p in $ResumeChain.record.PSObject.Properties){$record[$p.Name]=$p.Value}
    $record.diskNumber=-1 # recorded native disk numbers are never authority
    $record.authorizationRef=$AuthorizationReference;$record.expiresAt=$ExpiresAt;$record.bundleSha256=$bundle.sha256;$record.payloadSha256=@{}
    $null=Assert-Ai09MediaState $false $record
    $v=Assert-Ai09MediaVhd $record $false
    if($v.Attached){throw 'MEDIA_HOST_MUST_BE_DETACHED'}
    if(@(Storage\Get-Volume -ErrorAction Stop|Where-Object {$_.FileSystemLabel -ceq 'A09'}).Count){throw 'MEDIA_LABEL_ALREADY_EXISTS'}
    $plan=[ordered]@{version=1;issue=1219;runId=$record.runId;authorizationRef=$AuthorizationReference;expiresAt=$ExpiresAt;publicKey=$ResumeChain.publicKey;executorSha256=$bundle.files['ai09-owner-key-enroll.py']}
    $attemptBytes=[Text.Encoding]::UTF8.GetBytes((Get-Ai09Json (Get-Ai09MediaResumeAttempt $ResumeChain $ResumeBindingSha256)))
    Assert-Ai09MediaLease $expiry
    Write-Ai09MediaNew $attemptPath $attemptBytes
    try{
      Assert-Ai09MediaLease $expiry
      Hyper-V\Mount-VHD -Path $s.Media -PassThru -ErrorAction Stop|Out-Null
      $v=Assert-Ai09MediaVhd $record $false;$record.diskNumber=$v.DiskNumber
      $null=Assert-Ai09MediaVhd $record $true
      $d=Storage\Get-Disk -Number $record.diskNumber -ErrorAction Stop
      if($d.Number -ne $record.diskNumber -or $d.UniqueId -cne $record.diskUniqueId -or $d.Size -ne 256MB -or $d.IsBoot -or $d.IsSystem -or $d.IsOffline -or $d.IsReadOnly -or [string]$d.PartitionStyle -cne 'MBR' -or @(Get-Ai09MediaPartitions $d.Number).Count){throw 'MEDIA_RESUME_EMPTY_MBR_REQUIRED'}
      Complete-Ai09MediaPayload $record $plan $bundle $expiry $d
    }finally{
      # Identity errors after a successful mount must not strand the host mount.
      # The path is fixed and was validated before mounting; never use a recorded
      # DiskNumber for cleanup, and never suppress provider/cleanup failures.
      $v=Hyper-V\Get-VHD -Path $s.Media -ErrorAction Stop
      if($v.Path -cne $s.Media){throw 'MEDIA_VHD_IDENTITY_DRIFT'}
      if($v.Attached){Hyper-V\Dismount-VHD -Path $s.Media -ErrorAction Stop}
      if((Assert-Ai09MediaVhd $record $false).Attached){throw 'MEDIA_HOST_STILL_MOUNTED'}
    }
    if($record.payloadSha256.Count -ne 4){throw 'MEDIA_PREPARATION_INCOMPLETE'}
    $null=Assert-Ai09MediaState $false $record
    Assert-Ai09MediaLease $expiry
    Hyper-V\Add-VMHardDiskDrive -VMName 'GORIQ-AI09-Ubuntu' -ControllerType SCSI -ControllerNumber 0 -ControllerLocation $s.Slot -Path $s.Media -ErrorAction Stop
    $null=Assert-Ai09MediaState $true $record
    $record.resumeBindingSha256=$ResumeBindingSha256;$record.origin=$ResumeChain.binding;$record.attemptSha256=Get-Ai09ShaBytes $attemptBytes
    Assert-Ai09MediaLease $expiry
    Write-Ai09MediaNew $completionPath ([Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $record)))
    return [ordered]@{status='RESUMED_MEDIA_ATTACHED_GUEST_NOT_EXECUTED';runId=$record.runId;state=$s.State;media=$s.Media;completionRecordSha256=(Get-Ai09Digest $record);authenticatedConnectionVerified=$false}
  }
  if($Mode -eq 'Prepare'){
    $baseline=Assert-Ai09MediaState $false
    if(Test-Path -LiteralPath $s.Media){throw 'NEW_MEDIA_PATH_ALREADY_EXISTS'}
    Assert-Ai09OwnerPath ([IO.Path]::GetDirectoryName($s.Media))
    if(@(Storage\Get-Volume -ErrorAction Stop|Where-Object {$_.FileSystemLabel -ceq 'A09'}).Count){throw 'MEDIA_LABEL_ALREADY_EXISTS'}
    Assert-Ai09MediaLease $expiry
    New-Ai09PrivateDirectory $s.State
    $key=Join-Path $s.State 'client_ed25519'
    Assert-Ai09MediaLease $expiry
    New-Ai09MediaClientKey $key
    $public=[IO.File]::ReadAllText($key+'.pub').Trim().Split(' ')
    if($public.Count -ne 3 -or $public[0] -cne 'ssh-ed25519' -or $public[1] -cnotmatch '^[A-Za-z0-9+/]+={0,2}$'){throw 'PUBLIC_KEY_INVALID'}
    $plan=[ordered]@{version=1;issue=1219;runId=[guid]::NewGuid().ToString('N');authorizationRef=$AuthorizationReference;expiresAt=$expiry.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');publicKey=($public[0]+' '+$public[1]);executorSha256=$bundle.files['ai09-owner-key-enroll.py']}
    $record=[ordered]@{version=1;issue=1219;runId=$plan.runId;authorizationRef=$AuthorizationReference;expiresAt=$plan.expiresAt;bundleSha256=$bundle.sha256;baselineSha256=(Get-Ai09Digest $baseline);baseline=$baseline;vhdIdentifier='';diskUniqueId='';diskNumber=-1;fileSystemUuid='';partitionUuid='';payloadSha256=@{}}
    Write-Ai09MediaNew (Join-Path $s.State 'intent.json') ([Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $record)))
    $created=$false
    try{
      $null=Assert-Ai09MediaState $false $record
      Assert-Ai09MediaLease $expiry
      Hyper-V\New-VHD -Path $s.Media -Dynamic -SizeBytes 256MB -ErrorAction Stop|Out-Null
      $v=Hyper-V\Get-VHD -Path $s.Media -ErrorAction Stop
      $record.vhdIdentifier=[string]$v.DiskIdentifier;$created=$true
      $null=Assert-Ai09MediaVhd $record $false
      Assert-Ai09MediaLease $expiry
      Hyper-V\Mount-VHD -Path $s.Media -PassThru -ErrorAction Stop|Out-Null
      $v=Hyper-V\Get-VHD -Path $s.Media -ErrorAction Stop
      $record.diskNumber=$v.DiskNumber;$d=Storage\Get-Disk -Number $v.DiskNumber -ErrorAction Stop;$record.diskUniqueId=$d.UniqueId
      $d=Assert-Ai09MediaVolume $record $true
      Assert-Ai09MediaLease $expiry
      Storage\Initialize-Disk -Number $d.Number -PartitionStyle MBR -ErrorAction Stop|Out-Null
      $d=Storage\Get-Disk -Number $record.diskNumber -ErrorAction Stop
      if($d.UniqueId -cne $record.diskUniqueId -or [string]$d.PartitionStyle -cne 'MBR' -or @(Get-Ai09MediaPartitions $d.Number).Count){throw 'MEDIA_INITIALIZE_UNCONFIRMED'}
      Complete-Ai09MediaPayload $record $plan $bundle $expiry $d
    }finally{
      if($created){$v=Assert-Ai09MediaVhd $record $false;if($v.Attached){Hyper-V\Dismount-VHD -Path $s.Media -ErrorAction Stop};if((Assert-Ai09MediaVhd $record $false).Attached){throw 'MEDIA_HOST_STILL_MOUNTED'}}
      Write-Ai09MediaNew (Join-Path $s.State 'prepared.json') ([Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $record)))
    }
    if($record.payloadSha256.Count -ne 4){throw 'MEDIA_PREPARATION_INCOMPLETE'}
    $null=Assert-Ai09MediaState $false $record
    Assert-Ai09MediaLease $expiry
    Hyper-V\Add-VMHardDiskDrive -VMName 'GORIQ-AI09-Ubuntu' -ControllerType SCSI -ControllerNumber 0 -ControllerLocation $s.Slot -Path $s.Media -ErrorAction Stop
    $null=Assert-Ai09MediaState $true $record
    return [ordered]@{status='NEW_MEDIA_ATTACHED_GUEST_NOT_EXECUTED';runId=$plan.runId;state=$s.State;media=$s.Media;authenticatedConnectionVerified=$false}
  }
  if(-not $GuestUnmountConfirmed){throw 'OWNER_OBSERVED_UNMOUNT_REQUIRED'}
  $record=$SelectedRecord
  if(-not $record){$record=Read-Ai09MediaJson (Join-Path $s.State 'prepared.json')}
  if($record.authorizationRef -cne $AuthorizationReference -or $record.expiresAt -cne $ExpiresAt -or $record.bundleSha256 -cne $bundle.sha256){throw 'MEDIA_RECEIPT_SCOPE_INVALID'}
  $null=Assert-Ai09MediaState $true $record
  $drive=@(Hyper-V\Get-VMHardDiskDrive -VMName 'GORIQ-AI09-Ubuntu' -ErrorAction Stop|Where-Object {$_.Path -ceq $s.Media -and $_.ControllerNumber -eq 0 -and $_.ControllerLocation -eq $s.Slot})
  if($drive.Count -ne 1){throw 'MEDIA_ATTACHMENT_AMBIGUOUS'}
  $null=Assert-Ai09MediaVhd $record $false
  Assert-Ai09MediaLease $expiry
  Hyper-V\Remove-VMHardDiskDrive -VMHardDiskDrive $drive[0] -ErrorAction Stop
  $null=Assert-Ai09MediaState $false $record
  try{
    Assert-Ai09MediaLease $expiry
    Hyper-V\Mount-VHD -Path $s.Media -ReadOnly -PassThru -ErrorAction Stop|Out-Null
    $v=Hyper-V\Get-VHD -Path $s.Media -ErrorAction Stop;$record.diskNumber=$v.DiskNumber
    $volume=Assert-Ai09MediaVolume $record
    if(-not $volume.disk.IsReadOnly){throw 'MEDIA_READONLY_MOUNT_UNCONFIRMED'}
    $logical=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='"+$volume.partition.DriveLetter+":'") -ErrorAction Stop
    $serial=[string]$logical.VolumeSerialNumber
    if($serial -cnotmatch '^[A-Fa-f0-9]{8}$' -or $serial.ToUpperInvariant().Insert(4,'-') -cne $record.fileSystemUuid -or ('{0:x8}-01' -f [uint32]$volume.disk.Signature) -cne $record.partitionUuid){throw 'MEDIA_VOLUME_IDENTITY_DRIFT'}
    foreach($name in @('go','enroll.py','inspect.py','plan.json','baseline.txt','enrollment.json','exit.txt')){
      if(-not(Test-Path -LiteralPath (Join-Path $volume.root $name) -PathType Leaf)){throw 'MEDIA_RESULT_MISSING'}
      $file=Get-Item -LiteralPath (Join-Path $volume.root $name) -Force -ErrorAction Stop
      if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 131072){throw 'MEDIA_RESULT_BOUND'}
      $bytes=[IO.File]::ReadAllBytes($file.FullName)
      if($record.payloadSha256.PSObject.Properties[$name] -and (Get-Ai09ShaBytes $bytes) -cne $record.payloadSha256.$name){throw 'MEDIA_PAYLOAD_CHANGED'}
      Write-Ai09MediaNew (Join-Path $s.State ('collected-'+$name)) $bytes
    }
  }finally{
    $v=Assert-Ai09MediaVhd $record $false
    if($v.Attached){Hyper-V\Dismount-VHD -Path $s.Media -ErrorAction Stop}
    if((Assert-Ai09MediaVhd $record $false).Attached){throw 'MEDIA_HOST_STILL_MOUNTED'}
  }
  $result=[ordered]@{status='NEW_MEDIA_COLLECTED_NOT_SSH_VERIFIED';runId=$record.runId;authenticatedConnectionVerified=$false;mediaRetained=$true;oldMediaUntouched=$true}
  if($PermitNetwork){$result.network=Complete-Ai09MediaNetwork $record $bundle $AuthorizationReference $ExpiresAt}
  return $result
}
function Invoke-Ai09AccessMedia {
  param([ValidateSet('Verify','Prepare','ResumeEmptyMbr','Collect')]$Mode='Verify',$ExpectedBundleSha256,$AuthorizationReference,$ExpiresAt,[switch]$GuestUnmountConfirmed,[switch]$PermitNetwork,
    [string]$ResumeBindingPath,[string]$ResumeBindingSha256,[string]$CompletionRecordSha256)
  $bundle=Get-Ai09MediaBundle
  if($Mode -eq 'Verify'){return [ordered]@{status='SOURCE_ONLY_NOT_ACTIVATED';bundle=$bundle;scope=(Get-Ai09MediaScope);authenticatedConnectionVerified=$false}}
  if($ExpectedBundleSha256 -cne $bundle.sha256 -or $AuthorizationReference -cnotmatch '^[A-Za-z0-9._:-]{1,128}$'){throw 'APPROVED_BUNDLE_REQUIRED'}
  $locks=New-Object 'Collections.Generic.List[IO.FileStream]'
  try{
    $locked=Get-Ai09MediaBundle $locks
    if($locked.sha256 -cne $ExpectedBundleSha256){throw 'APPROVED_BUNDLE_DRIFT'}
    $request=@{Mode=$Mode;LockedBundle=$locked;AuthorizationReference=$AuthorizationReference;ExpiresAt=$ExpiresAt;GuestUnmountConfirmed=$GuestUnmountConfirmed;PermitNetwork=$PermitNetwork;ResumeBindingPath=$ResumeBindingPath;ResumeBindingSha256=$ResumeBindingSha256;CompletionRecordSha256=$CompletionRecordSha256}
    . (Join-Path $script:Ai09MediaScripts 'ai09-first-access-host.ps1')
    return Invoke-Ai09MediaOperation @request
  }finally{foreach($lock in $locks){$lock.Dispose()}}
}
if($MyInvocation.InvocationName -ne '.'){
  try{Invoke-Ai09AccessMedia @script:Ai09MediaArguments|ConvertTo-Json -Depth 20}catch{Write-Error $_;exit 1}
}
