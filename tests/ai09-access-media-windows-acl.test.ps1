Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne 'Win32NT'){throw 'WINDOWS_ACL_FIXTURE_REQUIRES_WINDOWS'}
. (Join-Path $PSScriptRoot '../scripts/ai09-first-access-host.ps1')
$script:RealMediaSafePath=(Get-Command Get-Ai09SafePath).ScriptBlock
$source=Join-Path $PSScriptRoot '../scripts/ai09-access-media.ps1'
if(-not(Test-Path -LiteralPath $source)){throw 'ASSERT:NEW_ACCESS_MEDIA_EXECUTOR_REQUIRED'}
. $source
$script:Assertions=0
function Yes($Value,$Label) {$script:Assertions++;if(-not $Value){throw "ASSERT:$Label"}}
function Reject($Action,$Code) {try{& $Action;throw 'ASSERT:EXPECTED_REFUSAL'}catch{Yes ($_.Exception.Message -ceq $Code) $Code}}
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
# The protected witness uses the same real safe-path/ACL/locked-reader gates.
# This temporary is public fixture text, never an actual credential or witness.
Set-Item -LiteralPath function:Get-Ai09SafePath -Value $script:RealMediaSafePath
$script:MediaTestAcl.Access=@($script:MediaTestAcl.Access[0])
$witness=Join-Path ([IO.Path]::GetTempPath()) ('ai09-public-witness-'+[guid]::NewGuid().ToString('N')+'.json')
[IO.File]::WriteAllText($witness,'{"fixture":"PUBLIC_WITNESS_ONLY"}')
$witnessHash=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($witness))
$locks=New-Object 'Collections.Generic.List[IO.FileStream]'
try{
  Yes ((Read-Ai09MediaLocked $witness $witnessHash $locks) -ceq '{"fixture":"PUBLIC_WITNESS_ONLY"}') 'real protected witness reader accepts safe metadata and exact bytes'
  $denied=$false;$writer=$null
  try{$writer=[IO.File]::Open($witness,'Open','Write','None')}catch [IO.IOException]{$denied=$true}finally{if($writer){$writer.Dispose()}}
  Yes $denied 'real witness read lock prevents replacement writes'
  Reject {Read-Ai09MediaLocked $witness ('f'*64) $locks} 'MEDIA_ORIGIN_HASH_DRIFT'
  $script:MediaTestAcl.Access+=@([pscustomobject]@{AccessControlType='Allow';FileSystemRights=[Security.AccessControl.FileSystemRights]::Write;IdentityReference=(New-Object Security.Principal.SecurityIdentifier('S-1-1-0'))})
  Reject {Read-Ai09MediaLocked $witness $witnessHash $locks} 'OWNER_PATH_REQUIRED'
  $script:MediaTestAcl.Access=@($script:MediaTestAcl.Access[0])
  $script:AliasedWitness=$witness
  function Get-Item {param($LiteralPath,[switch]$Force,$ErrorAction)
    if($LiteralPath -ceq $script:AliasedWitness){return [pscustomobject]@{Attributes=[IO.FileAttributes]::ReparsePoint;LinkType='SymbolicLink'}}
    return Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force -ErrorAction Stop
  }
  Reject {Read-Ai09MediaLocked $witness $witnessHash $locks} 'PATH_ALIAS'
}finally{foreach($lock in $locks){$lock.Dispose()}}
Write-Output ("AI09_ACCESS_MEDIA_WINDOWS_ACL_FIXTURES_PASS assertions="+$script:Assertions)
