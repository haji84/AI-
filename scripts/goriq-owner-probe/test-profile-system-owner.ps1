Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$checks=0
function Assert-Policy([string]$Name,[bool]$Value) {
 if(-not $Value){throw ('PROFILE_POLICY_FAILED:'+ $Name)}
 $script:checks++;Write-Output ('PASS '+$Name)
}
foreach($path in @((Join-Path $PSScriptRoot '../goriq-zbook-bridge-capture.cs'),(Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs'))){
 if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition ([IO.File]::ReadAllText($path)) -Language CSharp}
 else{$null=Add-Type -TypeDefinition ([IO.File]::ReadAllText($path)) -Language CSharp -CompilerOptions '/langversion:5'}
}
Assert-Policy 'capture_profile_scope_exists' ($null -ne [GoriqBridgeCapture].GetMethod('IsExactProfileDirectory'))
Assert-Policy 'capture_owner_predicate_exists' ($null -ne [GoriqBridgeCapture].GetMethod('PrivateOwnerPermitted'))
$user='S-1-5-21-1-2-3-1001';$system='S-1-5-18';$profile='C:\Users\Fixture'
$exact=[GoriqBridgeCapture]::IsExactProfileDirectory(16,('\\?\'+$profile),$profile)
Assert-Policy 'verified_profile_scope' $exact
Assert-Policy 'profile_current_owner' ([GoriqBridgeCapture]::PrivateOwnerPermitted($user,$user,$exact))
Assert-Policy 'profile_system_owner' ([GoriqBridgeCapture]::PrivateOwnerPermitted($system,$user,$exact))
foreach($other in @('S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464','S-1-5-21-9-8-7-1002','')){
 Assert-Policy ('profile_unapproved_owner_'+$checks) (-not [GoriqBridgeCapture]::PrivateOwnerPermitted($other,$user,$exact))
}
foreach($candidate in @('C:\','C:\Users','C:\Users\Fixture2',($profile+'\.goriq-handoff'),($profile+'\raw'),($profile+'\context.txt'))){
 $scope=[GoriqBridgeCapture]::IsExactProfileDirectory(16,('\\?\'+$candidate),$profile)
 Assert-Policy ('other_target_not_profile_'+$checks) (-not $scope)
 Assert-Policy ('other_target_system_rejected_'+$checks) (-not [GoriqBridgeCapture]::PrivateOwnerPermitted($system,$user,$scope))
 Assert-Policy ('other_target_current_preserved_'+$checks) ([GoriqBridgeCapture]::PrivateOwnerPermitted($user,$user,$scope))
}
foreach($case in @(
 @(0,('\\?\'+$profile),$profile),@(1040,('\\?\'+$profile),$profile),
 @(16,$profile,$profile),@(16,('\\?\'+$profile),'C:\'),
 @(16,'\\?\C:\','C:\'),@(16,('\\?\'+$profile),'C:\Users\Fixture\..\Fixture')
)){
 Assert-Policy ('unsafe_scope_rejected_'+$checks) (-not [GoriqBridgeCapture]::IsExactProfileDirectory([uint32]$case[0],[string]$case[1],[string]$case[2]))
}
Assert-Policy 'profile_case_insensitive' ([GoriqBridgeCapture]::IsExactProfileDirectory(16,'\\?\c:\users\fixture',$profile))
Assert-Policy 'private_dacl_other_still_rejected' (-not [GoriqBridgeCapture]::AcePermitted('S-1-1-0',1,$true,$false,$user))
Assert-Policy 'runtime_untrusted_write_still_rejected' (-not [GoriqBridgeCapture]::RuntimeDirectoryAcePermitted('S-1-5-11',64,$true))
$ownerSystem=[OwnerProbeOwner][Enum]::Parse([OwnerProbeOwner],'SYSTEM')
Assert-Policy 'observer_profile_system_allowed' ([GoriqPrivateOwnerProbe]::PrivateOwnerPermitted([OwnerProbeTarget]::PROFILE,$ownerSystem))
foreach($target in @('HANDOFF','LAYOUT','RAW','WORK','CONTEXT','VOLUME_ROOT','ANCESTOR_01')){
 $role=[OwnerProbeTarget][Enum]::Parse([OwnerProbeTarget],$target)
 Assert-Policy ('observer_system_wrong_role_'+$target) (-not [GoriqPrivateOwnerProbe]::PrivateOwnerPermitted($role,$ownerSystem))
 Assert-Policy ('observer_current_role_'+$target) ([GoriqPrivateOwnerProbe]::PrivateOwnerPermitted($role,[OwnerProbeOwner]::CURRENT_USER))
}
$ace=New-Object OwnerProbeAce;$ace.Account=[OwnerProbeAccount]::OTHER;$ace.Qualifier=[OwnerProbeQualifier]::ALLOW;$ace.Qualified=$true
Assert-Policy 'profile_system_dacl_not_skipped' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$ownerSystem,$true,[OwnerProbeAce[]]@($ace),[OwnerProbeTarget]::PROFILE).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
Assert-Policy 'profile_system_missing_descriptor_refuses' ([GoriqPrivateOwnerProbe]::ReduceSecurity($false,$true,$ownerSystem,$true,[OwnerProbeAce[]]@(),[OwnerProbeTarget]::PROFILE).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
Assert-Policy 'profile_system_policy_match' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$ownerSystem,$true,[OwnerProbeAce[]]@(),[OwnerProbeTarget]::PROFILE).ToString() -ceq 'OBSERVED_POLICY_MATCH')
Assert-Policy 'handoff_system_owner_still_refuses' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$ownerSystem,$true,[OwnerProbeAce[]]@(),[OwnerProbeTarget]::HANDOFF).ToString() -ceq 'PRIVATE_OWNER_UNVERIFIED')
. (Join-Path $PSScriptRoot 'observe-private-owner.ps1')
function New-PolicyReport([string]$ProfileOwner='SYSTEM') {
 $p=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'|ConvertFrom-Json
 $p.target='HANDOFF';$p.reason='TARGET_MISSING';$p.observations=@()
 foreach($name in @('IDENTITY','PROFILE_ENVIRONMENT','VOLUME_ROOT','ANCESTOR_01','PROFILE')){
  $native=$name -notin @('IDENTITY','PROFILE_ENVIRONMENT');$private=$name -ceq 'PROFILE'
  $p.observations+=@{target=$name;reason='OBSERVED_POLICY_MATCH';storageVerified=$native;attributesVerified=$native;finalPathVerified=$native;owner=$(if(-not $native){'UNOBSERVED'}elseif($private){$ProfileOwner}else{'SYSTEM'});dacl=$(if(-not $native){'UNOBSERVED'}elseif($private){'PRIVATE_POLICY_MATCH'}else{'ANCESTOR_METADATA_ONLY'})}
 }
 $p.observations+=@{target='HANDOFF';reason='TARGET_MISSING';storageVerified=$true;attributesVerified=$false;finalPathVerified=$false;owner='UNOBSERVED';dacl='UNOBSERVED'}
 return $p
}
$p=New-PolicyReport
$clean=ConvertTo-OwnerProbeClosedJson ($p|ConvertTo-Json -Depth 5 -Compress)|ConvertFrom-Json
Assert-Policy 'closed_profile_system_match' ($clean.observations[4].owner -ceq 'SYSTEM' -and $clean.target -ceq 'HANDOFF')
$p.observations[5]=@{target='HANDOFF';reason='PRIVATE_OWNER_UNVERIFIED';storageVerified=$true;attributesVerified=$true;finalPathVerified=$true;owner='SYSTEM';dacl='UNOBSERVED'};$p.reason='PRIVATE_OWNER_UNVERIFIED'
$clean=ConvertTo-OwnerProbeClosedJson ($p|ConvertTo-Json -Depth 5 -Compress)|ConvertFrom-Json
Assert-Policy 'closed_handoff_system_refusal' ($clean.reason -ceq 'PRIVATE_OWNER_UNVERIFIED')
foreach($bad in @('foreign_profile','system_child_success','system_profile_owner_refusal','raw_sid')){
 $p=New-PolicyReport
 switch($bad){
  'foreign_profile' {$p.observations[4].owner='OTHER'}
  'system_child_success' {$p.observations[5]=@{target='HANDOFF';reason='OBSERVED_POLICY_MATCH';storageVerified=$true;attributesVerified=$true;finalPathVerified=$true;owner='SYSTEM';dacl='PRIVATE_POLICY_MATCH'};$p.observations+=@{target='LAYOUT';reason='TARGET_MISSING';storageVerified=$true;attributesVerified=$false;finalPathVerified=$false;owner='UNOBSERVED';dacl='UNOBSERVED'};$p.target='LAYOUT'}
  'system_profile_owner_refusal' {$p.observations=$p.observations[0..4];$p.target='PROFILE';$p.reason='PRIVATE_OWNER_UNVERIFIED';$p.observations[4].reason='PRIVATE_OWNER_UNVERIFIED';$p.observations[4].dacl='UNOBSERVED'}
  'raw_sid' {$p.observations[4].owner='S-1-5-18'}
 }
 $refused=$false;try{$null=ConvertTo-OwnerProbeClosedJson ($p|ConvertTo-Json -Depth 5 -Compress)}catch{$refused=$true}
 Assert-Policy ('closed_refuses_'+$bad) $refused
}
& (Join-Path $PSScriptRoot 'test-profile-security-boundary.ps1')
& (Join-Path $PSScriptRoot 'test-profile-capability-traverse.ps1') -ReusePolicyTypes
Write-Output ('PROFILE_POLICY_PASS='+$checks)
