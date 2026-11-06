param([string]$Scenario)
$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-task-credential-retention-proof-1218.ps1'
. $source
function Require([bool]$Value,[string]$Code){if(-not $Value){throw ('RETENTION_CANDIDATE_'+$Code)}}
if($Scenario -like 'profile-*'){
 Add-Type 'public static class R05FixtureNative {public static bool BatchRight(string sid,int op,System.Action check){check();return false;}}'
 $tokens=$null;$errors=$null;$profileAst=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
 $cleanupCode=$profileAst.Find({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$cleanup'},$true).Extent.Text
 function Get-LocalUser {
  param($Name,$ErrorAction)
  $script:pstate.localReads++
  if($script:pstate.localReads -eq 3 -and $Scenario -eq 'profile-reserve'){$script:pstate.clock.utc=$script:pstate.clock.utc.AddSeconds(104.75);$script:pstate.clock.mono=104.75}
  if($script:pstate.localReads -eq 3 -and $Scenario -eq 'profile-preexpiry'){$script:pstate.clock.utc=$script:pstate.clock.utc.AddSeconds(601);$script:pstate.clock.mono=601}
  if(-not $script:pstate.accountRemoved){return [pscustomobject]@{SID=[pscustomobject]@{Value='S-1-5-21-111-222-333-444'}}}
 }
 function Disable-LocalUser {param($InputObject)$script:pstate.disabled++}
 function Remove-LocalUser {param($InputObject)$script:pstate.accountRemoved=$true}
 function Start-Sleep {
  param($Milliseconds)
  Require ($Milliseconds -gt 0 -and $Milliseconds -le 500) 'SLEEP_AT_MOST_500MS'
  $script:pstate.sleeps++
  $u=$Milliseconds/1000.0;$m=$u
  if($Scenario -eq 'profile-no-progress'){$u=0;$m=0}
  if($Scenario -eq 'profile-utc-cap'){$m=0.001}
  if($Scenario -eq 'profile-mono-cap'){$u=0.001}
  if($Scenario -in @('profile-poll-cap','profile-final-readback-cap')){$u=0.001;$m=0.001}
  $script:pstate.clock.utc=$script:pstate.clock.utc.AddSeconds($u);$script:pstate.clock.mono+=$m
 }
 function Get-CimInstance {
  param($ClassName,$Filter)
  Require ($ClassName -ceq 'Win32_UserProfile' -and $Filter -ceq 'SID="S-1-5-21-111-222-333-444"') 'EXACT_OWN_PROFILE_QUERY'
  $script:pstate.queries++;$q=$script:pstate.queries
  if($script:pstate.readinessEnded){$script:pstate.readbackQueries++}else{$script:pstate.readinessQueries++}
  if($Scenario -eq 'profile-query-throw' -and $q -eq 2){throw [Runtime.InteropServices.COMException]::new('PRIVATE_PROFILE_QUERY_CANARY',-2147024891)}
  if($Scenario -eq 'profile-readback-throw' -and $q -eq 2){throw [Runtime.InteropServices.COMException]::new('PRIVATE_PROFILE_READBACK_CANARY',-2147024891)}
  if($Scenario -eq 'profile-inflight-expiry'){$script:pstate.clock.utc=$script:pstate.clock.utc.AddSeconds(121);$script:pstate.clock.mono=121}
  if($Scenario -eq 'profile-absent' -or ($Scenario -eq 'profile-disappeared' -and $q -gt 1) -or ($Scenario -eq 'profile-ready' -and $q -gt 2) -or ($Scenario -eq 'profile-final-readback-cap' -and $q -eq 62)){$script:pstate.readinessEnded=$true;return}
  $loaded=$Scenario -notin @('profile-absent','profile-readback-present','profile-readback-throw')
  if(($Scenario -eq 'profile-ready' -and $q -eq 2) -or ($Scenario -eq 'profile-final-readback-cap' -and $q -eq 61)){$loaded=$false}
  if(-not $loaded){$script:pstate.readinessEnded=$true}
  $sid=if($Scenario -eq 'profile-wrong-later' -and $q -eq 2){'S-1-5-21-111-222-333-555'}else{'S-1-5-21-111-222-333-444'}
  return [pscustomobject]@{SID=$sid;Special=($Scenario -eq 'profile-special-later' -and $q -eq 2);Loaded=$loaded}
 }
 function Remove-CimInstance {param($InputObject)Require ($InputObject.SID -ceq 'S-1-5-21-111-222-333-444' -and -not $InputObject.Special -and -not $InputObject.Loaded) 'REMOVE_ONLY_READY_OWN_PROFILE';$script:pstate.removes++}
 function Invoke-ProfileFixture {
  $clock=@{utc=[datetimeoffset]::Parse('2026-11-06T04:00:00Z');mono=[double]0}
  $budget=New-R05ProofBudget -ScopeExpiry $clock.utc.AddHours(1) -JobDeadline $clock.utc.AddSeconds(660) -UtcClock {$clock.utc}.GetNewClosure() -MonoClock {$clock.mono}.GetNewClosure()
  $owned=@{stage='fixture';registered=$false;sid='S-1-5-21-111-222-333-444';userName='PUBLIC_NOT_AN_ACCOUNT';rootCreated=$false;rootAttempted=$false}
  $result=New-R05FixtureResult;$budget.Diagnostics=$result.diagnostics;$result.accountCreated=$true
  $script:pstate=@{clock=$clock;queries=0;sleeps=0;removes=0;disabled=0;localReads=0;accountRemoved=$false;readinessQueries=0;readbackQueries=0;readinessEnded=$false}
  Invoke-Expression $cleanupCode
  $outcome=Invoke-R05BudgetedRun $budget {} $cleanup
  if($Scenario -eq 'profile-final-readback-cap'){
   Require ($script:pstate.readinessQueries -eq 61 -and $script:pstate.readbackQueries -eq 1 -and $script:pstate.queries -eq 62 -and $script:pstate.sleeps -eq 60 -and $script:pstate.removes -eq 1) 'QUERY61_READY_THEN_SEPARATE_READBACK62_NO_FURTHER_QUERY'
   Require ($result.cleanupVerified -and $outcome.cleanupCompleted -and $result.ownProfileRemovedOrAbsent -and $result.diagnostics.profileCleanupState -eq 'REMOVED_AND_ABSENT_CONFIRMED' -and $null -eq $result.diagnostics.cleanupFailure) 'FINAL_ALLOWED_READY_PATH_CONFIRMED_ABSENT'
  }elseif($Scenario -in @('profile-ready','profile-disappeared','profile-absent')){
   Require ($result.cleanupVerified -and $outcome.cleanupCompleted -and $null -eq $outcome.failureCode -and $null -eq $result.diagnostics.cleanupFailure) 'TRANSIENT_LOADED_RECOVERS_WITHOUT_TERMINAL_FAULT'
   Require ($result.ownProfileRemovedOrAbsent -and $script:pstate.queries -eq $(if($Scenario -eq 'profile-absent'){2}else{3})) 'FINAL_EXPLICIT_ABSENCE_READBACK_REQUIRED'
   Require ($script:pstate.removes -eq $(if($Scenario -eq 'profile-ready'){1}else{0})) 'REMOVE_ONLY_MEASURED_READY_PROFILE'
   Require ($result.diagnostics.profileCleanupState -eq $(if($Scenario -eq 'profile-ready'){'REMOVED_AND_ABSENT_CONFIRMED'}else{'ABSENT_CONFIRMED'})) 'CONFIRMED_PROFILE_STATE'
  }elseif($Scenario -in @('profile-preexpiry','profile-inflight-expiry')){
   Require (-not $result.cleanupVerified -and -not $script:pstate.accountRemoved -and $script:pstate.removes -eq 0) 'NO_EFFECT_AFTER_ORIGINAL_SHARED_EXPIRY'
   Require ($script:pstate.queries -eq $(if($Scenario -eq 'profile-preexpiry'){0}else{1})) 'NO_LATER_QUERY_AFTER_EXPIRY'
   Require ($result.diagnostics.profileCleanupState -eq 'NOT_CHECKED') 'NO_FABRICATED_LOADED_FROM_LATE_UNADMITTED_RETURN'
   Require ($budget.HardExpired -or $budget.CleanupExpired) 'ORIGINAL_EXPIRY_AUTHORITATIVE'
  }else{
   Require (-not $result.cleanupVerified -and -not $result.ownProfileRemovedOrAbsent -and $script:pstate.accountRemoved) 'FAILURE_PRESERVED_AND_ACCOUNT_CLEANUP_INDEPENDENT'
   if($Scenario -in @('profile-still-loaded','profile-no-progress','profile-reserve','profile-utc-cap','profile-mono-cap','profile-poll-cap')){
    Require ($result.diagnostics.profileCleanupState -eq 'LOADED_REFUSED' -and $script:pstate.removes -eq 0) 'STILL_LOADED_NOT_REMOVED'
    Require (-not $budget.HardExpired -and -not $budget.CleanupExpired) 'READINESS_REFUSAL_DOES_NOT_POISON_SHARED_CLOCK'
    if($Scenario -eq 'profile-no-progress'){Require ($script:pstate.queries -eq 1 -and $script:pstate.sleeps -eq 1) 'ONE_STALLED_SLEEP_THEN_STOP'}
    elseif($Scenario -eq 'profile-reserve'){Require ($script:pstate.queries -eq 1 -and $script:pstate.sleeps -eq 0 -and $clock.mono -eq 104.75) 'NO_SLEEP_CROSSING_15S_RESERVE'}
    elseif($Scenario -eq 'profile-poll-cap'){Require ($script:pstate.queries -le 61 -and $script:pstate.queries -ge 60 -and $script:pstate.sleeps -eq 60 -and $clock.mono -lt 1) 'INDEPENDENT_POLL_CAP'}
    else{Require ($script:pstate.queries -ge 59 -and $script:pstate.queries -le 61 -and $script:pstate.sleeps -le 60 -and ($clock.mono -le 30) -and ($clock.utc-[datetimeoffset]::Parse('2026-11-06T04:00:00Z')).TotalSeconds -le 30) 'BOTH_UTC_AND_MONOTONIC_30S_CAP'}
   }elseif($Scenario -in @('profile-wrong-later','profile-special-later')){
    Require ($script:pstate.queries -eq 2 -and $script:pstate.removes -eq 0) 'EACH_REQUERY_VALIDATES_SID_AND_SPECIAL'
    Require ($result.diagnostics.profileCleanupState -eq $(if($Scenario -eq 'profile-wrong-later'){'SID_MISMATCH_REFUSED'}else{'SPECIAL_REFUSED'})) 'LATER_MEASURED_IDENTITY_REFUSAL'
   }elseif($Scenario -in @('profile-query-throw','profile-readback-throw')){
    Require ($result.diagnostics.profileCleanupState -eq $(if($Scenario -eq 'profile-query-throw'){'QUERY_FAILED'}else{'READBACK_FAILED'})) 'MEASURED_QUERY_PHASE'
    $f=$result.diagnostics.cleanupFailure;Require ($f.exceptionKind -eq 'COM' -and $f.hresult -eq -2147024891 -and $f.origin -eq 'CALL_THROW' -and $f.callState -eq 'THREW' -and $f.operation -eq $(if($Scenario -eq 'profile-query-throw'){'PROFILE_QUERY'}else{'PROFILE_READBACK'})) 'ORIGINAL_TYPED_QUERY_CAUSE_RETAINED'
   }else{Require ($Scenario -eq 'profile-readback-present' -and $script:pstate.removes -eq 1 -and $result.diagnostics.profileCleanupState -eq 'STILL_PRESENT') 'READINESS_NOT_FINAL_ABSENCE'}
  }
  if($Scenario -ne 'profile-final-readback-cap'){
   Require ($script:pstate.queries -le 61 -and $script:pstate.sleeps -le 60) 'HARD_POLL_AND_SLEEP_CAPS'
  }
  Require ($script:pstate.readinessQueries -le 61 -and $script:pstate.readbackQueries -le 1 -and $script:pstate.queries -eq ($script:pstate.readinessQueries+$script:pstate.readbackQueries) -and $script:pstate.queries -le 62 -and $script:pstate.sleeps -le 60) 'SEPARATE_READINESS_AND_FINAL_READBACK_CAPS'
 }
 Invoke-ProfileFixture
 @{scenario=$Scenario;pass=$true;realTaskServiceCredentialCalls=0}|ConvertTo-Json -Compress
 exit 0
}
if($Scenario -eq 'readonly-com'){
 Require ($env:OS -ceq 'Windows_NT' -and $env:GITHUB_ACTIONS -ceq 'true' -and $env:RUNNER_ENVIRONMENT -ceq 'github-hosted') 'HOSTED_READONLY_GATE'
 $readService=$null;$root=$null;$readPass=$false;$readCode=$null;$script:readCalls=0
 try{
  Require ([bool](Get-Command Initialize-R05TaskUpdateBinding -ErrorAction SilentlyContinue)) 'BINDING_REQUIRED'
  $now=[datetimeoffset]::UtcNow;$readBudget=New-R05ProofBudget -ScopeExpiry $now.AddHours(1) -JobDeadline $now.AddSeconds(660)
  $null=Invoke-R05ProtectedApi $readBudget Forward {Initialize-R05TaskUpdateBinding}
  $readService=Invoke-R05ProtectedApi $readBudget Forward {$script:readCalls+=1;New-R05TaskUpdateService}
  $null=Invoke-R05ProtectedApi $readBudget Forward {$script:readCalls+=1;[R05TaskUpdateBinding]::Connect($readService)}
  $root=Invoke-R05ProtectedApi $readBudget Forward {$script:readCalls+=1;[R05TaskUpdateBinding]::Root($readService)}
  $path=Invoke-R05ProtectedApi $readBudget Forward {$script:readCalls+=1;$root.Path}
  Require ($path -ceq '\') 'READONLY_LOCAL_ROOT'
  $readPass=$true
 }catch{
  $readCode=(New-R05DiagnosticFault $_).hresult
 }finally{
  foreach($handle in @($root,$readService)){if($null -ne $handle -and [Runtime.InteropServices.Marshal]::IsComObject($handle)){try{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($handle)}catch{}}}
 }
 @{scenario=$Scenario;pass=$readPass;hresult=$readCode;realTaskServiceReadOnlyCalls=$script:readCalls;realTaskServiceCredentialCalls=0}|ConvertTo-Json -Compress
 if(-not $readPass){exit 1};exit 0
}
$clock=@{utc=[datetimeoffset]::Parse('2026-11-06T04:00:00Z');mono=[double]0}
$budget=New-R05ProofBudget -ScopeExpiry $clock.utc.AddHours(1) -JobDeadline $clock.utc.AddSeconds(660) -UtcClock {$clock.utc}.GetNewClosure() -MonoClock {$clock.mono}.GetNewClosure()
$budget.Diagnostics=New-R05Diagnostics
$nonce='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$owned=@{nonce=$nonce;taskName='Goriq-R05-CredentialRetention-'+$nonce;sid='S-1-5-21-111-222-333-444'}
$baseAction=[pscustomobject]@{Execute='PUBLIC_BASE_EXE';Arguments='PUBLIC_BASE_ARGS';WorkingDirectory='PUBLIC_BASE_DIR'}
$changedAction=[pscustomobject]@{Execute='PUBLIC_CHANGED_EXE';Arguments='PUBLIC_CHANGED_ARGS';WorkingDirectory='PUBLIC_CHANGED_DIR'}
$script:state=@{calls=0;cim=0;lookups=0;stored=$baseAction;sid=$owned.sid;logon=1;level=0;count=1;security='PUBLIC_FIXED_SECURITY';tamper=$false;missing=$false;race=$false;throw=$false;late=$false;args=$null;id='PUBLIC_ACTION_ID';context='PUBLIC_CONTEXT';registeredId=$null;registeredContext=$null;postEnvelope=$false;path=('\'+$owned.taskName)}
function New-FakeDefinition {
 $action=[pscustomobject]@{Path=$script:state.stored.Execute;Arguments=$script:state.stored.Arguments;WorkingDirectory=$script:state.stored.WorkingDirectory;Id=$script:state.id;Type=0}
 $actions=[pscustomobject]@{Count=$script:state.count;Context=$script:state.context;Items=@($action)}
 $actions|Add-Member ScriptMethod Item {param($index)return $this.Items[$index-1]}
 $definition=[pscustomobject]@{Principal=[pscustomobject]@{UserId=$script:state.sid;LogonType=$script:state.logon;RunLevel=$script:state.level};Actions=$actions}
 $definition|Add-Member ScriptProperty XmlText {
  $a=$this.Actions.Items[0];$setting=if($script:state.tamper -and $a.Path -ne $script:state.stored.Execute){'CHANGED_SETTING'}else{'ORIGINAL_SETTING'}
  '<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Principals><Principal><UserId>'+[Security.SecurityElement]::Escape($this.Principal.UserId)+'</UserId><LogonType>Password</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><Description>'+$setting+'</Description></Settings><Actions Context="'+[Security.SecurityElement]::Escape($this.Actions.Context)+'"><Exec id="'+[Security.SecurityElement]::Escape($a.Id)+'"><Command>'+[Security.SecurityElement]::Escape($a.Path)+'</Command><Arguments>'+[Security.SecurityElement]::Escape($a.Arguments)+'</Arguments><WorkingDirectory>'+[Security.SecurityElement]::Escape($a.WorkingDirectory)+'</WorkingDirectory></Exec></Actions></Task>'
 }
 return $definition
}
function New-FakeRegistered {
 $task=[pscustomobject]@{Path=$script:state.path}
 $task|Add-Member ScriptProperty Definition {New-FakeDefinition}
 $task|Add-Member ScriptMethod GetSecurityDescriptor {param($bits)if($bits -ne 7){throw 'WRONG_SECURITY_BITS'};return $script:state.security}
 return $task
}
Add-Type @'
using System;
public class R05FakeService {
 public object Folder;
 public void Connect() {}
 public object GetFolder(string path) {if(path!="\\")throw new Exception("WRONG_TASK_ROOT");return Folder;}
}
public delegate object R05FixtureRegisterCallback(object[] values);
public class R05FakeFolder {
 public Func<string,object> Lookup;
 public R05FixtureRegisterCallback Register;
 public object GetTask(string name) { return Lookup(name); }
 public object RegisterTaskDefinition(string name,object definition,int flags,object user,object password,int logon,object sddl) {return Register(new object[]{name,definition,flags,user,password,logon,sddl});}
}
'@
$folder=[R05FakeFolder]::new()
$folder.Lookup=[System.Func[System.String,System.Object]]{param($name)$script:state.lookups++;if($script:state.missing -or ($script:state.race -and $script:state.lookups -gt 1)){throw [Runtime.InteropServices.COMException]::new('PUBLIC_MISSING',-2147024894)};New-FakeRegistered}
$folder.Register=[R05FixtureRegisterCallback]{param($values)
 $script:state.calls++;$script:state.args=$values
 if($script:state.throw){throw [Runtime.InteropServices.COMException]::new('PRIVATE_THROW_CANARY',-2147024891)}
 if($script:state.late){$clock.utc=$clock.utc.AddSeconds(481);$clock.mono=481}
 $a=$values[1].Actions.Item(1);$script:state.registeredId=$a.Id;$script:state.registeredContext=$values[1].Actions.Context;if($script:state.postEnvelope){$script:state.context='CHANGED_CONTEXT'};$script:state.stored=[pscustomobject]@{Execute=$a.Path;Arguments=$a.Arguments;WorkingDirectory=$a.WorkingDirectory}
 New-FakeRegistered
}
$service=[R05FakeService]::new();$service.Folder=$folder
function New-R05TaskUpdateService {return $service}
function Set-ScheduledTask {param($TaskName,$TaskPath,$Action)$script:state.cim++;throw [ComponentModel.Win32Exception]::new(1326,'PUBLIC_OLD_CIM_REFUSAL')}
function Invoke-Candidate($Action,[string]$Operation='TASK_ACTION_UPDATE') {
 Set-R05OwnedTaskAction -Owned $owned -Action $Action -Budget $budget -Operation $Operation
}
if($Scenario -eq 'route'){
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
 $command=$ast.Find({param($n)$n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-R05ProtectedApi' -and $n.Extent.Text -match '-Operation TASK_ACTION_UPDATE$'},$true)
 $result=New-R05FixtureResult;$caught=$null
 try{Invoke-Expression $command.Extent.Text|Out-Null}catch{$caught=$_}
 Require ($script:state.calls -eq 1 -and $script:state.cim -eq 0 -and $null -eq $caught -and $result.updateOmittedUserAndPassword) 'REAL_MAIN_ROUTE_MUST_USE_FIXED_UPDATE_NOT_CIM'
}elseif($Scenario -eq 'variant'){
 Require ([bool](Get-Command Initialize-R05TaskUpdateBinding -ErrorAction SilentlyContinue)) 'BINDING_REQUIRED'
 Initialize-R05TaskUpdateBinding
 Add-Type @'
using System;using System.Runtime.InteropServices;
public static class R05VariantMemoryProbe {
 [DllImport("oleaut32.dll")] static extern int VariantClear(IntPtr value);
 public static int TypeOf(object value){IntPtr p=Marshal.AllocCoTaskMem(32);for(int i=0;i<32;i++)Marshal.WriteByte(p,i,0);try{Marshal.GetNativeVariantForObject(value,p);return Marshal.ReadInt16(p);}finally{VariantClear(p);Marshal.FreeCoTaskMem(p);}}
}
'@
 $arguments=[R05TaskUpdateBinding]::Arguments($owned.taskName,(New-FakeDefinition))
 Require ($arguments.Count -eq 7 -and [R05VariantMemoryProbe]::TypeOf($arguments[3]) -eq 0 -and [R05VariantMemoryProbe]::TypeOf($arguments[4]) -eq 0 -and [R05VariantMemoryProbe]::TypeOf($arguments[6]) -eq 0) 'NATIVE_EMPTY_CREDENTIAL_AND_NO_SDDL'
 Require ([R05VariantMemoryProbe]::TypeOf([DBNull]::Value) -eq 1 -and [R05VariantMemoryProbe]::TypeOf([Type]::Missing) -eq 10 -and [R05VariantMemoryProbe]::TypeOf('') -eq 8) 'NULL_MISSING_BSTR_ARE_DISTINCT'
}else{
 Require ([bool](Get-Command Set-R05OwnedTaskAction -ErrorAction SilentlyContinue)) 'FIXED_HELPER_REQUIRED'
 if($Scenario -eq 'wrong-principal'){$script:state.sid='S-1-5-21-111-222-333-555'}
 if($Scenario -eq 'wrong-root'){$script:state.path='\OTHER\'+$owned.taskName}
 if($Scenario -eq 'wrong-logon'){$script:state.logon=2}
 if($Scenario -eq 'wrong-level'){$script:state.level=1}
 if($Scenario -eq 'post-envelope'){$script:state.postEnvelope=$true}
 if($Scenario -eq 'wrong-action'){$script:state.count=2}
 if($Scenario -eq 'missing-race'){$script:state.race=$true}
 if($Scenario -eq 'nonaction-tamper'){$script:state.tamper=$true}
 if($Scenario -eq 'pre-deadline'){$clock.utc=$clock.utc.AddSeconds(480);$clock.mono=480}
 if($Scenario -eq 'late-return'){$script:state.late=$true}
 if($Scenario -eq 'com-throw'){$script:state.throw=$true}
 $caught=$null;try{Invoke-Candidate $changedAction}catch{$caught=$_}
 if($Scenario -eq 'symmetry'){
  Require ($null -eq $caught -and $script:state.calls -eq 1) 'UPDATE_SUCCEEDS_INERTLY'
  $v=$script:state.args;Require ($v.Count -eq 7 -and $v[0] -ceq $owned.taskName -and $v[2] -eq 52 -and $null -eq $v[3] -and $null -eq $v[4] -and $v[5] -eq 0 -and $null -eq $v[6]) 'EXACT_UPDATE_ONLY_NO_CREDENTIAL_ARGS'
  Require ($script:state.stored.Execute -ceq $changedAction.Execute -and $script:state.stored.Arguments -ceq $changedAction.Arguments -and $script:state.stored.WorkingDirectory -ceq $changedAction.WorkingDirectory) 'ONLY_THREE_FIELDS_UPDATED'
  Require ($script:state.registeredId -ceq 'PUBLIC_ACTION_ID' -and $script:state.registeredContext -ceq 'PUBLIC_CONTEXT') 'NONEMPTY_ACTION_ENVELOPE_PRESERVED'
  Invoke-Candidate $baseAction TASK_ACTION_RESTORE
  Require ($script:state.calls -eq 2 -and $script:state.stored.Execute -ceq $baseAction.Execute -and $script:state.args[2] -eq 52 -and $script:state.args[5] -eq 0) 'SAME_FIXED_REVERSE_ROUTE'
 }elseif($Scenario -in @('late-return','com-throw','post-envelope')){
  Require ($null -ne $caught -and $script:state.calls -eq 1) 'ONE_EFFECT_THEN_STOP'
  if($Scenario -eq 'late-return'){Require ($budget.ForwardExpired -and (Get-R05FailureCode $caught) -eq 'PROOF_FORWARD_DEADLINE') 'LATE_RETURN_NO_NEXT_API'}
  elseif($Scenario -eq 'com-throw'){Require ($budget.Diagnostics.forwardFailure.exceptionKind -eq 'COM' -and $budget.Diagnostics.forwardFailure.callState -eq 'THREW') 'ORIGINAL_COM_CAUSE_UNCERTAIN_EFFECT'}
 }else{Require ($null -ne $caught -and $script:state.calls -eq 0) 'UNSAFE_OR_MISSING_CONTEXT_REFUSED_NO_REGISTER'}
}
@{scenario=$Scenario;pass=$true;realTaskServiceCredentialCalls=0}|ConvertTo-Json -Compress
