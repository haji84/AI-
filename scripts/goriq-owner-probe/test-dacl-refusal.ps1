Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$checks=0
function Assert-Dacl([string]$Name,[bool]$Value){if(-not $Value){throw ('DACL_DETAIL_FAILED:'+$Name)};$script:checks++;Write-Output ('PASS '+$Name)}
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs'))
if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $source -Language CSharp}else{$null=Add-Type -TypeDefinition $source -Language CSharp -CompilerOptions '/langversion:5'}
Assert-Dacl 'classifier_exists' ($null -ne [GoriqPrivateOwnerProbe].GetMethod('ClassifyDaclRefusal'))
function New-DaclAce([string]$Principal,[uint32]$Mask=1179817){
 $a=New-Object OwnerProbeAce;$a.Qualified=$true;$a.Qualifier=[OwnerProbeQualifier]::ALLOW;$a.Account=[OwnerProbeAccount]::OTHER
 $a.Principal=[OwnerProbeDaclPrincipal][Enum]::Parse([OwnerProbeDaclPrincipal],$Principal);$a.Mask=$Mask;return $a
}
$principals=@{
 'S-1-1-0'='EVERYONE';'S-1-5-11'='AUTHENTICATED_USERS';'S-1-5-32-545'='BUILTIN_USERS'
 'S-1-15-2-1'='ALL_APPLICATION_PACKAGES';'S-1-15-2-2'='ALL_RESTRICTED_APPLICATION_PACKAGES';'S-1-5-21-1-2-3-1009'='OTHER_ACCOUNT'
}
foreach($sid in $principals.Keys){
 $role=$principals[$sid];Assert-Dacl ('principal_'+$role) ([GoriqPrivateOwnerProbe]::ClassifyDaclPrincipal($sid).ToString() -ceq $role)
 foreach($mask in @([uint32]0,[uint32]1179817,[uint32]2147483648,[uint32]2,[uint32]4,[uint32]64,[uint32]262144,[uint32]524288,[uint32]512,[uint32]268435456)){
  $a=New-DaclAce $role $mask;$nonwriting=$mask -in @([uint32]0,[uint32]1179817,[uint32]2147483648)
  $suffix=if($nonwriting){'NONWRITING'}else{'WRITE_OR_OTHER'}
  Assert-Dacl ('detail_'+$role+'_'+$mask) ([GoriqPrivateOwnerProbe]::ClassifyDaclRefusal($true,[OwnerProbeAce[]]@($a)).ToString() -ceq ('REFUSED_'+$role+'_'+$suffix))
  Assert-Dacl ('policy_still_refuses_'+$role+'_'+$mask) ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,[OwnerProbeAce[]]@($a)).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
  Assert-Dacl ('ancestor_not_refused_'+$role+'_'+$mask) ([GoriqPrivateOwnerProbe]::ClassifyDaclRefusal($false,[OwnerProbeAce[]]@($a)).ToString() -ceq 'UNVERIFIED')
 }
}
$a=New-DaclAce 'EVERYONE';$a.InheritOnly=$true;$a.Qualified=$false;$a.Callback=$true
$b=New-DaclAce 'BUILTIN_USERS';Assert-Dacl 'inherit_only_first_skipped' ([GoriqPrivateOwnerProbe]::ClassifyDaclRefusal($true,[OwnerProbeAce[]]@($a,$b)).ToString() -ceq 'REFUSED_BUILTIN_USERS_NONWRITING')
$a.InheritOnly=$false;Assert-Dacl 'unqualified_first' ([GoriqPrivateOwnerProbe]::ClassifyDaclRefusal($true,[OwnerProbeAce[]]@($a,$b)).ToString() -ceq 'REFUSED_UNQUALIFIED_ACE')
$a.Qualified=$true;Assert-Dacl 'callback_first' ([GoriqPrivateOwnerProbe]::ClassifyDaclRefusal($true,[OwnerProbeAce[]]@($a,$b)).ToString() -ceq 'REFUSED_CALLBACK_ACE')
$a.Callback=$false;$a.Qualifier=[OwnerProbeQualifier]::DENY;Assert-Dacl 'deny_not_grant' ([GoriqPrivateOwnerProbe]::ClassifyDaclRefusal($true,[OwnerProbeAce[]]@($a,$b)).ToString() -ceq 'REFUSED_BUILTIN_USERS_NONWRITING')
foreach($trusted in @('CURRENT_USER','SYSTEM','ADMINISTRATORS','TRUSTED_INSTALLER')){
 $a=New-DaclAce 'EVERYONE' 2;$a.Account=[OwnerProbeAccount][Enum]::Parse([OwnerProbeAccount],$trusted)
 Assert-Dacl ('trusted_still_matches_'+$trusted) ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,[OwnerProbeAce[]]@($a)).ToString() -ceq 'OBSERVED_POLICY_MATCH')
 Assert-Dacl ('trusted_not_misclassified_'+$trusted) ([GoriqPrivateOwnerProbe]::ClassifyDaclRefusal($true,[OwnerProbeAce[]]@($a)).ToString() -ceq 'UNVERIFIED')
}
. (Join-Path $PSScriptRoot 'observe-private-owner.ps1')
function New-DaclReport {
 $p=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'|ConvertFrom-Json;$p.target='PROFILE';$p.reason='PRIVATE_DACL_UNVERIFIED';$p.observations=@()
 foreach($name in @('IDENTITY','PROFILE_ENVIRONMENT','VOLUME_ROOT','ANCESTOR_01','PROFILE')){
  $native=$name -notin @('IDENTITY','PROFILE_ENVIRONMENT');$private=$name -ceq 'PROFILE'
  $p.observations+=@{target=$name;reason=$(if($private){'PRIVATE_DACL_UNVERIFIED'}else{'OBSERVED_POLICY_MATCH'});storageVerified=$native;attributesVerified=$native;finalPathVerified=$native;owner=$(if($native){'SYSTEM'}else{'UNOBSERVED'});dacl=$(if($private){'REFUSED_BUILTIN_USERS_NONWRITING'}elseif($native){'ANCESTOR_METADATA_ONLY'}else{'UNOBSERVED'})}
 }
 return $p
}
$p=New-DaclReport;$valid=ConvertTo-OwnerProbeClosedJson ($p|ConvertTo-Json -Compress -Depth 5)|ConvertFrom-Json
Assert-Dacl 'closed_refusal_accepted' ($valid.observations[-1].dacl -ceq 'REFUSED_BUILTIN_USERS_NONWRITING' -and -not $valid.recovered)
foreach($label in @([Enum]::GetNames([OwnerProbeDacl])|Where-Object {$_ -clike 'REFUSED_*'})){
 $p=New-DaclReport;$p.observations[-1].dacl=$label
 $v=ConvertTo-OwnerProbeClosedJson ($p|ConvertTo-Json -Compress -Depth 5)|ConvertFrom-Json
 Assert-Dacl ('closed_all_labels_'+$label) ($v.observations[-1].dacl -ceq $label)
}
$p=New-DaclReport;$p.observations[-1].dacl='UNVERIFIED';$null=ConvertTo-OwnerProbeClosedJson ($p|ConvertTo-Json -Compress -Depth 5)
Assert-Dacl 'legacy_unverified_remains_valid' $true
foreach($bad in @('raw_sid','success_detail','owner_refusal_detail','no_final_path','unobserved_owner','foreign_owner','ancestor_allow_detail')){
 $p=New-DaclReport
 switch($bad){
  'raw_sid' {$p.observations[-1].dacl='S-1-5-21-PRIVATE'}
  'success_detail' {$p.observations[-1].reason='OBSERVED_POLICY_MATCH';$p.reason='OBSERVED_POLICY_MATCH'}
  'owner_refusal_detail' {$p.observations[-1].reason='PRIVATE_OWNER_UNVERIFIED';$p.reason='PRIVATE_OWNER_UNVERIFIED';$p.observations[-1].owner='OTHER'}
  'no_final_path' {$p.observations[-1].finalPathVerified=$false}
  'unobserved_owner' {$p.observations[-1].owner='UNOBSERVED'}
  'foreign_owner' {$p.observations[-1].owner='OTHER'}
  'ancestor_allow_detail' {$p.observations=$p.observations[0..3];$p.target='ANCESTOR_01';$p.observations[-1].reason='PRIVATE_DACL_UNVERIFIED';$p.observations[-1].dacl='REFUSED_BUILTIN_USERS_NONWRITING'}
 }
 $refused=$false;try{$null=ConvertTo-OwnerProbeClosedJson ($p|ConvertTo-Json -Compress -Depth 5)}catch{$refused=$true}
 Assert-Dacl ('closed_rejects_'+$bad) $refused
}
if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){& (Join-Path $PSScriptRoot 'test-dacl-native-boundary.ps1')}
Write-Output ('DACL_DETAIL_PASS='+$checks)
