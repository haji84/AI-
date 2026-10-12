Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-acl-boundary-repair.ps1'
if(-not (Test-Path -LiteralPath $source)){throw 'boundary-helper-missing'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'boundary-helper-parse'}
foreach($name in @('Import-AclPredicates','Assert-BoundaryReader','Assert-SameSnapshot','Write-BoundaryBackup','New-BoundaryDacl','Initialize-BoundaryFileInfo','Get-BoundarySnapshot','Get-ExpectedSnapshot','Assert-BoundaryIdentity','Restore-BoundaryBaseline')){
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
$record=[pscustomobject]@{path='fixture';descriptor='baseline';directory=$true;identity='original'}
Assert-SameSnapshot @($record) @($record)
foreach($other in @(@(),@([pscustomobject]@{path='fixture';descriptor='changed';directory=$true;identity='original'}),
  @([pscustomobject]@{path='other';descriptor='baseline';directory=$true;identity='original'}),
  @([pscustomobject]@{path='fixture';descriptor='baseline';directory=$true;identity='replacement'}))){
  $rejected=$false
  try{Assert-SameSnapshot @($record) $other}catch{$rejected=$true}
  if(-not $rejected){throw 'changed-snapshot-accepted'}
}
Write-Output 'Boundary ACL decision fixtures PASS (no production mutation)'
if($env:OS -ne 'Windows_NT'){return}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$baselineComparer=${function:Assert-SameSnapshot}
function Assert-SameSnapshot([object[]]$before,[object[]]$after){
  try{& $baselineComparer $before $after}catch{
    for($i=0;$i -lt [Math]::Min($before.Count,$after.Count);$i++){
      if($before[$i].descriptor -cne $after[$i].descriptor -or $before[$i].identity -cne $after[$i].identity -or $before[$i].path -cne $after[$i].path){
        @{fixtureSurface=$before[$i].path.Substring($fixture.Length);
          sameIdentity=($before[$i].identity -ceq $after[$i].identity);samePath=($before[$i].path -ceq $after[$i].path);
          expected=$before[$i].descriptor.Replace($identity.User.Value,'fixture-owner');
          actual=$after[$i].descriptor.Replace($identity.User.Value,'fixture-owner')} | ConvertTo-Json -Compress
      }
    }
    throw
  }
}
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
  $parent.AddAuditRule((New-Object Security.AccessControl.FileSystemAuditRule(
    $identity.User,'ReadData','ContainerInherit,ObjectInherit','None','Success')))
  # Raw ACEs pin masks that FileSystemAccessRule constructors would normalize.
  $rawParent=New-Object Security.AccessControl.RawSecurityDescriptor($parent.GetSecurityDescriptorSddlForm(
    [Security.AccessControl.AccessControlSections]::All))
  $rawDeny=New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]3,
    [Security.AccessControl.AceQualifier]::AccessDenied,0x100002,
    (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-546')),$false,$null)
  $rawAllow=New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]1,
    [Security.AccessControl.AceQualifier]::AccessAllowed,0x20089,
    (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-547')),$false,$null)
  $rawParent.DiscretionaryAcl.InsertAce(0,$rawDeny)
  $rawParent.DiscretionaryAcl.InsertAce($rawParent.DiscretionaryAcl.Count,$rawAllow)
  $parent.SetSecurityDescriptorSddlForm($rawParent.GetSddlForm([Security.AccessControl.AccessControlSections]::All))
  Set-Acl -LiteralPath $fixture -AclObject $parent
  $roots=@((Join-Path $fixture 'production'),(Join-Path $fixture 'releases'))
  foreach($root in $roots){
    $null=New-Item -ItemType Directory -Path $root
    $child=Join-Path $root 'child';$null=New-Item -ItemType Directory -Path $child
    [IO.File]::WriteAllText((Join-Path $child 'unchanged.txt'),'fixture bytes')
    $childAcl=Get-Acl -LiteralPath $child -Audit
    $childAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity.User,'ReadAndExecute','Allow')))
    $deny=New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-546')),'Write','Deny')
    $childAcl.AddAccessRule($deny)
    Set-Acl -LiteralPath $child -AclObject $childAcl
    $protected=Join-Path $child 'protected'
    $null=New-Item -ItemType Directory -Path $protected
    $protectedAcl=Get-Acl -LiteralPath $protected -Audit
    $protectedAcl.SetAccessRuleProtection($true,$true)
    Set-Acl -LiteralPath $protected -AclObject $protectedAcl
    [IO.File]::WriteAllText((Join-Path $protected 'retained.txt'),'protected bytes')
  }
  $before=Get-BoundarySnapshot $roots
  foreach($root in $roots){Assert-BoundaryIdentity $root @($before | Where-Object {$_.path -ceq $root})[0]}
  $sections=[Security.AccessControl.AccessControlSections]::All
  $expected=Get-ExpectedSnapshot $before $roots $reader
  foreach($root in $roots){
    $narrow=New-BoundaryDacl (Get-Acl -LiteralPath $root -Audit) $reader
    $rawNarrow=New-Object Security.AccessControl.RawSecurityDescriptor($narrow.Sddl)
    foreach($mask in @(0x100002,0x20089)){
      if(-not @($rawNarrow.DiscretionaryAcl | Where-Object {$_.AccessMask -eq $mask}).Count){throw 'raw-mask-normalized'}
    }
  }
  $parentBefore=(Get-Acl -LiteralPath $fixture).Sddl
  foreach($root in $roots){
    $acl=Get-Acl -LiteralPath $root -Audit
    $narrow=New-BoundaryDacl $acl $reader
    Set-Acl -LiteralPath $root -AclObject $narrow
  }
  $actual=Get-BoundarySnapshot $roots
  for($i=0;$i -lt $expected.Count;$i++){
    if($expected[$i].descriptor -cne $actual[$i].descriptor){
      @{fixtureSurface=$expected[$i].path.Substring($fixture.Length);
        expected=$expected[$i].descriptor.Replace($identity.User.Value,'fixture-owner');
        actual=$actual[$i].descriptor.Replace($identity.User.Value,'fixture-owner')} | ConvertTo-Json -Compress
    }
  }
  Assert-SameSnapshot $expected $actual
  Write-Output 'Boundary expected descriptor projection PASS'
  foreach($root in $roots){
    $acl=Get-Acl -LiteralPath $root
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
  Write-Output 'Boundary full restore PASS'
  Assert-SameSnapshot $before (Get-BoundarySnapshot $roots)
  Write-Output 'Boundary explicit reader refusal restoration PASS'
  # Explicit reader grants on a reachable descendant are outside this remedy.
  $child=Join-Path $roots[0] 'child'
  $childAcl=Get-Acl -LiteralPath $child -Audit
  $childAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($reader)),'ReadAndExecute','Allow')))
  Set-Acl -LiteralPath $child -AclObject $childAcl
  $rejected=$false
  try{$null=Get-ExpectedSnapshot (Get-BoundarySnapshot $roots) $roots $reader}catch{
    if($_.Exception.Message -ne 'BOUNDARY_REJECTED'){throw};$rejected=$true
  }
  if(-not $rejected){throw 'explicit-descendant-reader-not-rejected'}
  $originalChild=@($before | Where-Object {$_.path -ceq $child})[0]
  $childAcl=Get-Acl -LiteralPath $child -Audit
  $childAcl.SetSecurityDescriptorSddlForm($originalChild.descriptor,[Security.AccessControl.AccessControlSections]::Access)
  Set-Acl -LiteralPath $child -AclObject $childAcl
  Assert-SameSnapshot $before (Get-BoundarySnapshot $roots)
  # A hard link outside the two roots shares its security descriptor: refuse it.
  $alias=Join-Path $fixture 'outside-alias.txt'
  $file=Join-Path $roots[0] 'child\unchanged.txt'
  $null=New-Item -ItemType HardLink -Path $alias -Target $file
  try{
    $rejected=$false
    try{$null=Get-BoundarySnapshot $roots}catch{
      if($_.Exception.Message -ne 'HARDLINK_REJECTED'){throw};$rejected=$true
    }
    if(-not $rejected){throw 'hardlink-not-rejected'}
  }finally{[IO.File]::Delete($alias)}
  Write-Output 'Boundary hardlink refusal PASS'
  # A replacement with identical ACL must never receive the old boundary DACL.
  $moved=$roots[0]+'-moved'
  [IO.Directory]::Move($roots[0],$moved)
  $null=New-Item -ItemType Directory -Path $roots[0]
  $replacementBefore=(Get-Acl -LiteralPath $roots[0] -Audit).Sddl
  try{
    $rejected=$false
    try{Restore-BoundaryBaseline $before $roots}catch{
      if($_.Exception.Message -ne 'BASELINE_CHANGED'){throw};$rejected=$true
    }
    if(-not $rejected){throw 'replacement-directory-not-rejected'}
    if((Get-Acl -LiteralPath $roots[0] -Audit).Sddl -cne $replacementBefore){throw 'replacement-directory-mutated'}
  }finally{
    [IO.Directory]::Delete($roots[0])
    [IO.Directory]::Move($moved,$roots[0])
  }
  Write-Output 'Boundary replacement refusal PASS'
  # Junctions must be rejected before inspecting/traversing their targets.
  $link=Join-Path $roots[0] 'junction'
  $null=New-Item -ItemType Junction -Path $link -Target $roots[1]
  try{
    $rejected=$false
    try{$null=Get-BoundarySnapshot $roots}catch{
      if($_.Exception.Message -ne 'REPARSE_REJECTED'){throw};$rejected=$true
    }
    if(-not $rejected){throw 'junction-not-rejected'}
  }finally{[IO.Directory]::Delete($link)}
  Write-Output 'Boundary junction refusal PASS'
  # A failure after only the first boundary was written must restore both trees.
  Set-Acl -LiteralPath $roots[0] -AclObject (New-BoundaryDacl (Get-Acl -LiteralPath $roots[0] -Audit) $reader)
  Restore-BoundaryBaseline $before $roots
  Assert-SameSnapshot $before (Get-BoundarySnapshot $roots)
  Write-Output 'Windows native boundary inheritance/content/Deny/partial-rollback fixtures PASS'
}finally{Remove-Item -LiteralPath $fixture -Recurse -Force}
