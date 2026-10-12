Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-acl-boundary-repair.ps1'
if(-not (Test-Path -LiteralPath $source)){throw 'boundary-helper-missing'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'boundary-helper-parse'}
foreach($name in @('Import-AclPredicates','Assert-BoundaryReader','Assert-SameSnapshot','Write-BoundaryBackup','New-BoundaryDacl','Get-BoundarySnapshot','Restore-BoundaryBaseline')){
  $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if($null -eq $definition){throw ('boundary-function-missing: '+$name)}
  Invoke-Expression $definition.Extent.Text
}
Import-AclPredicates (Join-Path $PSScriptRoot '..\scripts\goriq-zbook-owner-acl-repair.ps1')
if(-not (Test-KnownReadOnlyRights 0x1200A9) -or (Test-KnownReadOnlyRights 0x1201BF)){
  throw 'imported-selector-parameters-lost'
}
function ReaderFact([hashtable]$changes){
  $fact=@{accessType='Allow';approvedPrincipal=$false;sidValue='reader';inherited=$true;
    rights=0x1200A9;containerInherit=$true;objectInherit=$true;inheritanceOnly=$false}
  foreach($key in $changes.Keys){$fact[$key]=$changes[$key]}
  return [pscustomobject]$fact
}
Assert-BoundaryReader @((ReaderFact @{})) 'reader' $false
foreach($changes in @(@{sidValue='other'},@{inherited=$false},@{rights=0x1201BF},@{rights=0x20089},
  @{containerInherit=$false},@{objectInherit=$false},@{inheritanceOnly=$true})){
  $rejected=$false
  try{Assert-BoundaryReader @((ReaderFact $changes)) 'reader' $false}catch{$rejected=$true}
  if(-not $rejected){throw 'unsafe-boundary-reader-accepted'}
}
foreach($case in @(@{facts=@();protected=$false},@{facts=@((ReaderFact @{}),(ReaderFact @{}));protected=$false},
  @{facts=@((ReaderFact @{}));protected=$true})){
  $rejected=$false
  try{Assert-BoundaryReader $case.facts 'reader' $case.protected}catch{$rejected=$true}
  if(-not $rejected){throw 'unsafe-boundary-shape-accepted'}
}
$record=[pscustomobject]@{path='fixture';descriptor='baseline';directory=$true}
Assert-SameSnapshot @($record) @($record)
foreach($other in @(@(),@([pscustomobject]@{path='fixture';descriptor='changed';directory=$true}),
  @([pscustomobject]@{path='other';descriptor='baseline';directory=$true}))){
  $rejected=$false
  try{Assert-SameSnapshot @($record) $other}catch{$rejected=$true}
  if(-not $rejected){throw 'changed-snapshot-accepted'}
}
Write-Output 'Boundary ACL decision fixtures PASS (no production mutation)'
if($env:OS -ne 'Windows_NT'){return}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('goriq-boundary-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
try{
  $backup=Join-Path $fixture 'baseline.dpapi'
  $largePlain='fixture-baseline-'*6000
  Write-BoundaryBackup $backup $largePlain
  $rejected=$false
  try{Write-BoundaryBackup $backup 'replacement'}catch{$rejected=$true}
  if(-not $rejected){throw 'backup-overwrite-accepted'}
  $parent=New-Object Security.AccessControl.DirectorySecurity
  $parent.SetOwner($identity.User)
  $parent.SetAccessRuleProtection($true,$false)
  foreach($sid in @($identity.User.Value,'S-1-5-18')){
    $parent.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  }
  $reader='S-1-1-0'
  $parent.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($reader)),'ReadAndExecute,Synchronize','ContainerInherit,ObjectInherit','None','Allow')))
  Set-Acl -LiteralPath $fixture -AclObject $parent
  $roots=@((Join-Path $fixture 'production'),(Join-Path $fixture 'releases'))
  foreach($root in $roots){
    $null=New-Item -ItemType Directory -Path $root
    $child=Join-Path $root 'child';$null=New-Item -ItemType Directory -Path $child
    [IO.File]::WriteAllText((Join-Path $child 'unchanged.txt'),'fixture bytes')
    $childAcl=Get-Acl -LiteralPath $child
    $childAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'ReadAndExecute','Allow')))
    $deny=New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-546')),'Write','Deny')
    $childAcl.AddAccessRule($deny)
    Set-Acl -LiteralPath $child -AclObject $childAcl
  }
  $before=Get-BoundarySnapshot $roots
  $parentBefore=(Get-Acl -LiteralPath $fixture).Sddl
  foreach($root in $roots){
    $acl=Get-Acl -LiteralPath $root
    $narrow=New-BoundaryDacl $acl $reader
    Set-Acl -LiteralPath $root -AclObject $narrow
  }
  foreach($entry in (Get-BoundarySnapshot $roots)){
    $acl=Get-Acl -LiteralPath $entry.path
    if(@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {
      $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -eq $reader}).Count){throw 'reader-still-inherited'}
  }
  if((Get-Acl -LiteralPath $fixture).Sddl -cne $parentBefore){throw 'ancestor-mutated'}
  foreach($root in $roots){
    if([IO.File]::ReadAllText((Join-Path $root 'child\unchanged.txt')) -cne 'fixture bytes'){throw 'fixture-content-changed'}
    if(-not @((Get-Acl -LiteralPath (Join-Path $root 'child')).Access | Where-Object {
      $_.AccessControlType -eq 'Deny' -and -not $_.IsInherited}).Count){throw 'deny-lost'}
  }
  Restore-BoundaryBaseline $before $roots
  Assert-SameSnapshot $before (Get-BoundarySnapshot $roots)
  # A failure after only the first boundary was written must restore both trees.
  Set-Acl -LiteralPath $roots[0] -AclObject (New-BoundaryDacl (Get-Acl -LiteralPath $roots[0]) $reader)
  Restore-BoundaryBaseline $before $roots
  Assert-SameSnapshot $before (Get-BoundarySnapshot $roots)
  Write-Output 'Windows native boundary inheritance/content/Deny/partial-rollback fixtures PASS'
}finally{Remove-Item -LiteralPath $fixture -Recurse -Force}
