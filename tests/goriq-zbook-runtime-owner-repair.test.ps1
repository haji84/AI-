Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-runtime-owner-repair.ps1'
if(-not (Test-Path -LiteralPath $source)){throw 'owner-repair-helper-missing'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'owner-repair-parse'}
foreach($name in @('Select-RuntimeOwnerAction','Restore-RuntimeFileOwner')){
  $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if($null -eq $definition){throw 'owner-repair-function-missing'}
  Invoke-Expression $definition.Extent.Text
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if((Select-RuntimeOwnerAction $identity.User.Value $identity.User.Value) -ne 'none'){throw 'current-owner-not-idempotent'}
if((Select-RuntimeOwnerAction 'S-1-5-32-544' $identity.User.Value) -ne 'restore'){throw 'admin-owner-rejected'}
foreach($sid in @('S-1-5-18','S-1-1-0','S-1-5-21-1-2-3-1001')){
  $rejected=$false
  try{$null=Select-RuntimeOwnerAction $sid $identity.User.Value}catch{$rejected=$true}
  if(-not $rejected){throw 'unexpected-owner-accepted'}
}
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('goriq-owner-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$path=Join-Path $fixture 'pointer.bin'
try{
  [IO.File]::WriteAllBytes($path,[byte[]]@(0,1,128,255,13,10))
  $acl=Get-Acl -LiteralPath $path
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  Set-Acl -LiteralPath $path -AclObject $acl
  $beforeHash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  $beforeDacl=(Get-Acl -LiteralPath $path).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
  Restore-RuntimeFileOwner $path $identity.User
  $after=Get-Acl -LiteralPath $path
  if($after.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $identity.User.Value){throw 'owner-not-restored'}
  if($after.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $beforeDacl){throw 'dacl-changed'}
  if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $beforeHash){throw 'bytes-changed'}
  Restore-RuntimeFileOwner $path $identity.User
  Write-Output 'Runtime owner restoration/rejection/idempotency/content/DACL fixtures PASS'
}finally{Remove-Item -LiteralPath $fixture -Recurse -Force}
