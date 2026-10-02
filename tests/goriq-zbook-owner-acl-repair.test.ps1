Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\\scripts\\goriq-zbook-owner-acl-repair.ps1'
if(-not (Test-Path -LiteralPath $source)){throw 'repair-script-missing'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'repair-script-parse'}
$downstream=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -eq 'Assert-InheritedCandidate'},$true)
if($null -eq $downstream){throw 'downstream-selector-missing'}
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -eq 'Select-RepairCandidate'},$true)
if($null -eq $definition){throw 'candidate-selector-missing'}
$backupGuard=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -eq 'Assert-ExactBackup'},$true)
if($null -eq $backupGuard){throw 'backup-guard-missing'}
$backupOwnerSelector=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -eq 'Select-BackupOwnerAction'},$true)
if($null -eq $backupOwnerSelector){throw 'backup-owner-selector-missing'}
Invoke-Expression $definition.Extent.Text
Invoke-Expression $downstream.Extent.Text
Invoke-Expression $backupGuard.Extent.Text
Invoke-Expression $backupOwnerSelector.Extent.Text
function Fact([hashtable]$change){
  $base=@{accessType='Allow';approvedPrincipal=$false;inherited=$false;translatable=$true;
    wellKnown=$false;accountSid=$true;sameAccountDomain=$true;tokenMember=$false;knownReadOnlyRights=$true;
    containerInherit=$true;objectInherit=$true;inheritanceOnly=$false;sidValue='principal-1';rule='fixture-rule'}
  foreach($key in $change.Keys){$base[$key]=$change[$key]}
  return [pscustomobject]$base
}
$owner=Fact @{approvedPrincipal=$true;rule='owner'}
$valid=Fact @{}
if((Select-RepairCandidate @($owner,$valid)).rule -ne 'fixture-rule'){throw 'valid-candidate-rejected'}
foreach($bad in @(
  (Fact @{inherited=$true}),(Fact @{translatable=$false}),(Fact @{wellKnown=$true}),(Fact @{accountSid=$false}),
  (Fact @{sameAccountDomain=$false}),(Fact @{tokenMember=$true}),(Fact @{knownReadOnlyRights=$false}),
  (Fact @{containerInherit=$false}),(Fact @{objectInherit=$false}),(Fact @{inheritanceOnly=$true}))){
  $rejected=$false
  try{$null=Select-RepairCandidate @($owner,$bad)}catch{if($_.Exception.Message -ne 'ACL_CANDIDATE_REJECTED'){throw};$rejected=$true}
  if(-not $rejected){throw 'unsafe-candidate-accepted'}
}
$child=Fact @{inherited=$true}
Assert-InheritedCandidate @($owner,$child) $valid
foreach($badChild in @((Fact @{inherited=$false}),(Fact @{inherited=$true;sidValue='principal-2'}),
  (Fact @{inherited=$true;knownReadOnlyRights=$false}))){
  $rejected=$false
  try{Assert-InheritedCandidate @($owner,$badChild) $valid}catch{
    if($_.Exception.Message -ne 'ACL_CANDIDATE_REJECTED'){throw};$rejected=$true}
  if(-not $rejected){throw 'unsafe-downstream-candidate-accepted'}
}
Assert-ExactBackup 'exact-sddl' 'exact-sddl'
$rejected=$false
try{Assert-ExactBackup 'stale-or-foreign-sddl' 'current-sddl'}catch{
  if($_.Exception.Message -ne 'BACKUP_CONFLICT'){throw};$rejected=$true
}
if(-not $rejected){throw 'conflicting-backup-accepted'}
if((Select-BackupOwnerAction 'S-1-5-21-1-2-3-1001' 'S-1-5-21-1-2-3-1001') -ne 'none'){
  throw 'current-owner-not-preserved'
}
if((Select-BackupOwnerAction 'S-1-5-32-544' 'S-1-5-21-1-2-3-1001') -ne 'normalize'){
  throw 'builtin-administrators-not-classified'
}
foreach($unsafeOwner in @('S-1-5-18','S-1-5-32-545','S-1-5-21-1-2-3-1002')){
  $rejected=$false
  try{$null=Select-BackupOwnerAction $unsafeOwner 'S-1-5-21-1-2-3-1001'}catch{
    if($_.Exception.Message -ne 'BACKUP_OWNER_REJECTED'){throw};$rejected=$true
  }
  if(-not $rejected){throw 'unsafe-backup-owner-accepted'}
}
foreach($set in @(@($owner),@($owner,$valid,(Fact @{})))){
  $rejected=$false
  try{$null=Select-RepairCandidate $set}catch{if($_.Exception.Message -ne 'ACL_CANDIDATE_REJECTED'){throw};$rejected=$true}
  if(-not $rejected){throw 'candidate-cardinality-not-enforced'}
}
Write-Output 'Owner ACL repair decision fixtures PASS (no ACL mutation)'
