Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne 'Win32NT'){throw 'WINDOWS_ACL_FIXTURE_REQUIRES_WINDOWS'}
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
Write-Output ("AI09_ACCESS_MEDIA_WINDOWS_ACL_FIXTURES_PASS assertions="+$script:Assertions)
