Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '../goriq-source-private-acl-repair.ps1'
if(-not (Test-Path -LiteralPath $path)){throw 'SOURCE_REPAIR_WRAPPER_ASSERTION:IMPLEMENTATION_MISSING'}
. $path
$checks=0
function Assert-RepairWrapper([string]$Name,[bool]$Value){if(-not $Value){throw ('SOURCE_REPAIR_WRAPPER_ASSERTION:'+$Name)};$script:checks++}
$scope='830e91deef9611ecd0804dfeacd189bb300120ab8fa2effd0bb72bb9b3766c2f';$implementation='a'*64
function New-FixtureRepair([string]$Status='APPLIED') {
 $r=[ordered]@{status=$Status;reason='VERIFIED_SAMPLE';plannedObjects=2;changedObjects=2;restoredObjects=0;scopeSha256=$scope;planSha256=('b'*64);implementationSha256=$implementation;backupId='1219-source-acl-42-1';consistency='LIVE_SAMPLED';manualRecovery=$false;globalRestoreComplete=$false;originalDataPreservationVerified=$false}
 if($Status -ceq 'PLANNED'){$r.reason='METADATA_ONLY';$r.changedObjects=0;$r.backupId=''}
 if($Status -ceq 'REFUSED'){$r.reason='SCOPE_EXPIRED';$r.plannedObjects=0;$r.changedObjects=0;$r.planSha256='';$r.implementationSha256='';$r.backupId=''}
 return $r
}
foreach($status in @('PLANNED','APPLIED','REFUSED')){
 $raw=New-FixtureRepair $status|ConvertTo-Json -Compress
 $r=ConvertTo-GoriqSourceRepairClosedJson $raw ($status -cne 'PLANNED') $implementation|ConvertFrom-Json
 Assert-RepairWrapper ('accept_'+$status) ($r.status -ceq $status -and -not $r.originalDataPreservationVerified)
}
foreach($kind in @('extra','missing','duplicate','root_array','comment','unicode','escape','trailing_comma','unknown_status','unknown_reason','scope','plan','implementation','backup_path','backup_newline','count_negative','count_large','count_fraction','count_string','bool_number','false_preservation','false_complete','false_rollback','changed_greater','restored_greater','phase_confusion','planned_write')){
 $r=New-FixtureRepair;$apply=$true
 switch($kind){
  'extra' {$r.secret='PRIVATE'}
  'missing' {$r.Remove('reason')}
  'unknown_status' {$r.status='PRIVATE'}
  'unknown_reason' {$r.reason='PRIVATE'}
  'scope' {$r.scopeSha256='c'*64}
  'plan' {$r.planSha256='invalid'}
  'implementation' {$r.implementationSha256='c'*64}
  'backup_path' {$r.backupId='C:\PRIVATE'}
  'backup_newline' {$r.backupId="1219-source-acl-42-1`n"}
  'count_negative' {$r.changedObjects=-1}
  'count_large' {$r.plannedObjects=17}
  'count_fraction' {$r.plannedObjects=2.5}
  'count_string' {$r.plannedObjects='2'}
  'bool_number' {$r.manualRecovery=0}
  'false_preservation' {$r.originalDataPreservationVerified=$true}
  'false_complete' {$r.globalRestoreComplete=$true}
  'false_rollback' {$r.manualRecovery=$true}
  'changed_greater' {$r.changedObjects=3}
  'restored_greater' {$r.restoredObjects=3}
  'phase_confusion' {$apply=$false}
  'planned_write' {$r=New-FixtureRepair 'PLANNED';$r.changedObjects=1;$apply=$false}
 }
 $raw=$r|ConvertTo-Json -Compress
 switch($kind){
  'duplicate' {$raw=$raw.Replace('{','{"status":"APPLIED",')}
  'root_array' {$raw='['+$raw+']'}
  'comment' {$raw=$raw.Replace('{','{/*PRIVATE*/')}
  'unicode' {$raw=$raw.Replace('VERIFIED_SAMPLE',('VERIFIED'+[char]0x00ad+'_SAMPLE'))}
  'escape' {$raw=$raw.Replace('VERIFIED_SAMPLE','\u0056ERIFIED_SAMPLE')}
  'trailing_comma' {$raw=$raw.Substring(0,$raw.Length-1)+',}'}
 }
 $rejected=$false;try{$null=ConvertTo-GoriqSourceRepairClosedJson $raw $apply $implementation}catch{$rejected=$true}
 Assert-RepairWrapper ('reject_'+$kind) $rejected
}

