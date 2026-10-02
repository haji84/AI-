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
Invoke-Expression $definition.Extent.Text
Invoke-Expression $downstream.Extent.Text
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
foreach($set in @(@($owner),@($owner,$valid,(Fact @{})))){
  $rejected=$false
  try{$null=Select-RepairCandidate $set}catch{if($_.Exception.Message -ne 'ACL_CANDIDATE_REJECTED'){throw};$rejected=$true}
  if(-not $rejected){throw 'candidate-cardinality-not-enforced'}
}
Write-Output 'Owner ACL repair decision fixtures PASS (no ACL mutation)'
