param([switch]$ReusePolicyTypes)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$checks=0
function Assert-SourceAncestor([string]$Name,[bool]$Value) {
 if(-not $Value){throw ('SOURCE_ANCESTOR_FAILED:'+ $Name)}
 $script:checks++;Write-Output ('PASS '+$Name)
}
if(-not $ReusePolicyTypes){
 $source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../goriq-zbook-bridge-capture.cs'))
 if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $source -Language CSharp}
 else{$null=Add-Type -TypeDefinition $source -Language CSharp -CompilerOptions '/langversion:5'}
}
foreach($method in @('SourceAncestorOwnerPermitted','SourceAncestorAcePermitted','IsSourceAncestorDirectory','SourceAncestorAceShapePermitted')){
 Assert-SourceAncestor ('predicate_exists_'+$method) ($null -ne [GoriqBridgeCapture].GetMethod($method))
}
$user='S-1-5-21-1-2-3-1001';$reader='S-1-5-21-9-8-7-1002';$profile='C:\Users\Fixture'
$fixed=$profile+'\AppData\Local\GAIWorker\goal-1218-bridge-state'
foreach($owner in @($user,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')){
 Assert-SourceAncestor ('trusted_owner_'+$checks) ([GoriqBridgeCapture]::SourceAncestorOwnerPermitted($owner,$user))
 Assert-SourceAncestor ('trusted_full_control_'+$checks) ([GoriqBridgeCapture]::SourceAncestorAcePermitted($owner,2032127,$user))
}
foreach($owner in @($reader,'S-1-1-0','S-1-5-11','S-1-5-32-545','')){
 Assert-SourceAncestor ('untrusted_owner_'+$checks) (-not [GoriqBridgeCapture]::SourceAncestorOwnerPermitted($owner,$user))
}
Assert-SourceAncestor 'empty_identity_not_trusted' (-not [GoriqBridgeCapture]::SourceAncestorOwnerPermitted('',''))
foreach($mask in @([uint32]0,[uint32]1,[uint32]8,[uint32]32,[uint32]128,[uint32]131072,[uint32]1048576,[uint32]1179817)){
 Assert-SourceAncestor ('untrusted_read_subset_'+$mask) ([GoriqBridgeCapture]::SourceAncestorAcePermitted($reader,$mask,$user))
}
foreach($bit in @([uint32]2,[uint32]4,[uint32]16,[uint32]64,[uint32]256,[uint32]512,[uint32]65536,[uint32]262144,[uint32]524288,[uint32]16777216,[uint32]33554432,[uint32]268435456,[uint32]536870912,[uint32]1073741824,[uint32]2147483648)){
 Assert-SourceAncestor ('untrusted_mutation_generic_unknown_refused_'+$bit) (-not [GoriqBridgeCapture]::SourceAncestorAcePermitted($reader,([uint32]1179817 -bor $bit),$user))
}
foreach($path in @(($profile+'\AppData'),($profile+'\AppData\Local'),($profile+'\AppData\Local\GAIWorker'))){
 Assert-SourceAncestor ('actual_chain_directory_'+$checks) ([GoriqBridgeCapture]::IsSourceAncestorDirectory(16,('\\?\'+$path),$profile,$fixed))
}
foreach($path in @('C:\','C:\Users',$profile,$fixed,($fixed+'\self-development'),($fixed+'\compass.sqlite'),($profile+'2\AppData'),($profile+'\AppData2'),($profile+'\.goriq-handoff'),($profile+'\raw'),($profile+'\context.txt'))){
 Assert-SourceAncestor ('outside_strict_chain_'+$checks) (-not [GoriqBridgeCapture]::IsSourceAncestorDirectory(16,('\\?\'+$path),$profile,$fixed))
}
foreach($case in @(@(0,('\\?\'+$profile+'\AppData'),$profile,$fixed),@(1040,('\\?\'+$profile+'\AppData'),$profile,$fixed),@(16,($profile+'\AppData'),$profile,$fixed),@(16,('\\?\'+$profile+'\AppData\..\AppData'),$profile,$fixed),@(16,('\\?\'+$profile+'\AppData'),$profile,($profile+'\AppData\Other')), @(16,('\\?\'+$profile+'\AppData'),($profile+'\..\Fixture'),$fixed))){
 Assert-SourceAncestor ('file_reparse_noncanonical_or_wrong_source_'+$checks) (-not [GoriqBridgeCapture]::IsSourceAncestorDirectory([uint32]$case[0],[string]$case[1],[string]$case[2],[string]$case[3]))
}
foreach($flags in @(0,1,2,3,4,8,16,31)){
 foreach($type in @(0,1)){Assert-SourceAncestor ('ordinary_allow_deny_flags_'+$checks) ([GoriqBridgeCapture]::SourceAncestorAceShapePermitted($type,$flags,$false))}
}
foreach($case in @(@(0,0,$true),@(1,0,$true),@(5,0,$false),@(6,0,$false),@(9,0,$false),@(0,32,$false),@(1,64,$false),@(0,128,$false),@(0,255,$false))){
 Assert-SourceAncestor ('callback_object_unknown_flags_refused_'+$checks) (-not [GoriqBridgeCapture]::SourceAncestorAceShapePermitted([int]$case[0],[int]$case[1],[bool]$case[2]))
}
Assert-SourceAncestor 'generic_private_read_stays_refused' (-not [GoriqBridgeCapture]::AcePermitted($reader,1179817,$true,$false,$user))
Assert-SourceAncestor 'generic_private_admin_owner_stays_refused' (-not [GoriqBridgeCapture]::PrivateOwnerPermitted('S-1-5-32-544',$user,$false))
Assert-SourceAncestor 'source_system_owner_stays_refused' (-not [GoriqBridgeCapture]::PrivateOwnerPermitted('S-1-5-18',$user,$false))
Assert-SourceAncestor 'exact_profile_system_owner_preserved' ([GoriqBridgeCapture]::PrivateOwnerPermitted('S-1-5-18',$user,$true))
Assert-SourceAncestor 'profile_extra_reader_stays_refused' (-not [GoriqBridgeCapture]::AcePermitted($reader,1179817,$true,$false,$user))
if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){& (Join-Path $PSScriptRoot 'test-source-ancestor-native.ps1')}
Write-Output ('SOURCE_ANCESTOR_INTEGRITY_PASS='+$checks)
