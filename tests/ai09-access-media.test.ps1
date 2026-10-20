Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../scripts/ai09-access-media.ps1'
if (-not (Test-Path -LiteralPath $source)) {throw 'ASSERT:NEW_ACCESS_MEDIA_EXECUTOR_REQUIRED'}
. $source
$script:Assertions=0
function Yes($Value,$Label) {$script:Assertions++;if(-not $Value){throw "ASSERT:$Label"}}
function Reject($Action,$Code) {try{& $Action;throw 'ASSERT:EXPECTED_REFUSAL'}catch{Yes ($_.Exception.Message -ceq $Code) $Code}}
$scope=Get-Ai09MediaScope
Yes ($scope.Media -ceq 'C:\Users\qq113\.codex\AI09-ACCESS-1219-20261020.vhdx') 'public media uses owner-controlled parent outside private credentials'
Yes ($scope.Media -cne 'C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx') 'old seed preserved'
Yes ($scope.Slot -eq 3) 'explicit new slot'
$rootDisk=[pscustomobject]@{Path='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx';ControllerType='SCSI';ControllerNumber=0;ControllerLocation=0}
$media=[pscustomobject]@{Path=$scope.Media;ControllerType='SCSI';ControllerNumber=0;ControllerLocation=3}
Assert-Ai09MediaDrives @($rootDisk) @() $false
Assert-Ai09MediaDrives @($rootDisk,$media) @() $true
Reject {Assert-Ai09MediaDrives @($rootDisk,$media) @() $false} 'MEDIA_TOPOLOGY_DRIFT'
Reject {Assert-Ai09MediaDrives @($rootDisk) @([pscustomobject]@{ControllerNumber=0;ControllerLocation=3}) $false} 'MEDIA_SLOT_OCCUPIED'
Reject {Assert-Ai09MediaDrives @($rootDisk,[pscustomobject]@{Path='C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx';ControllerType='SCSI';ControllerNumber=0;ControllerLocation=2}) @() $false} 'MEDIA_TOPOLOGY_DRIFT'
$p=[ordered]@{version=1;issue=1219;runId=('a'*32);authorizationRef='owner-1219';expiresAt=[DateTimeOffset]::UtcNow.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');publicKey='ssh-ed25519 fixture';executorSha256=('b'*64)}
$wrapper=New-Ai09MediaWrapper $p 'CA77-1234' '12345678-01' @{'enroll.py'=('b'*64);'plan.json'=('c'*64);'inspect.py'=('d'*64)}
Yes ($wrapper.Contains('/usr/bin/python3')) 'fixed native interpreter'
Yes ($wrapper.Contains('CA77-1234') -and $wrapper.Contains('12345678-01')) 'volume and partition identity pinned'
Yes ($wrapper.Contains('A09_UNMOUNTED')) 'unmount success marker'
Yes ($wrapper.Contains('findmnt') -and $wrapper.Contains('umount')) 'device mount verification'
Yes (-not $wrapper.Contains('AI09-SEED')) 'no old-media operation'
Reject {New-Ai09MediaWrapper $p 'CA77-1234' '12345678-01' @{'enroll.py'='bad'}} 'PAYLOAD_HASH_INVALID'
$native=[IO.File]::ReadAllText($source)
Yes ($native.Contains('-ReadOnly')) 'collection cannot write guest filesystem'
Yes (-not ($native -match 'Remove-Item|Remove-VMHardDiskDrive.*\*|Stop-VM|Restart-VM|Set-VMFirmware|Set-VMProcessor|Set-VMMemory')) 'no destructive or unrelated VM operations'
# Exercise real ACL predicates with metadata-only fakes; no ACL is changed and
# no private-key bytes are opened or hashed.
$current=[Security.Principal.WindowsIdentity]::GetCurrent()
$script:MediaTestAcl=[pscustomobject]@{Owner=$current.Name;Access=@([pscustomobject]@{AccessControlType='Allow';FileSystemRights=[Security.AccessControl.FileSystemRights]::FullControl;IdentityReference=$current.User})}
function Get-Acl {param($LiteralPath) return $script:MediaTestAcl}
function Get-Ai09SafePath {param($Path) Assert-Ai09MediaAllowedWriter $Path;return $Path}
Assert-Ai09MediaAllowedWriter $source
Assert-Ai09MediaPrivateKeyMetadata $source
Yes $true 'owner-only metadata accepted without reading content'
$script:MediaTestAcl.Access+=@([pscustomobject]@{AccessControlType='Allow';FileSystemRights=[Security.AccessControl.FileSystemRights]::Read;IdentityReference=(New-Object Security.Principal.SecurityIdentifier('S-1-1-0'))})
Assert-Ai09MediaAllowedWriter $source
Reject {Assert-Ai09MediaPrivateKeyMetadata $source} 'MEDIA_PRIVATE_KEY_METADATA_INVALID'
$script:MediaTestAcl.Access[1].FileSystemRights=[Security.AccessControl.FileSystemRights]::Write
Reject {Assert-Ai09MediaAllowedWriter $source} 'OWNER_PATH_REQUIRED'
Write-Output ("AI09_ACCESS_MEDIA_FIXTURES_PASS assertions="+$script:Assertions)
