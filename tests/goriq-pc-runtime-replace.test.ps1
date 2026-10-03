Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Extract only byte replacement; never run production updater.
$tokens=$null;$errors=$null
$source=Join-Path $PSScriptRoot '..\scripts\goriq-pc-runtime-refresh-windows.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'runtime-script-parse'}
$definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Replace-Bytes'},$true)
if($null -eq $definition){throw 'replace-function-missing'}
Invoke-Expression $definition.Extent.Text
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('goriq-replace-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$path=Join-Path $fixture 'pointer.bin'
$before=[byte[]]@(0,1,128,255,13,10)
$after=[byte[]]@(255,0,2,3)
try {
  [IO.File]::WriteAllBytes($path,$before)
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $acl=Get-Acl -LiteralPath $path
  $acl.SetOwner($identity.User)
  Set-Acl -LiteralPath $path -AclObject $acl
  $sections=[Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access
  $securityBefore=(Get-Acl -LiteralPath $path).GetSecurityDescriptorSddlForm($sections)
  Replace-Bytes $path $after
  if((Get-Acl -LiteralPath $path).GetSecurityDescriptorSddlForm($sections) -cne $securityBefore){throw 'activate-owner-or-dacl-mismatch'}
  if([Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) -cne [Convert]::ToBase64String($after)){throw 'activate-bytes-mismatch'}
  Replace-Bytes $path $before
  if([Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) -cne [Convert]::ToBase64String($before)){throw 'rollback-bytes-mismatch'}
  if((Get-Acl -LiteralPath $path).GetSecurityDescriptorSddlForm($sections) -cne $securityBefore){throw 'rollback-owner-or-dacl-mismatch'}

  # Invoke the actual release-directory creation statement in isolation.
  # Removing Owner normalization must fail on elevated Windows creation.
  $releaseRoot=Join-Path $fixture 'release'
  $creation=$ast.Find({param($n)
    $n -is [Management.Automation.Language.PipelineAst] -and
    ($n.Extent.Text -ceq 'New-Item -ItemType Directory -Path $releaseRoot | Out-Null' -or
     $n.Extent.Text -ceq 'New-OwnedReleaseDirectory $releaseRoot $identity.User')
  },$true)
  if($null -eq $creation){throw 'release-creation-statement-missing'}
  $creator=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'New-OwnedReleaseDirectory'},$true)
  $nativeCreator=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Restore-ReleaseDirectoryOwner'},$true)
  if($null -ne $nativeCreator){Invoke-Expression $nativeCreator.Extent.Text}
  if($null -ne $creator){Invoke-Expression $creator.Extent.Text}
  Invoke-Expression $creation.Extent.Text
  if((Get-Acl -LiteralPath $releaseRoot).GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $identity.User.Value){throw 'new-release-owner-mismatch'}
  Write-Output 'New release directory current Owner PASS'


  # Existing directory recovery must preserve exact DACL and child metadata.
  $repairSource=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-release-owner-repair.ps1'
  if(-not (Test-Path -LiteralPath $repairSource)){throw 'release-owner-repair-helper-missing'}
  $repairAst=[Management.Automation.Language.Parser]::ParseFile($repairSource,[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'release-owner-repair-parse'}
  foreach($name in @('Restore-ReleaseDirectoryOwner','Assert-ReleaseOwnerAction')){
    $function=$repairAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    if($null -eq $function){throw 'release-owner-repair-function-missing'}
    Invoke-Expression $function.Extent.Text
  }
  $acl=Get-Acl -LiteralPath $releaseRoot
  $acl.SetAccessRuleProtection($true,$true)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'ReadAndExecute','Allow')))
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  Set-Acl -LiteralPath $releaseRoot -AclObject $acl
  $child=Join-Path $releaseRoot 'unchanged-child.bin'
  [IO.File]::WriteAllBytes($child,$before)
  $childSecurity=(Get-Acl -LiteralPath $child).GetSecurityDescriptorSddlForm($sections)
  $rootDacl=(Get-Acl -LiteralPath $releaseRoot).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
  Assert-ReleaseOwnerAction 'S-1-5-32-544' $identity.User.Value
  Restore-ReleaseDirectoryOwner $releaseRoot $identity.User
  if((Get-Acl -LiteralPath $releaseRoot).GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $identity.User.Value){throw 'release-repair-owner-mismatch'}
  if((Get-Acl -LiteralPath $releaseRoot).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $rootDacl){throw 'release-repair-dacl-mismatch'}
  if((Get-Acl -LiteralPath $child).GetSecurityDescriptorSddlForm($sections) -cne $childSecurity -or
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($child)) -cne [Convert]::ToBase64String($before)){throw 'release-repair-child-changed'}
  Restore-ReleaseDirectoryOwner $releaseRoot $identity.User
  foreach($owner in @('S-1-5-18','S-1-1-0')){
    $refused=$false
    try{Assert-ReleaseOwnerAction $owner $identity.User.Value}catch{$refused=$true}
    if(-not $refused){throw 'unapproved-release-owner-accepted'}
  }
  $refused=$false
  try{Invoke-Expression $creation.Extent.Text}catch{$refused=$true}
  if(-not $refused){throw 'existing-release-mutated'}
  Write-Output 'Release directory Owner recovery, exact DACL, child preservation and refusal PASS'


  # Production-shaped parent: protected Owner/SYSTEM only; live release inherits.
  $strictParent=Join-Path $fixture 'strict-parent'
  $null=New-Item -ItemType Directory -Path $strictParent
  $parentAcl=New-Object Security.AccessControl.DirectorySecurity
  $parentAcl.SetOwner($identity.User)
  $parentAcl.SetAccessRuleProtection($true,$false)
  foreach($sid in @($identity.User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
    $parentAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  }
  Set-Acl -LiteralPath $strictParent -AclObject $parentAcl
  $releaseRoot=Join-Path $strictParent 'release'
  Invoke-Expression $creation.Extent.Text
  $liveAcl=Get-Acl -LiteralPath $releaseRoot
  if($liveAcl.AreAccessRulesProtected -or @($liveAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($identity.User.Value,'S-1-5-18')}).Count){throw 'new-release-native-boundary'}
  $liveAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'ReadAndExecute','Allow')))
  $liveAcl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  Set-Acl -LiteralPath $releaseRoot -AclObject $liveAcl
  $child=Join-Path $releaseRoot 'child.bin'
  [IO.File]::WriteAllBytes($child,$before)
  $childSecurity=(Get-Acl -LiteralPath $child).GetSecurityDescriptorSddlForm($sections)
  $liveAcl=Get-Acl -LiteralPath $releaseRoot
  if($liveAcl.AreAccessRulesProtected -or -not @($liveAcl.Access | Where-Object {$_.IsInherited}).Count -or -not @($liveAcl.Access | Where-Object {-not $_.IsInherited}).Count){throw 'inherited-explicit-fixture-invalid'}
  $rootDacl=$liveAcl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
  Restore-ReleaseDirectoryOwner $releaseRoot $identity.User
  $liveAcl=Get-Acl -LiteralPath $releaseRoot
  if($liveAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $identity.User.Value -or
    $liveAcl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $rootDacl -or
    (Get-Acl -LiteralPath $child).GetSecurityDescriptorSddlForm($sections) -cne $childSecurity -or
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($child)) -cne [Convert]::ToBase64String($before)){throw 'inherited-release-recovery-mismatch'}
  Write-Output 'Production-shaped inherited/explicit release DACL and child preservation PASS'

  Write-Output 'Atomic activation and rollback byte fixtures PASS'
} finally {
  # Remove only this uniquely created disposable fixture.
  Remove-Item -LiteralPath $fixture -Recurse -Force
}
