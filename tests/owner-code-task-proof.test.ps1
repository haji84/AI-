param([ValidateSet('callback','callback-expiry','right-failure','profile-failure','cleanup-success','wrong-sid','cleanup-expiry')][string]$Scenario)
$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-task-credential-retention-proof-1218.ps1'
. $source
# This type deliberately implements no P/Invoke, account or task API. It exercises
# the same synchronous C# Action boundary as the actual native implementation.
if($Scenario -like 'callback*'){
 # Compile the real interop definition without invoking any operating-system API.
 # A separate inert shim keeps the callback regression runnable on the old source.
 Initialize-R05Native
 Add-Type 'public static class R05InertCallbackProbe { public static void Check(System.Action check) { check(); } }'
}else{Add-Type @'
using System;
public static class R05FixtureNative {
 public static bool FailRight;
 public static int Calls;
 public static void Check(Action check) { check(); }
 public static bool BatchRight(string sid,int operation,Action check) {
  check(); Calls++; if(FailRight)throw new Exception("INERT_RIGHT_FAILURE"); check(); return false;
 }
}
'@
}
function Require([bool]$Condition,[string]$Name){if(-not $Condition){throw ('INERT_PROOF_REGRESSION_'+$Name)}}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
Require ($errors.Count -eq 0) 'SOURCE_PARSE'
function Assignment([string]$Name){
 $n=$ast.Find({param($node)$node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq ('$'+$Name)},$true)
 Require ($null -ne $n) ('ASSIGNMENT_'+$Name)
 return $n.Extent.Text
}
$nativeAssignment=Assignment 'nativeCheck';$cleanupAssignment=Assignment 'cleanup'
function Invoke-Fixture {
 # Function-local variables and two nested closures are intentional: a global
 # dot-source-only test hid the null budget seen by the real -File entry point.
 $clock=@{utc=[datetimeoffset]::Parse('2026-11-05T00:00:00Z');mono=[double]0}
 $budget=New-R05ProofBudget -ScopeExpiry $clock.utc.AddHours(1) -JobDeadline $clock.utc.AddSeconds(660) -UtcClock {$clock.utc}.GetNewClosure() -MonoClock {$clock.mono}.GetNewClosure()
 if($Scenario -like 'callback*'){
  $outer={
   Invoke-Expression $nativeAssignment
   [R05InertCallbackProbe]::Check($nativeCheck)
   if($Scenario -eq 'callback-expiry'){
    $clock.utc=$clock.utc.AddSeconds(480);$clock.mono=480
    $refused=$false
    try{[R05InertCallbackProbe]::Check($nativeCheck)}catch{
     Require ((Get-R05FailureCode $_) -eq 'PROOF_FORWARD_DEADLINE') 'CLOSED_CALLBACK_DEADLINE_CODE'
     $errorRecord=$_
     while($errorRecord.Exception.InnerException){$errorRecord=[Management.Automation.ErrorRecord]::new($errorRecord.Exception.InnerException,'INERT',[Management.Automation.ErrorCategory]::NotSpecified,$null)}
     $refused=$errorRecord.Exception.Message -eq 'PROOF_FORWARD_DEADLINE'
    }
    Require $refused 'CALLBACK_RECHECKS_LIVE_DEADLINE'
   }
  }.GetNewClosure()
  & $outer
  return
 }
 $sid='S-1-5-21-111-222-333-444'
 $owned=@{stage='fixture';registered=$false;sid=$sid;userName='PUBLIC-FIXTURE-NOT-AN-ACCOUNT';rootCreated=$false;rootAttempted=$false}
 $result=New-R05FixtureResult;$result.accountCreated=$true
 $script:fixture=@{user=[pscustomobject]@{SID=[pscustomobject]@{Value=$sid}};disabled=0;removed=0;profilesRead=0;profilesRemoved=0}
 if($Scenario -eq 'wrong-sid'){$script:fixture.user.SID.Value='S-1-5-21-111-222-333-555'}
 [R05FixtureNative]::FailRight=$Scenario -eq 'right-failure'
 Invoke-Expression $cleanupAssignment
 $forward={throw 'PROOF_BATCH_LOGON_REFUSED'}
 if($Scenario -eq 'cleanup-expiry'){$clock.utc=$clock.utc.AddSeconds(601);$clock.mono=601}
 $outcome=Invoke-R05BudgetedRun $budget $forward $cleanup
 if($Scenario -eq 'wrong-sid' -or $Scenario -eq 'cleanup-expiry'){
  Require ($script:fixture.disabled -eq 0 -and $script:fixture.removed -eq 0 -and $script:fixture.profilesRemoved -eq 0 -and [R05FixtureNative]::Calls -eq 0) 'NO_UNBOUND_OR_LATE_EFFECTS'
  Require (-not $result.cleanupVerified) 'NO_UNBOUND_OR_LATE_PASS'
 }elseif($Scenario -eq 'cleanup-success'){
  Require ($script:fixture.removed -eq 1 -and $result.accountRemoved -and $result.cleanupVerified -and $outcome.cleanupCompleted) 'VALID_CLEANUP'
  Require ($outcome.failureCode -eq 'PROOF_BATCH_LOGON_REFUSED' -and -not $outcome.forwardCompleted) 'FORWARD_FAILURE_RETAINED'
 }else{
  Require ($script:fixture.disabled -eq 1 -and $script:fixture.removed -eq 1 -and $result.accountRemoved) 'ACCOUNT_CLEANUP_INDEPENDENT'
  Require (-not $outcome.cleanupCompleted -and -not $result.cleanupVerified -and $outcome.failureCode -eq 'PROOF_BATCH_LOGON_REFUSED' -and $outcome.cleanupFailureCode -eq 'PROOF_CLEANUP_FAILED') 'FAILED_COMPONENT_NOT_PASS'
  if($Scenario -eq 'right-failure'){
   Require ([R05FixtureNative]::Calls -eq 1) 'RIGHT_FAILURE_AFTER_VALID_CALLBACK'
   Require ($script:fixture.profilesRead -gt 0 -and $result.ownProfileRemovedOrAbsent -and -not $result.ownBatchRightRemovedOrAbsent) 'PROFILE_CLEANUP_INDEPENDENT'
  }else{
   Require ([R05FixtureNative]::Calls -eq 2) 'RIGHT_REMOVE_AND_VERIFY_AFTER_VALID_CALLBACK'
   Require ($result.ownBatchRightRemovedOrAbsent -and -not $result.ownProfileRemovedOrAbsent -and $script:fixture.profilesRemoved -eq 0) 'LOADED_PROFILE_REFUSED'
  }
 }
}
# These functions replace OS interfaces only; the actual source cleanup body,
# transaction, closure construction and deadline guards above remain unchanged.
function Get-LocalUser {param($Name,$ErrorAction)return $script:fixture.user}
function Disable-LocalUser {param($InputObject)$script:fixture.disabled++}
function Remove-LocalUser {param($InputObject)$script:fixture.removed++;$script:fixture.user=$null}
function Get-CimInstance {
 param($ClassName,$Filter)
 $script:fixture.profilesRead++
 if($Scenario -eq 'profile-failure'){return [pscustomobject]@{SID='S-1-5-21-111-222-333-444';Special=$false;Loaded=$true}}
}
function Remove-CimInstance {param($InputObject)$script:fixture.profilesRemoved++}
Invoke-Fixture
@{schemaVersion=1;scenario=$Scenario;pass=$true;realWindowsApiCalls=0}|ConvertTo-Json -Compress