# Native context and compiler are external boundaries; the production entry and
# closed-envelope logic execute unchanged in these controlled invocation cases.
$initial=[Environment]::GetEnvironmentVariables()
try {
 $fixtureCapture='/* capture fixture */'*10;$fixtureRepair='/* repair fixture */'*10
 $h=[Security.Cryptography.SHA256]::Create()
 try{$implementation=[BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($fixtureCapture+"`n"+$fixtureRepair))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}
 $context=@{GITHUB_REPOSITORY='haji84/AI-';GITHUB_ACTOR='haji84';GITHUB_TRIGGERING_ACTOR='haji84';GITHUB_REF='refs/heads/main';GITHUB_EVENT_NAME='workflow_dispatch';RUNNER_NAME='ZBook';RUNNER_OS='Windows';GITHUB_SHA=('a'*40);GITHUB_RUN_ID='42';GITHUB_RUN_ATTEMPT='1';GORIQ_SOURCE_REPAIR_PHASE='plan';GORIQ_SOURCE_ACL_IMPLEMENTATION_SHA256=$implementation}
 foreach($key in $context.Keys){[Environment]::SetEnvironmentVariable($key,$context[$key])}
 $script:nativeCalls=0;$script:compilerCalls=0;$script:contextGood=$true;$script:emitExtra=$false;$script:throwNative=$false
 function Get-GoriqSourceRepairNativeContext {return $script:contextGood}
 function Initialize-GoriqSourceRepairNative([string]$Source){$script:compilerCalls++}
 function Invoke-GoriqSourceRepairNative([bool]$Apply){$script:nativeCalls++;if($script:throwNative){throw 'PRIVATE_NATIVE_ERROR'};if($script:emitExtra){Write-Output 'PRIVATE_EXTRA'};New-FixtureRepair $(if($Apply){'APPLIED'}else{'PLANNED'})|ConvertTo-Json -Compress}
 $r=Invoke-GoriqSourcePrivateAclRepair $fixtureCapture $fixtureRepair $false|ConvertFrom-Json
 Assert-RepairWrapper 'plan_entry_calls_checked_native_once' ($r.status -ceq 'PLANNED' -and $script:nativeCalls -eq 1 -and $script:compilerCalls -eq 1)
 foreach($key in @('GITHUB_ACTOR','GITHUB_TRIGGERING_ACTOR','GITHUB_REF','GITHUB_EVENT_NAME','RUNNER_NAME','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GORIQ_SOURCE_REPAIR_PHASE','GORIQ_SOURCE_ACL_IMPLEMENTATION_SHA256')){
  [Environment]::SetEnvironmentVariable($key,'untrusted');$before=$script:nativeCalls
  $r=Invoke-GoriqSourcePrivateAclRepair $fixtureCapture $fixtureRepair $false|ConvertFrom-Json
  Assert-RepairWrapper ('entry_refuses_'+$key) ($r.status -ceq 'REFUSED' -and $r.changedObjects -eq 0 -and $script:nativeCalls -eq $before)
  [Environment]::SetEnvironmentVariable($key,$context[$key])
 }
 $script:contextGood=$false;$before=$script:nativeCalls;$r=Invoke-GoriqSourcePrivateAclRepair $fixtureCapture $fixtureRepair $false|ConvertFrom-Json
 Assert-RepairWrapper 'native_context_refuses_before_compiler_or_execution' ($r.reason -ceq 'NATIVE_CONTEXT_UNVERIFIED' -and $script:nativeCalls -eq $before);$script:contextGood=$true
 foreach($kind in @('extra','throw')){
  $script:emitExtra=$kind -ceq 'extra';$script:throwNative=$kind -ceq 'throw';$closed=$false
  try{$null=Invoke-GoriqSourcePrivateAclRepair $fixtureCapture $fixtureRepair $false}catch{$closed=$_.Exception.Message -ceq 'SOURCE_ACL_EXECUTION_UNVERIFIED'}
  Assert-RepairWrapper ('unknown_native_outcome_is_not_falsely_refused_zero_'+$kind) $closed
 }
 $script:emitExtra=$false;$script:throwNative=$false;$env:GORIQ_SOURCE_REPAIR_PHASE='apply'
 $r=Invoke-GoriqSourcePrivateAclRepair $fixtureCapture $fixtureRepair $true|ConvertFrom-Json
 Assert-RepairWrapper 'explicit_apply_has_distinct_verified_outcome' ($r.status -ceq 'APPLIED' -and $r.changedObjects -eq 2 -and -not $r.originalDataPreservationVerified)
} finally {
 foreach($key in @([Environment]::GetEnvironmentVariables().Keys)){if(-not $initial.Contains($key)){[Environment]::SetEnvironmentVariable([string]$key,[NullString]::Value)}}
 foreach($key in $initial.Keys){[Environment]::SetEnvironmentVariable([string]$key,[string]$initial[$key])}
}

Write-Output ('SOURCE_REPAIR_WRAPPER_PASS='+$checks)
