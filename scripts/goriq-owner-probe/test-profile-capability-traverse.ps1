param([switch]$ReusePolicyTypes)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$checks=0
function Assert-Capability([string]$Name,[bool]$Value){if(-not $Value){throw ('PROFILE_CAPABILITY_FAILED:'+$Name)};$script:checks++;Write-Output ('PASS '+$Name)}
if(-not $ReusePolicyTypes){foreach($p in @('../goriq-zbook-bridge-capture.cs','goriq-private-owner-probe.cs')){
 $source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot $p))
 if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $source -Language CSharp}else{$null=Add-Type -TypeDefinition $source -Language CSharp -CompilerOptions '/langversion:5'}
}}
Assert-Capability 'capture_predicate_exists' ($null -ne [GoriqBridgeCapture].GetMethod('ProfileCapabilityTraversePermitted'))
Assert-Capability 'observer_predicate_exists' ($null -ne [GoriqPrivateOwnerProbe].GetMethod('ProfileCapabilityTraversePermitted'))
$capability='S-1-15-3-65536-1-2-3-4-5-6-7-8';$mask=[uint32]1048608
Assert-Capability 'profile_traverse_only_allowed' ([GoriqBridgeCapture]::ProfileCapabilityTraversePermitted($capability,$mask,0,$true))
Assert-Capability 'old_generic_private_stays_strict' (-not [GoriqBridgeCapture]::AcePermitted($capability,$mask,$true,$false,'S-1-5-21-1-2-3-1001'))
foreach($role in @('HANDOFF','LAYOUT','RAW','WORK','CONTEXT','VOLUME_ROOT')){
 Assert-Capability ('other_scope_'+$role) (-not [GoriqBridgeCapture]::ProfileCapabilityTraversePermitted($capability,$mask,0,$false))
}
foreach($sid in @('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-15-2-1','S-1-15-3-1','S-1-5-21-1-2-3-1001',
 'S-1-15-3-65536-1-2-3-4-5-6-7','S-1-15-3-65536-1-2-3-4-5-6-7-8-9','S-1-15-3-65536-1-2-3-4-5-6-7-4294967296',
 'S-1-15-3-65536-01-2-3-4-5-6-7-8',($capability+"`n"),'')){
 Assert-Capability ('other_sid_refused_'+$checks) (-not [GoriqBridgeCapture]::ProfileCapabilityTraversePermitted($sid,$mask,0,$true))
}
foreach($extra in @([uint32]1,[uint32]2,[uint32]4,[uint32]8,[uint32]16,[uint32]64,[uint32]128,[uint32]256,[uint32]512,[uint32]65536,[uint32]131072,[uint32]262144,[uint32]524288,[uint32]268435456,[uint32]1073741824,[uint32]2147483648)){
 Assert-Capability ('extra_right_refused_'+$extra) (-not [GoriqBridgeCapture]::ProfileCapabilityTraversePermitted($capability,($mask -bor $extra),0,$true))
}
foreach($flags in @(1,2,4,8,16,64,128,255)){
 Assert-Capability ('inherit_or_other_flag_refused_'+$flags) (-not [GoriqBridgeCapture]::ProfileCapabilityTraversePermitted($capability,$mask,$flags,$true))
}
foreach($value in @([uint32]0,[uint32]32,[uint32]1048576,[uint32]1179817,[uint32]2032127)){
 Assert-Capability ('different_mask_refused_'+$value) (-not [GoriqBridgeCapture]::ProfileCapabilityTraversePermitted($capability,$value,0,$true))
}
$ace=New-Object OwnerProbeAce;$ace.Account=[OwnerProbeAccount]::OTHER;$ace.Qualified=$true;$ace.Qualifier=[OwnerProbeQualifier]::ALLOW;$ace.Sid=$capability;$ace.Mask=$mask;$ace.Flags=0
foreach($owner in @('CURRENT_USER','SYSTEM')){
 $o=[OwnerProbeOwner][Enum]::Parse([OwnerProbeOwner],$owner)
 Assert-Capability ('profile_owner_'+$owner) ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$o,$true,[OwnerProbeAce[]]@($ace),[OwnerProbeTarget]::PROFILE).ToString() -ceq 'OBSERVED_POLICY_MATCH')
}
foreach($role in @('HANDOFF','LAYOUT','RAW','WORK','CONTEXT','NONE')){
 $t=[OwnerProbeTarget][Enum]::Parse([OwnerProbeTarget],$role)
 Assert-Capability ('observer_private_child_'+$role) ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,[OwnerProbeOwner]::CURRENT_USER,$true,[OwnerProbeAce[]]@($ace),$t).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
}
Assert-Capability 'foreign_profile_owner_still_refuses' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,[OwnerProbeOwner]::OTHER,$true,[OwnerProbeAce[]]@($ace),[OwnerProbeTarget]::PROFILE).ToString() -ceq 'PRIVATE_OWNER_UNVERIFIED')
Assert-Capability 'legacy_api_still_refuses' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,[OwnerProbeAce[]]@($ace)).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
$ace.Callback=$true
Assert-Capability 'callback_still_refuses' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,[OwnerProbeOwner]::SYSTEM,$true,[OwnerProbeAce[]]@($ace),[OwnerProbeTarget]::PROFILE).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
$ace.Callback=$false;$ace.Mask=$mask -bor 1
Assert-Capability 'capability_cannot_read_directory' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,[OwnerProbeOwner]::SYSTEM,$true,[OwnerProbeAce[]]@($ace),[OwnerProbeTarget]::PROFILE).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
foreach($sid in @($capability,'S-1-1-0','S-1-15-2-1')){
 foreach($m in @($mask,($mask -bor 1),[uint32]0)){
  foreach($flags in @(0,1,16)){
   foreach($scope in @($false,$true)){
    Assert-Capability ('mirrors_'+$checks) ([GoriqBridgeCapture]::ProfileCapabilityTraversePermitted($sid,$m,$flags,$scope) -eq [GoriqPrivateOwnerProbe]::ProfileCapabilityTraversePermitted($sid,$m,$flags,$scope))
   }
  }
 }
}
if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){& (Join-Path $PSScriptRoot 'test-profile-capability-native.ps1')}
Write-Output ('PROFILE_CAPABILITY_PASS='+$checks)
