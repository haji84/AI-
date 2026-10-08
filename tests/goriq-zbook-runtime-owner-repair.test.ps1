Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-runtime-owner-repair.ps1'
if(-not (Test-Path -LiteralPath $source)){throw 'owner-repair-helper-missing'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'owner-repair-parse'}
foreach($name in @('Select-RuntimeOwnerAction','Restore-RuntimeFileOwner','Assert-ApprovedRuntimeDacl','Restore-OriginalRuntimeDacl')){
  $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if($null -eq $definition){throw 'owner-repair-function-missing'}
  Invoke-Expression $definition.Extent.Text
}
# Exercise the actual production DPAPI-to-JSON assignment on PowerShell5.1.
# ConvertFrom-Json emits a JSON array as one pipeline object on this version.
$assignment=$ast.Find({param($n)
  $n -is [Management.Automation.Language.AssignmentStatementAst] -and
  $n.Left -is [Management.Automation.Language.VariableExpressionAst] -and
  $n.Left.VariablePath.UserPath -eq 'originalEntries' -and
  $n.Extent.Text.Contains('ConvertFrom-Json')
},$true)
if($null -eq $assignment){throw 'original-baseline-parser-missing'}
$originalSecure=ConvertTo-SecureString '[{"surface":"protected-config"},{"surface":"native-launcher"}]' -AsPlainText -Force
Invoke-Expression $assignment.Extent.Text
if($originalEntries -isnot [array] -or $originalEntries.Count -ne 2 -or
  $originalEntries[0].surface -cne 'protected-config' -or $originalEntries[1].surface -cne 'native-launcher'){
  throw 'original-baseline-json-array-shape'
}
$countGuard=$ast.Find({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text.Contains('$originalEntries.Count')},$true)
if($null -eq $countGuard){throw 'original-baseline-count-guard-missing'}
foreach($json in @('null','[]','{"surface":"protected-config"}','[{"surface":"protected-config"}]','[{},{},{}]')){
  $originalSecure=ConvertTo-SecureString $json -AsPlainText -Force
  $rejected=$false
  try{
    Invoke-Expression $assignment.Extent.Text
    Invoke-Expression $countGuard.Extent.Text
  }catch{$rejected=$true}
  if(-not $rejected){throw 'invalid-baseline-record-count-accepted'}
}
$originalSecure=ConvertTo-SecureString '[{"surface":"protected-config"},{"surface":"native-launcher"}]' -AsPlainText -Force
Invoke-Expression $assignment.Extent.Text
Invoke-Expression $countGuard.Extent.Text
$originalSecure=$null;$originalEntries=$null
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
  # Reproduce production: protected Owner/SYSTEM parent, inherited entries
  # plus a file-specific explicit Owner entry. Inherited-only fixtures miss loss.
  $parentAcl=New-Object Security.AccessControl.DirectorySecurity
  $parentAcl.SetOwner($identity.User)
  $parentAcl.SetAccessRuleProtection($true,$false)
  foreach($sid in @($identity.User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $parentAcl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $fixture -AclObject $parentAcl
  [IO.File]::WriteAllBytes($path,[byte[]]@(0,1,128,255,13,10))
  $acl=Get-Acl -LiteralPath $path
  $explicit=New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'ReadAndExecute','Allow')
  $acl.AddAccessRule($explicit)
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
  # Recover the exact approved pre-repair DACL after a simulated lost explicit ACE.
  $acl=Get-Acl -LiteralPath $path
  $acl.RemoveAccessRuleSpecific($explicit)
  Set-Acl -LiteralPath $path -AclObject $acl
  if((Get-Acl -LiteralPath $path).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ceq $beforeDacl){throw 'lost-ace-fixture-not-reproduced'}
  Restore-OriginalRuntimeDacl $path $identity.User $beforeDacl
  $after=Get-Acl -LiteralPath $path
  if($after.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $beforeDacl){throw 'original-dacl-not-restored'}
  if($after.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $identity.User.Value){throw 'owner-changed-during-dacl-recovery'}
  if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $beforeHash){throw 'bytes-changed-during-dacl-recovery'}
  $rejected=$false
  try{Restore-OriginalRuntimeDacl $path $identity.User 'D:(A;;FA;;;WD)'}catch{$rejected=$true}
  if(-not $rejected){throw 'unapproved-dacl-accepted'}
  if((Get-Acl -LiteralPath $path).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $beforeDacl){throw 'rejected-dacl-mutated-target'}
  Write-Output 'Runtime owner restoration/rejection/idempotency/content/DACL fixtures PASS'
}finally{Remove-Item -LiteralPath $fixture -Recurse -Force}
