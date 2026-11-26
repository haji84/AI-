param([switch]$ReusePolicyTypes,[switch]$SupervisedOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$sourceAclChecks=0
function Assert-SourceAclEnvelope([string]$Name,[bool]$Condition) {
 if(-not $Condition){throw ('SOURCE_ACL_ENVELOPE_TEST_FAILED:'+ $Name)}
 $script:sourceAclChecks++;Write-Output ('PASS '+$Name)
}
function Assert-SourceAclRejected([string]$Name,[string]$Text) {
 $refused=$false;try{$null=ConvertTo-SourceAclProbeClosedJson $Text}catch{$refused=$true}
 Assert-SourceAclEnvelope $Name $refused
}
function ConvertTo-SourceAclFixtureWire($Value) {return ($Value|ConvertTo-Json -Depth 8 -Compress)}
function New-SourceAclFixtureAce {
 return [pscustomobject][ordered]@{account='CURRENT_USER';qualifier='ALLOW';mask=[long]2147483648;flags=0}
}
function New-SourceAclFixtureRow([string]$Target) {
 return [pscustomobject][ordered]@{target=$Target;status='ACL_OBSERVED';storageVerified=$true;attributesVerified=$true;finalPathVerified=$true;owner='SYSTEM';dacl='PRESENT';aces=@((New-SourceAclFixtureAce))}
}
function New-SourceAclFixtureReport {
 $rows=@()
 # Hand-written plan includes both ancestor chains. No native reader is needed.
 foreach($target in @('VOLUME_ROOT','PROFILE_ANCESTOR_01','PROFILE','SOURCE_ANCESTOR_01','APPDATA','LOCAL','WORKER','SOURCE','DB','WAL','SHM','JOURNAL','SIDECAR','JOBS','CHANGES','HANDOFF','CAPTURE','RAW','WORK','CONTEXT','RAW_DB','RAW_WAL','RAW_SHM','RAW_JOBS','RAW_CHANGES','WORK_DB','WORK_WAL','WORK_SHM','WORK_JOBS','WORK_CHANGES')){$rows+=New-SourceAclFixtureRow $target}
 return [pscustomobject][ordered]@{schema='SOURCE_ACL_PROBE_V1';authority='NOT_AUTHORITATIVE';status='METADATA_ONLY_COMPLETE';readOnly=$true;metadataOnly=$true;recovered=$false;g1='HOLD';historicalStateProven=$false;maxTargets=48;maxAces=16;budgetSeconds=20;reason='OBSERVED';observations=$rows}
}
$loaded=@(. (Join-Path $PSScriptRoot 'observe-private-owner.ps1'))
Assert-SourceAclEnvelope 'source_launcher_is_inert' ($loaded.Count -eq 0)
if($SupervisedOnly){
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'SOURCE_ACL_SUPERVISOR_REQUIRES_WINDOWS'}
 # Reach only a supplied inert class through the real WindowsPS5 supervisor,
 # signature, compiler, and source pipe; never invoke private observation.
 $literal=(New-SourceAclProbeFailure 'IDENTITY_UNVERIFIED').Replace('"','""')
 $inert='public static class GoriqSourceAclProbe { public static string ObserveJson() { return @"'+$literal+'"; } }'
 $result=Invoke-OwnerProbeObservation -NativeSource $inert -SourceAcl|ConvertFrom-Json
 Assert-SourceAclEnvelope ('source_native_ps5_fixed_entry_'+$result.reason) ($result.schema -ceq 'SOURCE_ACL_PROBE_V1' -and $result.reason -ceq 'IDENTITY_UNVERIFIED' -and $result.observations.Count -eq 0)
 $wrapped=Invoke-SourceAclProbeObservation -NativeSource $inert|ConvertFrom-Json
 Assert-SourceAclEnvelope ('source_native_ps5_wrapper_'+$wrapped.reason) ($wrapped.schema -ceq 'SOURCE_ACL_PROBE_V1' -and $wrapped.reason -ceq 'IDENTITY_UNVERIFIED' -and $wrapped.observations.Count -eq 0)
 $invalid=Invoke-OwnerProbeObservation -NativeSource 'deliberately invalid PRIVATE C#' -SourceAcl|ConvertFrom-Json
 Assert-SourceAclEnvelope ('source_native_ps5_build_phase_'+$invalid.reason) ($invalid.schema -ceq 'SOURCE_ACL_PROBE_V1' -and $invalid.reason -ceq 'NATIVE_BUILD_SOURCE_REJECTED' -and $invalid.observations.Count -eq 0)
 $wrong=Invoke-OwnerProbeObservation -NativeSource $inert|ConvertFrom-Json
 Assert-SourceAclEnvelope 'source_default_entry_still_requires_owner_class' ($wrong.schema -ceq 'OWNER_PROBE_V1' -and $wrong.reason -ceq 'NATIVE_ENTRY_UNAVAILABLE')
 Write-Output ('SOURCE_ACL_SUPERVISED_PASS='+$sourceAclChecks)
 return
}
Assert-SourceAclEnvelope 'source_failure_contract_exists' ($null -ne (Get-Command New-SourceAclProbeFailure -ErrorAction SilentlyContinue))
$failure=New-SourceAclProbeFailure 'UNSUPPORTED_PLATFORM'
$clean=ConvertTo-SourceAclProbeClosedJson $failure|ConvertFrom-Json
Assert-SourceAclEnvelope 'source_failure_closed_header' ((@($clean.PSObject.Properties.Name)-join ',') -ceq 'schema,authority,status,readOnly,metadataOnly,recovered,g1,historicalStateProven,maxTargets,maxAces,budgetSeconds,reason,observations')
Assert-SourceAclEnvelope 'source_failure_safe_values' ($clean.schema -ceq 'SOURCE_ACL_PROBE_V1' -and $clean.authority -ceq 'NOT_AUTHORITATIVE' -and $clean.status -ceq 'INCOMPLETE' -and $clean.readOnly -and $clean.metadataOnly -and -not $clean.recovered -and $clean.g1 -ceq 'HOLD' -and -not $clean.historicalStateProven -and $clean.maxTargets -eq 48 -and $clean.maxAces -eq 16 -and $clean.budgetSeconds -eq 20 -and $clean.reason -ceq 'UNSUPPORTED_PLATFORM' -and $clean.observations.Count -eq 0)
$grammarWire=ConvertTo-SourceAclFixtureWire (New-SourceAclFixtureReport)
foreach($case in @('array_root','leading_block_comment','leading_line_comment','internal_comment','trailing_object_comma','trailing_array_comma','junk','nan','leading_zero','invalid_whitespace','unicode_reason','escaped_unicode_reason','escaped_ascii_key','unicode_key','unicode_owner','unicode_account','excessive_depth')){
 $bad=$grammarWire
 switch($case){
  'array_root' {$bad='['+$bad+']'}
  'leading_block_comment' {$bad='/* PRIVATE */'+$bad}
  'leading_line_comment' {$bad="// PRIVATE`n"+$bad}
  'internal_comment' {$bad=$bad.Replace('"schema":','"schema":/* PRIVATE */')}
  'trailing_object_comma' {$bad=$bad.Substring(0,$bad.Length-1)+',}'}
  'trailing_array_comma' {$bad=$bad.Replace('"flags":0}]','"flags":0},]')}
  'junk' {$bad+=' PRIVATE'}
  'nan' {$bad=$bad.Replace('"maxTargets":48','"maxTargets":NaN')}
  'leading_zero' {$bad=$bad.Replace('"flags":0','"flags":00')}
  'invalid_whitespace' {$bad=([string][char]12)+$bad}
  'unicode_reason' {$bad=$failure.Replace('UNSUPPORTED_PLATFORM',('TIMEOUT'+[char]0x00ad))}
  'escaped_unicode_reason' {$bad=$failure.Replace('UNSUPPORTED_PLATFORM','TIMEOUT\u00ad')}
  'escaped_ascii_key' {$bad=$bad.Replace('"schema":','"sch\u0065ma":')}
  'unicode_key' {$bad=$bad.Replace('"schema":',('"schema'+[char]0x00ad+'":'))}
  'unicode_owner' {$bad=$bad.Replace('"owner":"SYSTEM"',('"owner":"SYSTEM'+[char]0x00ad+'"'))}
  'unicode_account' {$bad=$bad.Replace('"account":"CURRENT_USER"',('"account":"CURRENT_USER'+[char]0x00ad+'"'))}
  'excessive_depth' {$bad=$bad.Replace('"mask":2147483648','"mask":[[[[[[0]]]]]]')}
 }
 Assert-SourceAclRejected ('source_strict_grammar_'+$case) $bad
}
$unicodeFailure=New-SourceAclProbeFailure ('TIMEOUT'+[char]0x00ad)|ConvertFrom-Json
Assert-SourceAclEnvelope 'source_failure_reason_uses_ordinal_membership' ($unicodeFailure.reason -ceq 'OUTPUT_REJECTED')
$bootstrap=@('UNSUPPORTED_PLATFORM','UNSAFE_PROFILE','NATIVE_CONTEXT_UNVERIFIED','NATIVE_BUILD_UNAVAILABLE','NATIVE_BUILD_ACCESS_DENIED','NATIVE_BUILD_COMPILER_MISSING','NATIVE_BUILD_REFERENCE_UNAVAILABLE','NATIVE_BUILD_SOURCE_REJECTED','NATIVE_MODULE_MANAGEMENT_UNAVAILABLE','NATIVE_MODULE_SECURITY_UNAVAILABLE','NATIVE_MODULE_UTILITY_UNAVAILABLE','NATIVE_SIGNATURE_UNAVAILABLE','NATIVE_SOURCE_UNAVAILABLE','NATIVE_SOURCE_EMPTY','NATIVE_SOURCE_OVERSIZED','NATIVE_SOURCE_BASE64_REJECTED','NATIVE_SOURCE_UTF8_REJECTED','NATIVE_ENTRY_UNAVAILABLE','CHILD_START_UNAVAILABLE','TIMEOUT','CHILD_STOP_UNCONFIRMED','OUTPUT_REJECTED')
# Execute the actual production stdout statement against closed child bootstrap
# text. This reaches the same conversion boundary without replacing supervision
# or starting a child, and catches a Source-only converter erasing its phase.
$stdoutBranches=@((Get-Command Invoke-OwnerProbeObservation).ScriptBlock.Ast.FindAll({param($node) $node -is [System.Management.Automation.Language.IfStatementAst] -and $node.Extent.Text -cmatch '^if\(\$SourceAcl\)\{return '},$true))
if($stdoutBranches.Count -ne 1){throw 'SOURCE_ACL_STDOUT_BOUNDARY_FIXTURE_UNAVAILABLE'}
$stdoutBoundary=[ScriptBlock]::Create('param([string]$text,[switch]$SourceAcl) '+$stdoutBranches[0].Extent.Text)
$phasePreserved=$false
try {
 $phase=& $stdoutBoundary -text (New-OwnerProbeFailure 'NATIVE_BUILD_SOURCE_REJECTED') -SourceAcl|ConvertFrom-Json
 $phasePreserved=$phase.schema -ceq 'SOURCE_ACL_PROBE_V1' -and $phase.reason -ceq 'NATIVE_BUILD_SOURCE_REJECTED' -and $phase.observations.Count -eq 0
}catch{}
Assert-SourceAclEnvelope 'source_actual_stdout_boundary_preserves_child_bootstrap_phase' $phasePreserved
foreach($reason in @($bootstrap+@('IDENTITY_UNVERIFIED','TARGET_LIMIT','UNEXPECTED_FAILURE'))){
 $p=ConvertTo-SourceAclProbeClosedJson (New-SourceAclProbeFailure $reason)|ConvertFrom-Json
 Assert-SourceAclEnvelope ('source_failure_'+$reason) ($p.reason -ceq $reason -and $p.status -ceq 'INCOMPLETE' -and $p.observations.Count -eq 0)
}
foreach($reason in @('OBSERVED','OBSERVED_POLICY_MATCH','PRIVATE_DACL_UNVERIFIED','S-1-5-21-PRIVATE','C:\Users\PRIVATE','arbitrary exception')){
 $wire=New-SourceAclProbeFailure $reason
 Assert-SourceAclEnvelope ('source_failure_sanitizes_'+$sourceAclChecks) (($wire|ConvertFrom-Json).reason -ceq 'OUTPUT_REJECTED' -and $wire -cnotmatch 'PRIVATE|exception')
}
$p=New-SourceAclFixtureReport;$validWire=ConvertTo-SourceAclFixtureWire $p
$round=ConvertTo-SourceAclProbeClosedJson $validWire|ConvertFrom-Json
Assert-SourceAclEnvelope 'source_full_plan_preserves_metadata_without_recovery' ($round.observations.Count -eq 30 -and $round.observations[0].target -ceq 'VOLUME_ROOT' -and $round.observations[29].target -ceq 'WORK_CHANGES' -and $round.status -ceq 'METADATA_ONLY_COMPLETE' -and $round.reason -ceq 'OBSERVED' -and -not $round.recovered -and $round.g1 -ceq 'HOLD')
Assert-SourceAclEnvelope 'source_row_and_ace_closed_keys' ((@($round.observations[0].PSObject.Properties.Name)-join ',') -ceq 'target,status,storageVerified,attributesVerified,finalPathVerified,owner,dacl,aces' -and (@($round.observations[0].aces[0].PSObject.Properties.Name)-join ',') -ceq 'account,qualifier,mask,flags')
$p=New-SourceAclFixtureReport;$p.observations=@($p.observations|Where-Object {$_.target -cnotmatch '_ANCESTOR_'})
Assert-SourceAclEnvelope 'source_zero_optional_ancestor_chains' ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).observations.Count -eq 28)
$p=New-SourceAclFixtureReport;$rows=@((New-SourceAclFixtureRow 'VOLUME_ROOT'))
foreach($n in 1..7){$rows+=New-SourceAclFixtureRow ('PROFILE_ANCESTOR_0'+$n)}
$rows+=New-SourceAclFixtureRow 'PROFILE'
foreach($n in 1..7){$rows+=New-SourceAclFixtureRow ('SOURCE_ANCESTOR_0'+$n)}
$rows+=@($p.observations|Where-Object {$_.target -cnotmatch '_ANCESTOR_' -and $_.target -cnotin @('VOLUME_ROOT','PROFILE')});$p.observations=$rows
Assert-SourceAclEnvelope 'source_maximum_optional_chains' ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).observations.Count -eq 42)
foreach($owner in @('CURRENT_USER','SYSTEM','ADMINISTRATORS','TRUSTED_INSTALLER','OTHER')){
 $p=New-SourceAclFixtureReport;$p.observations[0].owner=$owner
 Assert-SourceAclEnvelope ('source_owner_'+$owner) ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).observations[0].owner -ceq $owner)
}
foreach($account in @('CURRENT_USER','SYSTEM','ADMINISTRATORS','TRUSTED_INSTALLER','APP_SILO','APP_CAPABILITY','APP_PACKAGE','EVERYONE','AUTHENTICATED_USERS','USERS','OTHER')){
 $p=New-SourceAclFixtureReport;$p.observations[0].aces[0].account=$account
 Assert-SourceAclEnvelope ('source_account_'+$account) ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).observations[0].aces[0].account -ceq $account)
}
foreach($qualifier in @('ALLOW','DENY','CALLBACK_ALLOW','CALLBACK_DENY','OTHER')){
 $p=New-SourceAclFixtureReport;$p.observations[0].aces[0].qualifier=$qualifier
 Assert-SourceAclEnvelope ('source_qualifier_'+$qualifier) ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).observations[0].aces[0].qualifier -ceq $qualifier)
}
foreach($mask in @([long]0,[long]2147483647,[long]2147483648,[long]4294967295)){
 $p=New-SourceAclFixtureReport;$p.observations[0].aces[0].mask=$mask;$p.observations[0].aces[0].flags=255
 $round=ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json
 Assert-SourceAclEnvelope ('source_uint32_mask_'+$mask) ($round.observations[0].aces[0].mask -eq $mask -and $round.observations[0].aces[0].flags -eq 255)
}
foreach($dacl in @('PRESENT','NULL','ABSENT')){
 $p=New-SourceAclFixtureReport;$p.observations[0].dacl=$dacl;$p.observations[0].aces=@()
 Assert-SourceAclEnvelope ('source_dacl_'+$dacl) ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).observations[0].dacl -ceq $dacl)
}
foreach($status in @('TARGET_MISSING','ACCESS_DENIED','ANCESTOR_UNVERIFIED','STORAGE_UNVERIFIED','ATTRIBUTES_UNVERIFIED','FINAL_PATH_UNVERIFIED','SECURITY_DESCRIPTOR_UNVERIFIED','TIMEOUT','UNEXPECTED_FAILURE')){
 $p=New-SourceAclFixtureReport;$row=$p.observations[0];$row.status=$status;$row.owner='UNOBSERVED';$row.dacl='UNOBSERVED';$row.aces=@()
 $row.storageVerified=$status -cin @('TARGET_MISSING','ACCESS_DENIED','ATTRIBUTES_UNVERIFIED','FINAL_PATH_UNVERIFIED','SECURITY_DESCRIPTOR_UNVERIFIED')
 $row.attributesVerified=$status -cin @('FINAL_PATH_UNVERIFIED','SECURITY_DESCRIPTOR_UNVERIFIED');$row.finalPathVerified=$status -ceq 'SECURITY_DESCRIPTOR_UNVERIFIED'
 Assert-SourceAclEnvelope ('source_refusal_row_'+$status) ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).status -ceq 'METADATA_ONLY_COMPLETE')
}
$p=New-SourceAclFixtureReport;$p.observations[0].status='ACE_LIMIT';$p.observations[0].aces=@();foreach($n in 1..16){$p.observations[0].aces+=New-SourceAclFixtureAce}
Assert-SourceAclEnvelope 'source_ace_limit_explicit_partial_metadata' ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).observations[0].aces.Count -eq 16)
foreach($reason in @('TIMEOUT','TARGET_LIMIT','UNEXPECTED_FAILURE')){
 $p=New-SourceAclFixtureReport;$p.status='INCOMPLETE';$p.reason=$reason;$p.observations=@($p.observations[0])
 Assert-SourceAclEnvelope ('source_partial_prefix_'+$reason) ((ConvertTo-SourceAclProbeClosedJson (ConvertTo-SourceAclFixtureWire $p)|ConvertFrom-Json).observations.Count -eq 1)
}
foreach($field in @('schema','authority','status','g1','reason')){
 $p=New-SourceAclFixtureReport;$p.$field='C:\Users\PRIVATE S-1-5-21-PRIVATE'
 Assert-SourceAclRejected ('source_header_leak_'+$field) (ConvertTo-SourceAclFixtureWire $p)
}
foreach($field in @('readOnly','metadataOnly','recovered','historicalStateProven')){
 $p=New-SourceAclFixtureReport;$p.$field=-not $p.$field
 Assert-SourceAclRejected ('source_header_wrong_bool_'+$field) (ConvertTo-SourceAclFixtureWire $p)
 $p=New-SourceAclFixtureReport;$p.$field='false'
 Assert-SourceAclRejected ('source_header_string_bool_'+$field) (ConvertTo-SourceAclFixtureWire $p)
}
foreach($field in @('maxTargets','maxAces','budgetSeconds')){
 foreach($value in @(-1,0,49,'48',$true,$null)){
  $p=New-SourceAclFixtureReport;$p.$field=$value
  Assert-SourceAclRejected ('source_header_limit_'+$field+'_'+$sourceAclChecks) (ConvertTo-SourceAclFixtureWire $p)
 }
}
foreach($key in @('schema','authority','status','readOnly','metadataOnly','recovered','g1','historicalStateProven','maxTargets','maxAces','budgetSeconds','reason','observations')){
 $p=New-SourceAclFixtureReport;$p.PSObject.Properties.Remove($key)
 Assert-SourceAclRejected ('source_missing_header_'+$key) (ConvertTo-SourceAclFixtureWire $p)
}
$p=New-SourceAclFixtureReport;$p|Add-Member -NotePropertyName path -NotePropertyValue 'C:\Users\PRIVATE'
Assert-SourceAclRejected 'source_unknown_header_key' (ConvertTo-SourceAclFixtureWire $p)
foreach($field in @('target','status','owner','dacl')){
 foreach($value in @('C:\Users\PRIVATE','S-1-5-21-PRIVATE','current_user',$null,1,$true)){
  $p=New-SourceAclFixtureReport;$p.observations[0].$field=$value
  Assert-SourceAclRejected ('source_row_enum_'+$field+'_'+$sourceAclChecks) (ConvertTo-SourceAclFixtureWire $p)
 }
}
foreach($field in @('storageVerified','attributesVerified','finalPathVerified')){
 foreach($value in @('true',0,$null)){
  $p=New-SourceAclFixtureReport;$p.observations[0].$field=$value
  Assert-SourceAclRejected ('source_row_bool_'+$field+'_'+$sourceAclChecks) (ConvertTo-SourceAclFixtureWire $p)
 }
}
foreach($key in @('target','status','storageVerified','attributesVerified','finalPathVerified','owner','dacl','aces')){
 $p=New-SourceAclFixtureReport;$p.observations[0].PSObject.Properties.Remove($key)
 Assert-SourceAclRejected ('source_missing_row_'+$key) (ConvertTo-SourceAclFixtureWire $p)
}
$p=New-SourceAclFixtureReport;$p.observations[0]|Add-Member -NotePropertyName sid -NotePropertyValue 'S-1-5-21-PRIVATE'
Assert-SourceAclRejected 'source_unknown_row_key' (ConvertTo-SourceAclFixtureWire $p)
foreach($field in @('account','qualifier')){
 foreach($value in @('S-1-5-21-PRIVATE','C:\Users\PRIVATE','allow',$null,1,$true)){
  $p=New-SourceAclFixtureReport;$p.observations[0].aces[0].$field=$value
  Assert-SourceAclRejected ('source_ace_enum_'+$field+'_'+$sourceAclChecks) (ConvertTo-SourceAclFixtureWire $p)
 }
}
foreach($key in @('account','qualifier','mask','flags')){
 $p=New-SourceAclFixtureReport;$p.observations[0].aces[0].PSObject.Properties.Remove($key)
 Assert-SourceAclRejected ('source_missing_ace_'+$key) (ConvertTo-SourceAclFixtureWire $p)
}
$p=New-SourceAclFixtureReport;$p.observations[0].aces[0]|Add-Member -NotePropertyName text -NotePropertyValue 'PRIVATE CONTENT'
Assert-SourceAclRejected 'source_unknown_ace_key' (ConvertTo-SourceAclFixtureWire $p)
foreach($token in @('-1','4294967296','1.5','1.0','1e0','true','"0"','null','{}','[]','9223372036854775808')){
 Assert-SourceAclRejected ('source_mask_invalid_token_'+$sourceAclChecks) ($validWire.Replace('"mask":2147483648',('"mask":'+$token)))
}
foreach($token in @('-1','256','1.5','1.0','1e0','true','"0"','null','{}','[]','4294967296')){
 Assert-SourceAclRejected ('source_flags_invalid_token_'+$sourceAclChecks) ($validWire.Replace('"flags":0',('"flags":'+$token)))
}
foreach($token in @('48.0','4.8e1','"48"','true','null')){Assert-SourceAclRejected ('source_header_numeric_token_'+$sourceAclChecks) ($validWire.Replace('"maxTargets":48',('"maxTargets":'+$token)))}
foreach($shape in @('null','{}','true','0','"PRIVATE"')){
 Assert-SourceAclRejected ('source_observations_type_'+$sourceAclChecks) ($failure.Replace('"observations":[]',('"observations":'+$shape)))
 $p=New-SourceAclFixtureReport;$p.observations[0].aces=$null
 Assert-SourceAclRejected ('source_aces_type_'+$sourceAclChecks) ((ConvertTo-SourceAclFixtureWire $p).Replace('"aces":null',('"aces":'+$shape)))
}
foreach($case in @('duplicate','swap','profile_gap','source_gap','profile_08','source_08','missing_fixed','missing_root','old_identity','old_layout','null_row','too_many_targets','too_many_aces','null_ace','owner_unobserved_success','descriptor_without_final','bool_chain','null_dacl_with_aces','unobserved_dacl','refusal_with_aces','ace_limit_short','incomplete_observed','complete_failure','complete_short','bootstrap_facts')){
 $p=New-SourceAclFixtureReport
 switch($case){
  'duplicate' {$p.observations[1].target='VOLUME_ROOT'}
  'swap' {$tmp=$p.observations[5];$p.observations[5]=$p.observations[6];$p.observations[6]=$tmp}
  'profile_gap' {$p.observations[1].target='PROFILE_ANCESTOR_02'}
  'source_gap' {$p.observations[3].target='SOURCE_ANCESTOR_02'}
  'profile_08' {$p.observations[1].target='PROFILE_ANCESTOR_08'}
  'source_08' {$p.observations[3].target='SOURCE_ANCESTOR_08'}
  'missing_fixed' {$p.observations=@($p.observations|Where-Object {$_.target -cne 'JOURNAL'})}
  'missing_root' {$p.observations=$p.observations[1..29]}
  'old_identity' {$p.observations[0].target='IDENTITY'}
  'old_layout' {$p.observations[16].target='LAYOUT'}
  'null_row' {$p.observations[0]=$null}
  'too_many_targets' {$p.observations=@();foreach($n in 1..49){$p.observations+=New-SourceAclFixtureRow 'VOLUME_ROOT'}}
  'too_many_aces' {$p.observations[0].aces=@();foreach($n in 1..17){$p.observations[0].aces+=New-SourceAclFixtureAce}}
  'null_ace' {$p.observations[0].aces=@($null)}
  'owner_unobserved_success' {$p.observations[0].owner='UNOBSERVED'}
  'descriptor_without_final' {$p.observations[0].finalPathVerified=$false}
  'bool_chain' {$p.observations[0].storageVerified=$false}
  'null_dacl_with_aces' {$p.observations[0].dacl='NULL'}
  'unobserved_dacl' {$p.observations[0].dacl='UNOBSERVED'}
  'refusal_with_aces' {$p.observations[0].status='SECURITY_DESCRIPTOR_UNVERIFIED'}
  'ace_limit_short' {$p.observations[0].status='ACE_LIMIT'}
  'incomplete_observed' {$p.status='INCOMPLETE'}
  'complete_failure' {$p.reason='TIMEOUT'}
  'complete_short' {$p.observations=@($p.observations[0])}
  'bootstrap_facts' {$p.status='INCOMPLETE';$p.reason='NATIVE_BUILD_UNAVAILABLE';$p.observations=@($p.observations[0])}
 }
 Assert-SourceAclRejected ('source_refuses_'+$case) (ConvertTo-SourceAclFixtureWire $p)
}
Assert-SourceAclRejected 'source_duplicate_header_json_key' ($validWire.Replace('"schema":"SOURCE_ACL_PROBE_V1"','"schema":"SOURCE_ACL_PROBE_V1","schema":"SOURCE_ACL_PROBE_V1"'))
Assert-SourceAclRejected 'source_duplicate_row_json_key' ($validWire.Replace('"target":"VOLUME_ROOT"','"target":"VOLUME_ROOT","target":"VOLUME_ROOT"'))
Assert-SourceAclRejected 'source_duplicate_ace_json_key' ($validWire.Replace('"mask":2147483648','"mask":2147483648,"mask":2147483648'))
foreach($text in @('', 'null','[]','{}',($validWire+"`nPRIVATE CHILD OUTPUT"),($validWire+$validWire),$validWire.Replace('SOURCE_ACL_PROBE_V1','OWNER_PROBE_V1'))){Assert-SourceAclRejected ('source_invalid_wire_'+$sourceAclChecks) $text}
$atLimit=$failure+(' '*(131072-[Text.Encoding]::UTF8.GetByteCount($failure)))
Assert-SourceAclEnvelope 'source_accepts_exact_utf8_byte_limit' ((ConvertTo-SourceAclProbeClosedJson $atLimit|ConvertFrom-Json).reason -ceq 'UNSUPPORTED_PLATFORM')
Assert-SourceAclRejected 'source_rejects_over_utf8_byte_limit' ($atLimit+' ')
Assert-SourceAclRejected 'source_rejects_multibyte_oversized_text' ($failure+([string][char]0x2003)*44000)
$legacy=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'
Assert-SourceAclEnvelope 'legacy_failure_schema_unchanged' ((ConvertTo-OwnerProbeClosedJson $legacy|ConvertFrom-Json).schema -ceq 'OWNER_PROBE_V1')
$legacyBoundary=$legacy+(' '*(16384-$legacy.Length))
Assert-SourceAclEnvelope 'legacy_accepts_existing_output_limit' ((ConvertTo-OwnerProbeClosedJson $legacyBoundary|ConvertFrom-Json).reason -ceq 'UNSUPPORTED_PLATFORM')
$refused=$false;try{$null=ConvertTo-OwnerProbeClosedJson ($legacyBoundary+' ')}catch{$refused=$true}
Assert-SourceAclEnvelope 'legacy_rejects_larger_output' $refused
Assert-SourceAclRejected 'source_validator_rejects_legacy_schema' $legacy
$refused=$false;try{$null=ConvertTo-OwnerProbeClosedJson $failure}catch{$refused=$true}
Assert-SourceAclEnvelope 'legacy_validator_rejects_source_schema' $refused
Assert-SourceAclEnvelope 'source_supervisor_has_fixed_selector' ((Get-Command Invoke-OwnerProbeObservation).Parameters.ContainsKey('SourceAcl'))
# Test the same resolver called at the real child stdout boundary directly.
# No supervisor replacement may bypass child conversion or erase its evidence.
foreach($reason in $bootstrap){
 $result=Resolve-SourceAclProbeOutput (New-OwnerProbeFailure $reason)|ConvertFrom-Json
 Assert-SourceAclEnvelope ('source_stdout_maps_empty_legacy_'+$reason) ($result.schema -ceq 'SOURCE_ACL_PROBE_V1' -and $result.reason -ceq $reason -and $result.observations.Count -eq 0)
}
foreach($pair in @(
 @('schema','"OWNER_PROBE_V1"'),@('authority','"NOT_AUTHORITATIVE"'),@('status','"INCOMPLETE"'),
 @('readOnly','true'),@('metadataOnly','true'),@('recovered','false'),@('g1','"HOLD"'),
 @('historicalStateProven','false'),@('allFixedTargetsObserved','false'),@('target','"NONE"'),
 @('reason','"UNSUPPORTED_PLATFORM"'),@('observations','[]')
)){
 $property='"'+$pair[0]+'":'+$pair[1]
 $duplicated=$legacy.Replace($property,($property+','+$property))
 $result=Resolve-SourceAclProbeOutput $duplicated|ConvertFrom-Json
 Assert-SourceAclEnvelope ('source_stdout_refuses_duplicate_legacy_'+$pair[0]) ($result.reason -ceq 'OUTPUT_REJECTED' -and $result.observations.Count -eq 0)
}
foreach($wire in @(('['+$legacy+']'),('/* PRIVATE */'+$legacy),($legacy.Substring(0,$legacy.Length-1)+',}'),$legacy.Replace('UNSUPPORTED_PLATFORM',('TIMEOUT'+[char]0x00ad)))){
 $result=Resolve-SourceAclProbeOutput $wire
 Assert-SourceAclEnvelope ('source_stdout_refuses_noncanonical_legacy_'+$sourceAclChecks) (($result|ConvertFrom-Json).reason -ceq 'OUTPUT_REJECTED' -and $result -cnotmatch 'PRIVATE')
}
$result=Resolve-SourceAclProbeOutput $validWire|ConvertFrom-Json
Assert-SourceAclEnvelope 'source_stdout_preserves_closed_source' ($result.status -ceq 'METADATA_ONLY_COMPLETE' -and $result.observations.Count -eq 30)
$legacyFact=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'|ConvertFrom-Json
$legacyFact.target='IDENTITY';$legacyFact.reason='IDENTITY_UNVERIFIED';$legacyFact.observations=@(@{target='IDENTITY';reason='IDENTITY_UNVERIFIED';storageVerified=$false;attributesVerified=$false;finalPathVerified=$false;owner='UNOBSERVED';dacl='UNOBSERVED'})
$legacyFactWire=ConvertTo-SourceAclFixtureWire $legacyFact
Assert-SourceAclEnvelope 'legacy_fact_fixture_is_real_closed_legacy' ((ConvertTo-OwnerProbeClosedJson $legacyFactWire|ConvertFrom-Json).observations.Count -eq 1)
foreach($wire in @($legacyFactWire,($legacy.Replace('"target":"NONE"','"target":"PROFILE"')),$validWire.Replace('"owner":"SYSTEM"','"owner":"S-1-5-21-PRIVATE"'),($failure+"`nPRIVATE STDOUT"),('C:\Users\PRIVATE S-1-5-21-PRIVATE'))){
 $result=Resolve-SourceAclProbeOutput $wire
 Assert-SourceAclEnvelope ('source_stdout_refuses_nonclosed_or_legacy_facts_'+$sourceAclChecks) (($result|ConvertFrom-Json).reason -ceq 'OUTPUT_REJECTED' -and ($result|ConvertFrom-Json).observations.Count -eq 0 -and $result -cnotmatch 'PRIVATE|S-1-5')
}
Write-Output ('SOURCE_ACL_ENVELOPE_PASS='+$sourceAclChecks)
