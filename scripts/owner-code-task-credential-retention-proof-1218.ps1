[CmdletBinding()]
param([switch]$Apply,[switch]$ValidateOnly,[string]$ApprovalPath)
# REVIEW ARTIFACT ONLY. Separate explicit Human Gate required before any Apply.
# Not installed in the repository. No default side effects or credential reads.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-R05Digest([byte[]]$Bytes) {
 $h=[Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally {$h.Dispose()}
}
function Assert-R05FixtureApproval($Scope,[datetimeoffset]$Now,[string]$ScriptSha256,$Context) {
 $flags=@('explicitOwnerApproval','createEphemeralAccountApproval','temporaryPasswordPersistenceApproval','temporaryTaskRegistrationApproval','conditionalBatchLogonRightApproval','ownObjectCleanupApproval')
 $keys=@('schemaVersion','scopeId','goalId','sourceRevision','scriptSha256','issuedAt','expiresAt','attemptId','runBinding','maxAttempts','maxAccounts','maxTasks','maxJobs','maxDurationSeconds','cleanupReserveSeconds','maxTotalSeconds')+$flags
 if($null -eq $Scope -or $Scope -isnot [pscustomobject] -or @($Scope.PSObject.Properties).Count -ne $keys.Count){throw 'PROOF_APPROVAL_REQUIRED'}
 foreach($key in $keys){if($Scope.PSObject.Properties.Name -cnotcontains $key){throw 'PROOF_APPROVAL_REQUIRED'}}
 foreach($key in $flags){if($Scope.$key -isnot [bool] -or $Scope.$key -ne $true){throw 'PROOF_APPROVAL_REQUIRED'}}
 foreach($key in @('schemaVersion','maxAttempts','maxAccounts','maxTasks','maxJobs','maxDurationSeconds','cleanupReserveSeconds','maxTotalSeconds')){
  if($Scope.$key -isnot [int] -and $Scope.$key -isnot [long]){throw 'PROOF_APPROVAL_REQUIRED'}
 }
 foreach($key in @('scopeId','goalId','sourceRevision','scriptSha256','issuedAt','expiresAt','attemptId','runBinding')){
  if($Scope.$key -isnot [string]){throw 'PROOF_APPROVAL_REQUIRED'}
 }
 if($Scope.schemaVersion -ne 2 -or $Scope.scopeId -cne 'issue:1218:ephemeral-password-task-retention-proof' -or
  $Scope.goalId -cne 'goal-fcc81c97e09153f7' -or $Scope.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or
  $Scope.sourceRevision -cne $Context.sha -or $Scope.scriptSha256 -cne $ScriptSha256 -or
  $Scope.attemptId -cnotmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or
  $Scope.runBinding -cne 'one-current-dispatch-attempt-1' -or $Scope.maxAttempts -ne 1 -or
  $Scope.maxAccounts -ne 1 -or $Scope.maxTasks -ne 1 -or $Scope.maxJobs -ne 1 -or
  $Scope.maxDurationSeconds -ne 480 -or $Scope.cleanupReserveSeconds -ne 120 -or $Scope.maxTotalSeconds -ne 600){throw 'PROOF_APPROVAL_REQUIRED'}
 if($Context.actor -cne 'haji84' -or $Context.repo -cne 'haji84/AI-' -or $Context.ref -cne 'refs/heads/main' -or
  $Context.runId -cnotmatch '^[1-9]\d*$' -or $Context.attempt -cne '1' -or $Context.job -cne 'proof'){throw 'PROOF_CONTEXT_REQUIRED'}
 try{$issued=[datetimeoffset]::Parse($Scope.issuedAt);$expires=[datetimeoffset]::Parse($Scope.expiresAt)}catch{throw 'PROOF_APPROVAL_REQUIRED'}
 if($issued -gt $Now -or $expires -le $Now -or ($expires-$issued).TotalSeconds -gt 7200 -or
  ($expires-$Now).TotalSeconds -lt 600){throw 'PROOF_APPROVAL_REQUIRED'}
 # These shape checks do not prove human consent or prevent cross-run replay.
 # Dispatcher independently seals one original approval and exactly one POST.
 return $Scope
}
function New-R05Diagnostics {
 return [ordered]@{version=1;forwardFailure=$null;cleanupFailure=$null;cleanupFailedComponents=@();profileCleanupState='NOT_CHECKED'}
}
function Set-R05ProfileDiagnosticState($Diagnostics,[string]$State) {
 try{
  if($null -ne $Diagnostics -and $State -cin @('NOT_CHECKED','QUERY_FAILED','SID_MISMATCH_REFUSED','SPECIAL_REFUSED','LOADED_REFUSED','REMOVE_FAILED','READBACK_FAILED','STILL_PRESENT','ABSENT_CONFIRMED','REMOVED_AND_ABSENT_CONFIRMED')){$Diagnostics.profileCleanupState=$State}
 }catch{}
}
function Convert-R05UInt32Scalar {
 param($Value,[switch]$SignedInt32)
 if($null -eq $Value -or $Value -is [bool] -or $Value -is [Enum]){return $null}
 if($SignedInt32 -and $Value -is [int] -and $Value -lt 0){return [BitConverter]::ToUInt32([BitConverter]::GetBytes($Value),0)}
 if($Value -isnot [byte] -and $Value -isnot [sbyte] -and $Value -isnot [int16] -and $Value -isnot [uint16] -and $Value -isnot [int] -and $Value -isnot [uint32] -and $Value -isnot [long] -and $Value -isnot [uint64]){return $null}
 if($Value -lt 0 -or $Value -gt [uint32]::MaxValue){return $null}
 return [uint32]$Value
}
function New-R05DiagnosticFault {
 param($ErrorRecord,[string]$Component='NONE',[string]$Operation='OTHER',[string]$Origin='UNKNOWN',[string]$CallState='UNKNOWN')
 $fault=[ordered]@{component='NONE';operation='OTHER';origin='UNKNOWN';callState='UNKNOWN';exceptionKind='NONE';hresult=$null;win32NativeCode=$null;cimNativeCode=$null;cimStatusCode=$null;cimProviderErrorCode=$null}
 try{
  if($Component -cin @('FORWARD','TASK','ACCOUNT_DISABLE','BATCH_RIGHT','PROFILE','ACCOUNT_REMOVE','FILES','NONE')){$fault.component=$Component}
  if($Operation -cin @('TASK_ACTION_UPDATE','TASK_ACTION_RESTORE','PROFILE_QUERY','PROFILE_REMOVE','PROFILE_READBACK','OTHER')){$fault.operation=$Operation}
  if($Origin -cin @('PRE_GUARD','CALL_THROW','POST_GUARD','SOURCE_REFUSAL','UNKNOWN')){$fault.origin=$Origin}
  if($CallState -cin @('NOT_ENTERED','THREW','RETURNED','NOT_APPLICABLE','UNKNOWN')){$fault.callState=$CallState}
  $exception=$null
  if($ErrorRecord -is [Management.Automation.ErrorRecord]){$exception=$ErrorRecord.Exception}
  elseif($ErrorRecord -is [Exception]){$exception=$ErrorRecord}
  elseif($null -ne $ErrorRecord){$fault.exceptionKind='UNKNOWN'}
  $selected=$exception;$cimType='Microsoft.Management.Infrastructure.CimException' -as [type]
  if($exception){$fault.exceptionKind=if($exception -is [Management.Automation.RuntimeException]){'POWERSHELL'}else{'DOTNET'}}
  for($depth=0;$null -ne $exception -and $depth -lt 8;$depth++){
   if($null -ne $cimType -and $exception -is $cimType){$selected=$exception;$fault.exceptionKind='CIM';break}
   if($exception -is [ComponentModel.Win32Exception]){$selected=$exception;$fault.exceptionKind='WIN32';break}
   if($exception -is [Runtime.InteropServices.COMException]){$selected=$exception;$fault.exceptionKind='COM';break}
   $exception=$exception.InnerException
  }
  if($selected){try{$value=$selected.HResult;if($value -is [int]){$fault.hresult=$value}}catch{}}
  if($fault.exceptionKind -eq 'WIN32'){try{$fault.win32NativeCode=Convert-R05UInt32Scalar $selected.NativeErrorCode -SignedInt32}catch{}}
  if($fault.exceptionKind -eq 'CIM'){
   try{
    $value=$selected.NativeErrorCode;$nativeType='Microsoft.Management.Infrastructure.NativeErrorCode' -as [type]
    if($null -ne $nativeType -and $null -ne $value -and $value.GetType() -eq $nativeType){$fault.cimNativeCode=[Convert]::ToUInt32($value)}
   }catch{}
   try{$fault.cimStatusCode=Convert-R05UInt32Scalar $selected.StatusCode}catch{}
   try{
    $data=$selected.ErrorData;$instanceType='Microsoft.Management.Infrastructure.CimInstance' -as [type]
    if($null -ne $instanceType -and $data -is $instanceType){
     $property=$data.CimInstanceProperties['Error_Code']
     if($null -ne $property){$fault.cimProviderErrorCode=Convert-R05UInt32Scalar $property.Value -SignedInt32}
    }
   }catch{}
  }
 }catch{} # Diagnostics may neither replace the original error nor emit private surfaces.
 return $fault
}
function Save-R05DiagnosticFault {
 param($Budget,[string]$Phase,$ErrorRecord,[string]$Component='NONE',[string]$Operation='OTHER',[string]$Origin='UNKNOWN',[string]$CallState='UNKNOWN')
 try{
  if($null -eq $Budget -or $null -eq $Budget.Diagnostics){return}
  $diagnostics=$Budget.Diagnostics
  if($Phase -eq 'Cleanup' -and $Component -cin @('TASK','ACCOUNT_DISABLE','BATCH_RIGHT','PROFILE','ACCOUNT_REMOVE','FILES') -and $diagnostics.cleanupFailedComponents -cnotcontains $Component){$diagnostics.cleanupFailedComponents+=@($Component)}
  $field=if($Phase -eq 'Cleanup'){'cleanupFailure'}else{'forwardFailure'}
  if($null -eq $diagnostics[$field]){$diagnostics[$field]=New-R05DiagnosticFault $ErrorRecord $Component $Operation $Origin $CallState}
 }catch{}
}
function New-R05FixtureResult {
 return [ordered]@{schemaVersion=3;issue=1218;operation='ephemeral-password-task-retention-proof';complete=$false;
  mode='PLAN_ONLY';failureCode=$null;failedStage=$null;cleanupFailureCode=$null;sourceRevision=$null;scriptSha256=$null;approvalSha256=$null;
  runId=$null;runAttempt=1;attemptId=$null;validationAccepted=$false;accountCreated=$false;taskCreated=$false;
  conditionalBatchRightAdded=$false;baselineRan=$false;changedRan=$false;restoredRan=$false;
  actualAccountSidMatched=$false;passwordLogonPreserved=$false;limitedPrincipalPreserved=$false;
  nonActionDefinitionPreserved=$false;taskSecurityPreserved=$false;actionRestored=$false;
  updateOmittedUserAndPassword=$false;restoreOmittedUserAndPassword=$false;allThreeActionFieldsChanged=$false;windowsBuild=$null;
  taskRemoved=$false;accountRemoved=$false;ownProfileRemovedOrAbsent=$false;ownBatchRightRemovedOrAbsent=$false;
  ownFilesRemoved=$false;cleanupVerified=$false;existingTaskTouched=$false;productionTouched=$false;
  deadlineBudgetAdmitted=$false;forwardCompleted=$false;finalDeadlineValid=$false;forwardDeadlineExceeded=$false;cleanupDeadlineExceeded=$false;hardDeadlineExceeded=$false;
  credentialValueEmitted=$false;rawIdentityOrPathEmitted=$false;nativeZBookAcceptanceCredit=0;diagnostics=(New-R05Diagnostics)}
}

class R05ProofBudget {
 [datetimeoffset]$AdmitUtc
 [datetimeoffset]$ScopeExpiry
 [datetimeoffset]$JobDeadline
 [datetimeoffset]$ForwardUtc
 [datetimeoffset]$HardUtc
 [datetimeoffset]$CleanupUtc
 [double]$AdmitMono
 [double]$ForwardMono
 [double]$HardMono
 [double]$CleanupMono
 [scriptblock]$UtcClock
 [scriptblock]$MonoClock
 [bool]$CleanupStarted
 [bool]$ForwardExpired
 [bool]$CleanupExpired
 [bool]$HardExpired
 [Collections.IDictionary]$Diagnostics
 [string]$DiagnosticComponent='NONE'
}
function New-R05ProofBudget {
 param([datetimeoffset]$ScopeExpiry,[datetimeoffset]$JobDeadline,
  [scriptblock]$UtcClock={[datetimeoffset]::UtcNow},
  [scriptblock]$MonoClock={[double][Diagnostics.Stopwatch]::GetTimestamp()/[Diagnostics.Stopwatch]::Frequency})
 $utc=[datetimeoffset](& $UtcClock);$mono=[double](& $MonoClock)
 if([double]::IsNaN($mono) -or [double]::IsInfinity($mono)){throw 'PROOF_CLOCK_INVALID'}
 # Grant v2 expressly admits480s forward PLUS120s cleanup, never a rewritten expiry.
 if(($ScopeExpiry-$utc).TotalSeconds -lt 600 -or ($JobDeadline-$utc).TotalSeconds -lt 600){throw 'PROOF_JOB_BUDGET_REQUIRED'}
 $b=[R05ProofBudget]::new();$b.AdmitUtc=$utc;$b.AdmitMono=$mono;$b.ScopeExpiry=$ScopeExpiry;$b.JobDeadline=$JobDeadline
 $b.ForwardUtc=$utc.AddSeconds(480);$b.HardUtc=$utc.AddSeconds(600);$b.ForwardMono=$mono+480;$b.HardMono=$mono+600
 $b.UtcClock=$UtcClock;$b.MonoClock=$MonoClock
 return $b
}
function Get-R05BudgetTime([R05ProofBudget]$Budget) {
 $utc=[datetimeoffset](& ($Budget.UtcClock));$mono=[double](& ($Budget.MonoClock))
 if([double]::IsNaN($mono) -or [double]::IsInfinity($mono) -or $mono -lt $Budget.AdmitMono -or $utc -lt $Budget.AdmitUtc){$Budget.HardExpired=$true;throw 'PROOF_CLOCK_INVALID'}
 return @{utc=$utc;mono=$mono}
}
function Assert-R05ProofBudget {
 param([R05ProofBudget]$Budget,[ValidateSet('Forward','Cleanup','Final')][string]$Phase,[double]$MinimumRemainingSeconds=0)
 if($null -eq $Budget){throw 'PROOF_JOB_BUDGET_REQUIRED'}
 $now=Get-R05BudgetTime $Budget
 if($Budget.HardExpired -or $now.utc -ge $Budget.ScopeExpiry -or $now.utc -ge $Budget.JobDeadline -or $now.utc -ge $Budget.HardUtc -or $now.mono -ge $Budget.HardMono){
  $Budget.HardExpired=$true;throw 'PROOF_HARD_DEADLINE'
 }
 if($Phase -eq 'Forward'){
  if($Budget.ForwardExpired -or $now.utc -ge $Budget.ForwardUtc -or $now.mono -ge $Budget.ForwardMono){$Budget.ForwardExpired=$true;throw 'PROOF_FORWARD_DEADLINE'}
  if(($Budget.ForwardUtc-$now.utc).TotalSeconds -lt $MinimumRemainingSeconds -or ($Budget.ForwardMono-$now.mono) -lt $MinimumRemainingSeconds){throw 'PROOF_FORWARD_RESERVE'}
 }else{
  if(-not $Budget.CleanupStarted){throw 'PROOF_CLEANUP_NOT_STARTED'}
  if($Budget.CleanupExpired -or $now.utc -ge $Budget.CleanupUtc -or $now.mono -ge $Budget.CleanupMono){$Budget.CleanupExpired=$true;throw 'PROOF_CLEANUP_DEADLINE'}
  if($Phase -eq 'Final' -and $Budget.ForwardExpired){throw 'PROOF_FORWARD_DEADLINE'}
 }
}
function Start-R05ProofCleanup([R05ProofBudget]$Budget) {
 if($Budget.CleanupStarted){Assert-R05ProofBudget $Budget Cleanup;return}
 # Check hard authority before changing phase; hard expiry permits no new cleanup API.
 $now=Get-R05BudgetTime $Budget
 if($Budget.HardExpired -or $now.utc -ge $Budget.ScopeExpiry -or $now.utc -ge $Budget.JobDeadline -or $now.utc -ge $Budget.HardUtc -or $now.mono -ge $Budget.HardMono){$Budget.HardExpired=$true;throw 'PROOF_HARD_DEADLINE'}
 $Budget.CleanupStarted=$true
 $Budget.CleanupUtc=$now.utc.AddSeconds(120);if($Budget.CleanupUtc -gt $Budget.HardUtc){$Budget.CleanupUtc=$Budget.HardUtc}
 if($Budget.CleanupUtc -gt $Budget.ScopeExpiry){$Budget.CleanupUtc=$Budget.ScopeExpiry}
 if($Budget.CleanupUtc -gt $Budget.JobDeadline){$Budget.CleanupUtc=$Budget.JobDeadline}
 $Budget.CleanupMono=[Math]::Min($now.mono+120,$Budget.HardMono)
 Assert-R05ProofBudget $Budget Cleanup
}
function Invoke-R05ProtectedApi {
 param([R05ProofBudget]$Budget,[ValidateSet('Forward','Cleanup')][string]$Phase,[scriptblock]$Action,[string]$Operation='OTHER',[string]$Component='NONE')
 $componentSnapshot=if($Component -cne 'NONE'){$Component}elseif($Phase -eq 'Forward'){'FORWARD'}elseif($null -ne $Budget){$Budget.DiagnosticComponent}else{'NONE'}
 $operationSnapshot=$Operation
 try{Assert-R05ProofBudget $Budget $Phase}catch{Save-R05DiagnosticFault $Budget $Phase $_ $componentSnapshot $operationSnapshot 'PRE_GUARD' 'NOT_ENTERED';throw}
 $failure=$null;$value=$null
 try{$value=& $Action}catch{$failure=$_;Save-R05DiagnosticFault $Budget $Phase $_ $componentSnapshot $operationSnapshot 'CALL_THROW' 'THREW'}
 # Action records returned owned handles/identities BEFORE this post-call guard.
 # A blocking OS API cannot be interrupted here; a late return cannot authorize another forward API or PASS.
 try{Assert-R05ProofBudget $Budget $Phase}catch{
  if($failure){Save-R05DiagnosticFault $Budget $Phase $failure $componentSnapshot $operationSnapshot 'CALL_THROW' 'THREW'}
  else{Save-R05DiagnosticFault $Budget $Phase $_ $componentSnapshot $operationSnapshot 'POST_GUARD' 'RETURNED'}
  throw
 }
 if($failure){throw $failure}
 return $value
}
function New-R05NativeBudgetCheck {
 param([R05ProofBudget]$Budget,[ValidateSet('Forward','Cleanup')][string]$Phase)
 # GetNewClosure captures this function's local parameters. A closure created
 # inside the forward/cleanup closure cannot capture its inherited $budget.
 if($null -eq $Budget){throw 'PROOF_JOB_BUDGET_REQUIRED'}
 return [Action]({Assert-R05ProofBudget $Budget $Phase}.GetNewClosure())
}
function Get-R05FailureCode($ErrorRecord) {
 $allowed=@('PROOF_MODE_REQUIRED','PROOF_APPROVAL_REQUIRED','PROOF_CONTEXT_REQUIRED','PROOF_HOSTED_WINDOWS_REQUIRED','PROOF_HOSTED_ADMIN_REQUIRED','PROOF_OWN_OBJECT_COLLISION','PROOF_ACCOUNT_BOUNDARY_CHANGED','PROOF_BATCH_LOGON_REFUSED','PROOF_TASK_BOUNDARY_CHANGED','PROOF_EXECUTION_FAILED','PROOF_ACCOUNT_EXECUTION_MISMATCH','PROOF_JOB_BUDGET_REQUIRED','PROOF_CLOCK_INVALID','PROOF_HARD_DEADLINE','PROOF_FORWARD_DEADLINE','PROOF_FORWARD_RESERVE','PROOF_CLEANUP_DEADLINE','PROOF_CLEANUP_NOT_STARTED','PROOF_CLEANUP_FAILED')
 # PowerShell wraps exceptions thrown through a C# Action. Preserve only closed
 # allowlisted codes from that chain; never emit an exception or native detail.
 $exception=$ErrorRecord.Exception
 while($exception){
  $code=[string]$exception.Message
  if($code -in $allowed){return $code}
  $exception=$exception.InnerException
 }
 return 'PROOF_OPERATION_FAILED'
}
function Invoke-R05BudgetedRun {
 param([R05ProofBudget]$Budget,[scriptblock]$Forward,[scriptblock]$Cleanup,[scriptblock]$GetStage={'protected-api'})
 $out=[ordered]@{forwardCompleted=$false;cleanupCompleted=$false;finalDeadlineValid=$false;failureCode=$null;cleanupFailureCode=$null;failedStage=$null}
 $forwardEntered=$false;$forwardReturned=$false;$cleanupEntered=$false;$cleanupReturned=$false
 try{
  Assert-R05ProofBudget $Budget Forward
  $forwardEntered=$true
  & $Forward | Out-Null
  $forwardReturned=$true
  Assert-R05ProofBudget $Budget Forward
  $out.forwardCompleted=$true
 }catch{
  $origin=if(-not $forwardEntered){'PRE_GUARD'}elseif($forwardReturned){'POST_GUARD'}else{'SOURCE_REFUSAL'}
  $callState=if(-not $forwardEntered){'NOT_ENTERED'}elseif($forwardReturned){'RETURNED'}else{'NOT_APPLICABLE'}
  Save-R05DiagnosticFault $Budget Forward $_ FORWARD OTHER $origin $callState
  $out.failureCode=Get-R05FailureCode $_;$out.failedStage=& $GetStage
 }
 finally{
  try{Start-R05ProofCleanup $Budget;$cleanupEntered=$true;& $Cleanup | Out-Null;$cleanupReturned=$true;Assert-R05ProofBudget $Budget Cleanup;$out.cleanupCompleted=$true}
  catch{
   $origin=if(-not $cleanupEntered){'PRE_GUARD'}elseif($cleanupReturned){'POST_GUARD'}else{'SOURCE_REFUSAL'}
   $callState=if(-not $cleanupEntered){'NOT_ENTERED'}elseif($cleanupReturned){'RETURNED'}else{'NOT_APPLICABLE'}
   Save-R05DiagnosticFault $Budget Cleanup $_ NONE OTHER $origin $callState
   $out.cleanupFailureCode=Get-R05FailureCode $_;if(-not $out.failureCode){$out.failureCode=$out.cleanupFailureCode;$out.failedStage='cleanup'}
  }
 }
 try{Assert-R05ProofBudget $Budget Final;$out.finalDeadlineValid=$true}catch{if(-not $out.failureCode){$out.failureCode=Get-R05FailureCode $_;$out.failedStage='final-deadline'}}
 return $out
}
function Initialize-R05Native {
 if('R05FixtureNative' -as [type]){return}
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class R05FixtureNative {
 [StructLayout(LayoutKind.Sequential)] struct U {public ushort L,M;public IntPtr B;}
 [StructLayout(LayoutKind.Sequential)] struct O {public int L;public IntPtr R,N;public uint A;public IntPtr S,Q;}
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool LogonUser(string u,string d,string p,int t,int v,out IntPtr h);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr n,ref O o,uint a,out IntPtr h);
 [DllImport("advapi32.dll")] static extern uint LsaEnumerateAccountRights(IntPtr h,IntPtr s,out IntPtr r,out uint c);
 [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr h,IntPtr s,U[] r,uint c);
 [DllImport("advapi32.dll")] static extern uint LsaRemoveAccountRights(IntPtr h,IntPtr s,bool all,U[] r,uint c);
 [DllImport("advapi32.dll")] static extern uint LsaFreeMemory(IntPtr h);
 [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr h);
 public static void Check(Action check) {check();}
 public static int BatchLogon(string u,string p,Action check) {IntPtr h=IntPtr.Zero;try{check();bool ok=LogonUser(u,".",p,4,0,out h);int result=ok?0:Marshal.GetLastWin32Error();check();return result;}finally{if(h!=IntPtr.Zero)CloseHandle(h);}}
 public static bool BatchRight(string sid,int operation,Action check) {
  IntPtr h=IntPtr.Zero,s=IntPtr.Zero,r=IntPtr.Zero,b=IntPtr.Zero;
  try {
   O o=new O();o.L=Marshal.SizeOf(typeof(O));
   check();uint opened=LsaOpenPolicy(IntPtr.Zero,ref o,0x810,out h);check();if(opened!=0)throw new Exception("POLICY_ACCESS_REFUSED");
   byte[] bytes=new byte[new SecurityIdentifier(sid).BinaryLength];new SecurityIdentifier(sid).GetBinaryForm(bytes,0);
   s=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,s,bytes.Length);
   uint count;check();uint st=LsaEnumerateAccountRights(h,s,out r,out count);check();bool exists=false;
   if(st!=0 && st!=0xC0000034)throw new Exception("POLICY_READ_REFUSED");
   if(st==0)for(int i=0;i<count;i++){U x=(U)Marshal.PtrToStructure(IntPtr.Add(r,i*Marshal.SizeOf(typeof(U))),typeof(U));if(Marshal.PtrToStringUni(x.B,x.L/2)=="SeBatchLogonRight")exists=true;}
   if(operation==0)return exists;
   if((operation==1&&exists)||(operation==2&&!exists))return exists;
   string text="SeBatchLogonRight";b=Marshal.StringToHGlobalUni(text);U right=new U();right.B=b;right.L=(ushort)(text.Length*2);right.M=(ushort)((text.Length+1)*2);
   check();uint result=operation==1?LsaAddAccountRights(h,s,new U[]{right},1):LsaRemoveAccountRights(h,s,false,new U[]{right},1);check();
   if(result!=0)throw new Exception("POLICY_WRITE_REFUSED");
   return operation==1;
  } finally {if(b!=IntPtr.Zero)Marshal.FreeHGlobal(b);if(r!=IntPtr.Zero)LsaFreeMemory(r);if(s!=IntPtr.Zero)Marshal.FreeHGlobal(s);if(h!=IntPtr.Zero)LsaClose(h);}
 }
}
'@
}

function New-R05Directory {
 param([string]$Path,[string]$OwnerSid,[string]$TestSid,[bool]$Writable,[R05ProofBudget]$Budget,[scriptblock]$OnCreated={})
 if(Invoke-R05ProtectedApi $Budget Forward {Test-Path -LiteralPath $Path}){throw 'PROOF_OWN_OBJECT_COLLISION'}
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false)
 $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($OwnerSid))
 foreach($allowedSid in @($OwnerSid,'S-1-5-18','S-1-5-32-544')){
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($allowedSid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
 }
 if($TestSid){$rights=if($Writable){'Modify'}else{'ReadAndExecute'};$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($TestSid),$rights,'ContainerInherit,ObjectInherit','None','Allow'))}
 $null=Invoke-R05ProtectedApi $Budget Forward {([IO.DirectoryInfo]::new($Path)).Create($acl);& $OnCreated}
}
function Get-R05TaskSnapshot {
 param([string]$Name,[string]$ExpectedSid,[R05ProofBudget]$Budget,[ValidateSet('Forward','Cleanup')][string]$Phase='Forward')
 $task=Invoke-R05ProtectedApi $Budget $Phase {Get-ScheduledTask -TaskName $Name -TaskPath '\' -ErrorAction Stop}
 $principalId=[string]$task.Principal.UserId
 $sid=if($principalId -cmatch '^S-1-5-21-\d+-\d+-\d+-\d+$'){$principalId}else{Invoke-R05ProtectedApi $Budget $Phase {([Security.Principal.NTAccount]::new($principalId)).Translate([Security.Principal.SecurityIdentifier]).Value}}
 if($sid -cne $ExpectedSid -or $task.Principal.LogonType -ne 'Password' -or $task.Principal.RunLevel -ne 'Limited' -or @($task.Actions).Count -ne 1){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 [xml]$xml=Invoke-R05ProtectedApi $Budget $Phase {Export-ScheduledTask -TaskName $Name -TaskPath '\'}
 $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
 $actions=$xml.SelectSingleNode('/t:Task/t:Actions',$ns);if($null -eq $actions){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $actionHash=Get-R05Digest ([Text.Encoding]::UTF8.GetBytes($actions.OuterXml));$actions.InnerXml=''
 $definitionHash=Get-R05Digest ([Text.Encoding]::UTF8.GetBytes($xml.OuterXml))
 $service=Invoke-R05ProtectedApi $Budget $Phase {New-Object -ComObject 'Schedule.Service'}
 $null=Invoke-R05ProtectedApi $Budget $Phase {$service.Connect()}
 $folder=Invoke-R05ProtectedApi $Budget $Phase {$service.GetFolder('\')}
 $registeredTask=Invoke-R05ProtectedApi $Budget $Phase {$folder.GetTask($Name)}
 $security=[string](Invoke-R05ProtectedApi $Budget $Phase {$registeredTask.GetSecurityDescriptor(7)})
 return @{nonAction=$definitionHash;security=(Get-R05Digest ([Text.Encoding]::UTF8.GetBytes($security)));action=$actionHash;execute=[string]$task.Actions[0].Execute;arguments=[string]$task.Actions[0].Arguments;workingDirectory=[string]$task.Actions[0].WorkingDirectory}
}
function Initialize-R05TaskUpdateBinding {
 if('R05TaskUpdateBinding' -as [type]){return}
 Add-Type -TypeDefinition @'
using System;
using System.Globalization;
using System.Reflection;
public static class R05TaskUpdateBinding {
 // Object null is VT_EMPTY, not DBNull (VT_NULL), Missing or an empty BSTR.
 // Fixed UPDATE | DONT_ADD_PRINCIPAL_ACE | IGNORE_REGISTRATION_TRIGGERS.
 public static object[] Arguments(string name,object definition) {
  return new object[]{name,definition,52,(object)null,(object)null,0,(object)null};
 }
 static object Call(object target,string method,object[] arguments) {
  return target.GetType().InvokeMember(method,BindingFlags.InvokeMethod,
   null,target,arguments,null,CultureInfo.InvariantCulture,null);
 }
 public static void Connect(object service) {Call(service,"Connect",new object[0]);}
 public static object Root(object service) {return Call(service,"GetFolder",new object[]{"\\"});}
 public static object Update(object folder,string name,object definition) {
  return Call(folder,"RegisterTaskDefinition",Arguments(name,definition));
 }
}
'@
}
function New-R05TaskUpdateService {return New-Object -ComObject 'Schedule.Service'}
function Get-R05TaskUpdateXmlState([string]$Xml) {
 if([string]::IsNullOrWhiteSpace($Xml) -or $Xml.Length -gt 65536 -or $Xml -match '<!DOCTYPE'){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $document=[xml]::new();$document.XmlResolver=$null;$document.LoadXml($Xml)
 $ns=[Xml.XmlNamespaceManager]::new($document.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
 $actions=@($document.SelectNodes('/t:Task/t:Actions',$ns))
 if($actions.Count -ne 1){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $exec=@($actions[0].SelectNodes('*'))
 if($exec.Count -ne 1 -or $exec[0].LocalName -cne 'Exec' -or $exec[0].NamespaceURI -cne $ns.LookupNamespace('t')){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $full=Get-R05Digest ([Text.Encoding]::UTF8.GetBytes($document.OuterXml))
 # Keep the complete action envelope, including Id, Context and every other
 # node/attribute. Only the three intended leaf text values may differ.
 foreach($field in @('Command','Arguments','WorkingDirectory')){
  $node=@($exec[0].SelectNodes(('t:'+$field),$ns))
  if($node.Count -ne 1 -or $node[0].SelectNodes('*').Count -ne 0){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
  $node[0].InnerText=''
 }
 return @{full=$full;envelope=(Get-R05Digest ([Text.Encoding]::UTF8.GetBytes($document.OuterXml)))}
}
function Get-R05TaskUpdateState {
 param($Registered,[string]$Name,[string]$Sid,[R05ProofBudget]$Budget,[string]$Operation)
 $path=[string](Invoke-R05ProtectedApi $Budget Forward {$Registered.Path} -Operation $Operation)
 if($path -cne ('\'+$Name)){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $definition=Invoke-R05ProtectedApi $Budget Forward {$Registered.Definition} -Operation $Operation
 $principal=Invoke-R05ProtectedApi $Budget Forward {$definition.Principal} -Operation $Operation
 $userId=[string](Invoke-R05ProtectedApi $Budget Forward {$principal.UserId} -Operation $Operation)
 $actualSid=if($userId -cmatch '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$'){$userId}else{
  [string](Invoke-R05ProtectedApi $Budget Forward {([Security.Principal.NTAccount]::new($userId)).Translate([Security.Principal.SecurityIdentifier]).Value} -Operation $Operation)
 }
 $logon=Invoke-R05ProtectedApi $Budget Forward {$principal.LogonType} -Operation $Operation
 $runLevel=Invoke-R05ProtectedApi $Budget Forward {$principal.RunLevel} -Operation $Operation
 if($actualSid -cne $Sid -or $logon -ne 1 -or $runLevel -ne 0){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $actions=Invoke-R05ProtectedApi $Budget Forward {$definition.Actions} -Operation $Operation
 $count=Invoke-R05ProtectedApi $Budget Forward {$actions.Count} -Operation $Operation
 if($count -ne 1){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $exec=Invoke-R05ProtectedApi $Budget Forward {$actions.Item(1)} -Operation $Operation
 $type=Invoke-R05ProtectedApi $Budget Forward {$exec.Type} -Operation $Operation
 if($type -ne 0){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $id=[string](Invoke-R05ProtectedApi $Budget Forward {$exec.Id} -Operation $Operation)
 $context=[string](Invoke-R05ProtectedApi $Budget Forward {$actions.Context} -Operation $Operation)
 $execute=[string](Invoke-R05ProtectedApi $Budget Forward {$exec.Path} -Operation $Operation)
 $arguments=[string](Invoke-R05ProtectedApi $Budget Forward {$exec.Arguments} -Operation $Operation)
 $workingDirectory=[string](Invoke-R05ProtectedApi $Budget Forward {$exec.WorkingDirectory} -Operation $Operation)
 $xml=[string](Invoke-R05ProtectedApi $Budget Forward {$definition.XmlText} -Operation $Operation)
 $xmlState=Get-R05TaskUpdateXmlState $xml
 $security=[string](Invoke-R05ProtectedApi $Budget Forward {$Registered.GetSecurityDescriptor(7)} -Operation $Operation)
 if([string]::IsNullOrWhiteSpace($security)){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 return @{definition=$definition;exec=$exec;xml=$xmlState;id=$id;context=$context;security=(Get-R05Digest ([Text.Encoding]::UTF8.GetBytes($security)));execute=$execute;arguments=$arguments;workingDirectory=$workingDirectory}
}
function Set-R05OwnedTaskAction {
 param($Owned,$Action,[R05ProofBudget]$Budget,[ValidateSet('TASK_ACTION_UPDATE','TASK_ACTION_RESTORE')][string]$Operation)
 Assert-R05ProofBudget $Budget Forward
 if($Owned.nonce -cnotmatch '^[a-f0-9]{32}$' -or $Owned.taskName -cne ('Goriq-R05-CredentialRetention-'+$Owned.nonce) -or $Owned.sid -cnotmatch '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$'){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $execute=[string]$Action.Execute;$arguments=[string]$Action.Arguments;$workingDirectory=[string]$Action.WorkingDirectory
 foreach($value in @($execute,$arguments,$workingDirectory)){if([string]::IsNullOrWhiteSpace($value) -or $value -match '[\r\n\x00]'){throw 'PROOF_TASK_BOUNDARY_CHANGED'}}
 $null=Invoke-R05ProtectedApi $Budget Forward {Initialize-R05TaskUpdateBinding} -Operation $Operation
 $service=Invoke-R05ProtectedApi $Budget Forward {New-R05TaskUpdateService} -Operation $Operation
 # No server/user/domain/password arguments: local service and existing identity.
 $null=Invoke-R05ProtectedApi $Budget Forward {[R05TaskUpdateBinding]::Connect($service)} -Operation $Operation
 $folder=Invoke-R05ProtectedApi $Budget Forward {[R05TaskUpdateBinding]::Root($service)} -Operation $Operation
 $registered=Invoke-R05ProtectedApi $Budget Forward {$folder.GetTask($Owned.taskName)} -Operation $Operation
 $before=Get-R05TaskUpdateState $registered $Owned.taskName $Owned.sid $Budget $Operation
 $exec=$before.exec
 $null=Invoke-R05ProtectedApi $Budget Forward {$exec.Path=$execute} -Operation $Operation
 $null=Invoke-R05ProtectedApi $Budget Forward {$exec.Arguments=$arguments} -Operation $Operation
 $null=Invoke-R05ProtectedApi $Budget Forward {$exec.WorkingDirectory=$workingDirectory} -Operation $Operation
 $editedXml=[string](Invoke-R05ProtectedApi $Budget Forward {$before.definition.XmlText} -Operation $Operation)
 $edited=Get-R05TaskUpdateXmlState $editedXml
 if($edited.envelope -cne $before.xml.envelope){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 # Fresh binding before UPDATE; UPDATE4 never creates a missing task. This
 # detects observed replacement but is not an atomic compare-and-swap API.
 $fresh=Invoke-R05ProtectedApi $Budget Forward {$folder.GetTask($Owned.taskName)} -Operation $Operation
 $freshState=Get-R05TaskUpdateState $fresh $Owned.taskName $Owned.sid $Budget $Operation
 if($freshState.xml.full -cne $before.xml.full -or $freshState.security -cne $before.security -or $freshState.id -cne $before.id -or $freshState.context -cne $before.context){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 $null=Invoke-R05ProtectedApi $Budget Forward {[R05TaskUpdateBinding]::Update($folder,$Owned.taskName,$before.definition)} -Operation $Operation
 $afterTask=Invoke-R05ProtectedApi $Budget Forward {$folder.GetTask($Owned.taskName)} -Operation $Operation
 $after=Get-R05TaskUpdateState $afterTask $Owned.taskName $Owned.sid $Budget $Operation
 if($after.xml.envelope -cne $before.xml.envelope -or $after.id -cne $before.id -or $after.context -cne $before.context -or $after.security -cne $before.security -or $after.execute -cne $execute -or $after.arguments -cne $arguments -or $after.workingDirectory -cne $workingDirectory){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
 Assert-R05ProofBudget $Budget Forward
}
function Invoke-R05TaskRun {
 param([string]$Name,[string]$Results,[string]$ExpectedSid,[string]$Marker,[R05ProofBudget]$Budget)
 $before=@(Invoke-R05ProtectedApi $Budget Forward {Get-ChildItem -LiteralPath $Results -Filter '*.json' -File | ForEach-Object {$_.Name}})
 Assert-R05ProofBudget $Budget Forward -MinimumRemainingSeconds 50
 $null=Invoke-R05ProtectedApi $Budget Forward {Start-ScheduledTask -TaskName $Name -TaskPath '\'}
 $until=(Get-R05BudgetTime $Budget).mono+45
 while((Get-R05BudgetTime $Budget).mono -lt $until){
  Assert-R05ProofBudget $Budget Forward
  $new=@(Invoke-R05ProtectedApi $Budget Forward {Get-ChildItem -LiteralPath $Results -Filter '*.json' -File | Where-Object {$_.Name -notin $before}})
  $task=Invoke-R05ProtectedApi $Budget Forward {Get-ScheduledTask -TaskName $Name -TaskPath '\'}
  if($new.Count -eq 1 -and $task.State -eq 'Ready'){
   $info=Invoke-R05ProtectedApi $Budget Forward {Get-ScheduledTaskInfo -TaskName $Name -TaskPath '\'}
   if($info.LastTaskResult -ne 0 -or $new[0].Length -gt 4096){throw 'PROOF_EXECUTION_FAILED'}
   $wire=Invoke-R05ProtectedApi $Budget Forward {[IO.File]::ReadAllText($new[0].FullName)}
   $r=$wire|ConvertFrom-Json
   if($r.schemaVersion -ne 1 -or $r.marker -cne $Marker -or $r.actualSid -cne $ExpectedSid -or $r.isSystem -ne $false){throw 'PROOF_ACCOUNT_EXECUTION_MISMATCH'}
   Assert-R05ProofBudget $Budget Forward
   return $true
  }
  if($new.Count -gt 1){throw 'PROOF_EXECUTION_FAILED'}
  Assert-R05ProofBudget $Budget Forward;Start-Sleep -Milliseconds 200;Assert-R05ProofBudget $Budget Forward
 }
 throw 'PROOF_EXECUTION_FAILED'
}
function Invoke-R05CredentialProof {
 $result=New-R05FixtureResult;$budget=$null
 $owned=@{stage='approval';root=$null;rootCreated=$false;rootAttempted=$false;accountAttempted=$false;user=$null;sid=$null;taskName=$null;password=$null;secure=$null;ownerSid=$null;registered=$false;scope=$null;nonce=$null;userName=$null}
 try{
  if($Apply -and $ValidateOnly){throw 'PROOF_MODE_REQUIRED'}
  if(-not $Apply -and -not $ValidateOnly){return $result}
  if(-not $ApprovalPath){throw 'PROOF_APPROVAL_REQUIRED'}
  $item=Get-Item -LiteralPath $ApprovalPath
  if($item -isnot [IO.FileInfo] -or $item.Length -gt 32768 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'PROOF_APPROVAL_REQUIRED'}
  $bytes=[IO.File]::ReadAllBytes($ApprovalPath)
  $wire=[Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xfeff).Trim()
  $scope=if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$wire|ConvertFrom-Json -DateKind String}else{$wire|ConvertFrom-Json}
  if(($scope|ConvertTo-Json -Depth 5 -Compress) -cne $wire){throw 'PROOF_APPROVAL_REQUIRED'}
  $scriptHash=Get-R05Digest ([IO.File]::ReadAllBytes($PSCommandPath))
  $context=@{actor=$env:GITHUB_ACTOR;repo=$env:GITHUB_REPOSITORY;ref=$env:GITHUB_REF;sha=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;attempt=$env:GITHUB_RUN_ATTEMPT;job=$env:GITHUB_JOB}
  $scope=Assert-R05FixtureApproval $scope ([datetimeoffset]::UtcNow) $scriptHash $context
  $owned.scope=$scope
  $result.validationAccepted=$true;$result.sourceRevision=$scope.sourceRevision;$result.scriptSha256=$scriptHash;$result.approvalSha256=Get-R05Digest $bytes;$result.runId=$env:GITHUB_RUN_ID;$result.attemptId=$scope.attemptId
  if($ValidateOnly){$result.mode='VALIDATE_ONLY';return $result}
  $owned.stage='platform'
  if($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64'){throw 'PROOF_HOSTED_WINDOWS_REQUIRED'}
  try{$processDeadline=[datetimeoffset]::Parse($env:GORIQ_PROOF_PROCESS_DEADLINE_UTC)}catch{throw 'PROOF_JOB_BUDGET_REQUIRED'}
  if(($processDeadline-[datetimeoffset]::UtcNow).TotalSeconds -gt 660){throw 'PROOF_JOB_BUDGET_REQUIRED'}
  $budget=New-R05ProofBudget -ScopeExpiry ([datetimeoffset]::Parse($scope.expiresAt)) -JobDeadline $processDeadline
  $budget.Diagnostics=$result.diagnostics;$script:R05LastBudget=$budget;$result.deadlineBudgetAdmitted=$true;$result.mode='APPLY'
  $owned.nonce=$scope.attemptId.Replace('-','');$owned.userName='grq25'+$owned.nonce.Substring(0,12);$owned.taskName='Goriq-R05-CredentialRetention-'+$owned.nonce
  $owned.root=[IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP ('goriq-r05-proof-'+$owned.nonce)))
  $forward={
   $identity=Invoke-R05ProtectedApi $budget Forward {[Security.Principal.WindowsIdentity]::GetCurrent()}
   $owned.ownerSid=$identity.User.Value
   $admin=Invoke-R05ProtectedApi $budget Forward {([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}
   if(-not $admin){throw 'PROOF_HOSTED_ADMIN_REQUIRED'}
   $result.windowsBuild=[Environment]::OSVersion.Version.ToString()
   $null=Invoke-R05ProtectedApi $budget Forward {Initialize-R05Native}
   $owned.stage='native-callback'
   $nativeCheck=New-R05NativeBudgetCheck $budget Forward
   $null=Invoke-R05ProtectedApi $budget Forward {[R05FixtureNative]::Check($nativeCheck)}
   $exists=Invoke-R05ProtectedApi $budget Forward {Test-Path -LiteralPath $owned.root}
   $collisionUser=Invoke-R05ProtectedApi $budget Forward {Get-LocalUser -Name $owned.userName -ErrorAction SilentlyContinue}
   $collisionTask=Invoke-R05ProtectedApi $budget Forward {Get-ScheduledTask -TaskName $owned.taskName -ErrorAction SilentlyContinue}
   if($exists -or $collisionUser -or $collisionTask){throw 'PROOF_OWN_OBJECT_COLLISION'}
   $owned.stage='account'
   $null=Invoke-R05ProtectedApi $budget Forward {
    $random=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($random);$owned.password='Aa9!'+[Convert]::ToBase64String($random)}finally{$rng.Dispose();[Array]::Clear($random,0,$random.Length)}
    $owned.secure=ConvertTo-SecureString $owned.password -AsPlainText -Force
   }
   $null=Invoke-R05ProtectedApi $budget Forward {
    $owned.accountAttempted=$true
    $created=New-LocalUser -Name $owned.userName -Password $owned.secure -AccountExpires ([datetimeoffset]::Parse($scope.expiresAt)).UtcDateTime -Description ('R05 proof '+$owned.nonce) -ErrorAction Stop
    if($created.SID.Value -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or $created.SID.Value -ceq $owned.ownerSid){throw 'PROOF_ACCOUNT_BOUNDARY_CHANGED'}
    $owned.user=$created;$owned.sid=$created.SID.Value;$result.accountCreated=$true
   }
   $owned.stage='batch-right'
   $logon=Invoke-R05ProtectedApi $budget Forward {[R05FixtureNative]::BatchLogon($owned.userName,$owned.password,$nativeCheck)}
   if($logon -eq 1385){
    $null=Invoke-R05ProtectedApi $budget Forward {$null=[R05FixtureNative]::BatchRight($owned.sid,1,$nativeCheck);$result.conditionalBatchRightAdded=$true}
    $logon=Invoke-R05ProtectedApi $budget Forward {[R05FixtureNative]::BatchLogon($owned.userName,$owned.password,$nativeCheck)}
   }
   if($logon -ne 0){throw 'PROOF_BATCH_LOGON_REFUSED'}
   $owned.stage='own-files';$owned.rootAttempted=$true
   New-R05Directory $owned.root $owned.ownerSid $owned.sid $false $budget {$owned.rootCreated=$true}
   $results=Join-Path $owned.root 'private-results';New-R05Directory $results $owned.ownerSid $owned.sid $true $budget
   $worker=Join-Path $owned.root 'worker.ps1'
   $workerText=@'
param([ValidateSet('baseline','changed')][string]$Marker,[string]$Results,[string]$ForwardUtc,[string]$ForwardMono)
$ErrorActionPreference='Stop'
$end=[datetimeoffset]::Parse($ForwardUtc);$monoEnd=[double]::Parse($ForwardMono,[Globalization.CultureInfo]::InvariantCulture)
function Check-WorkerBudget {
 $now=[datetimeoffset]::UtcNow;$mono=[double][Diagnostics.Stopwatch]::GetTimestamp()/[Diagnostics.Stopwatch]::Frequency
 if($now -ge $end -or $mono -ge $monoEnd){throw 'PROOF_WORKER_DEADLINE'}
}
Check-WorkerBudget;$identity=[Security.Principal.WindowsIdentity]::GetCurrent();Check-WorkerBudget
$value=@{schemaVersion=1;marker=$Marker;actualSid=$identity.User.Value;isSystem=$identity.IsSystem}
$path=Join-Path $Results (([guid]::NewGuid().ToString('N'))+'.json')
$stream=$null
try{
 Check-WorkerBudget;$stream=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,1,[IO.FileOptions]::WriteThrough);Check-WorkerBudget
 $bytes=[Text.Encoding]::UTF8.GetBytes(($value|ConvertTo-Json -Compress))
 Check-WorkerBudget;$stream.Write($bytes,0,$bytes.Length);Check-WorkerBudget
 Check-WorkerBudget;$stream.Flush($true);Check-WorkerBudget
}finally{if($stream){$stream.Dispose()}}
'@
   $null=Invoke-R05ProtectedApi $budget Forward {[IO.File]::WriteAllText($worker,$workerText,[Text.UTF8Encoding]::new($false))}
   $shell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
   $deadlineArgs=' -ForwardUtc "'+$budget.ForwardUtc.ToString('o')+'" -ForwardMono "'+$budget.ForwardMono.ToString('R',[Globalization.CultureInfo]::InvariantCulture)+'"'
   $baseAction=Invoke-R05ProtectedApi $budget Forward {New-ScheduledTaskAction -Execute $shell -Argument ('-NoLogo -NoProfile -NonInteractive -File "'+$worker+'" -Marker baseline -Results "'+$results+'"'+$deadlineArgs) -WorkingDirectory $owned.root}
   $changedDirectory=Join-Path $owned.root 'changed-working-directory';New-R05Directory $changedDirectory $owned.ownerSid $owned.sid $false $budget
   $changedAction=Invoke-R05ProtectedApi $budget Forward {New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\cmd.exe') -Argument ('/d /s /c ""'+$shell+'" -NoLogo -NoProfile -NonInteractive -File "'+$worker+'" -Marker changed -Results "'+$results+'"'+$deadlineArgs+'"') -WorkingDirectory $changedDirectory}
   $trigger=Invoke-R05ProtectedApi $budget Forward {New-ScheduledTaskTrigger -Once -At ([datetime]::Now.AddDays(1))}
   $settings=Invoke-R05ProtectedApi $budget Forward {New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries}
   $owned.stage='registration'
   $null=Invoke-R05ProtectedApi $budget Forward {
    $owned.registered=$true
    Register-ScheduledTask -TaskName $owned.taskName -TaskPath '\' -Action $baseAction -Trigger $trigger -Settings $settings -User ($env:COMPUTERNAME+'\'+$owned.userName) -Password $owned.password -RunLevel Limited | Out-Null
    $result.taskCreated=$true
   }
   $owned.password=$null;$owned.secure.Dispose();$owned.secure=$null
   $before=Get-R05TaskSnapshot $owned.taskName $owned.sid $budget
   $owned.stage='baseline';$result.baselineRan=Invoke-R05TaskRun $owned.taskName $results $owned.sid 'baseline' $budget
   $owned.stage='action-update';Assert-R05ProofBudget $budget Forward -MinimumRemainingSeconds 100
   $null=Invoke-R05ProtectedApi $budget Forward {
    # Fixed empty credential VARIANTs; no credential values are supplied.
    Set-R05OwnedTaskAction -Owned $owned -Action $changedAction -Budget $budget -Operation TASK_ACTION_UPDATE
    $result.updateOmittedUserAndPassword=$true
   } -Operation TASK_ACTION_UPDATE
   $changed=Get-R05TaskSnapshot $owned.taskName $owned.sid $budget
   if($changed.nonAction -cne $before.nonAction -or $changed.security -cne $before.security -or $changed.action -ceq $before.action){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
   if($changed.execute -ceq $before.execute -or $changed.arguments -ceq $before.arguments -or $changed.workingDirectory -ceq $before.workingDirectory){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
   $result.allThreeActionFieldsChanged=$true
   $owned.stage='changed-execution';$result.changedRan=Invoke-R05TaskRun $owned.taskName $results $owned.sid 'changed' $budget
   $owned.stage='action-restore'
   $null=Invoke-R05ProtectedApi $budget Forward {
    Set-R05OwnedTaskAction -Owned $owned -Action $baseAction -Budget $budget -Operation TASK_ACTION_RESTORE
    $result.restoreOmittedUserAndPassword=$true
   } -Operation TASK_ACTION_RESTORE
   $restored=Get-R05TaskSnapshot $owned.taskName $owned.sid $budget
   if($restored.nonAction -cne $before.nonAction -or $restored.security -cne $before.security -or $restored.action -cne $before.action){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
   $result.actionRestored=$true
   $owned.stage='restored-execution';$result.restoredRan=Invoke-R05TaskRun $owned.taskName $results $owned.sid 'baseline' $budget
   $result.actualAccountSidMatched=$true;$result.passwordLogonPreserved=$true;$result.limitedPrincipalPreserved=$true
   $result.nonActionDefinitionPreserved=$true;$result.taskSecurityPreserved=$true
  }.GetNewClosure()
  $cleanup={
   $owned.stage='cleanup'
   $budget.DiagnosticComponent='TASK'
   try{
    if($owned.registered){
     $task=Invoke-R05ProtectedApi $budget Cleanup {Get-ScheduledTask -TaskName $owned.taskName -TaskPath '\' -ErrorAction SilentlyContinue}
     if($task){
      $null=Get-R05TaskSnapshot $owned.taskName $owned.sid $budget Cleanup
      if($task.State -eq 'Running'){$null=Invoke-R05ProtectedApi $budget Cleanup {Stop-ScheduledTask -TaskName $owned.taskName -TaskPath '\'}}
      $stopEnd=(Get-R05BudgetTime $budget).mono+65
      while($true){
       $task=Invoke-R05ProtectedApi $budget Cleanup {Get-ScheduledTask -TaskName $owned.taskName -TaskPath '\'}
       if($task.State -ne 'Running'){break}
       if((Get-R05BudgetTime $budget).mono -ge $stopEnd){throw 'PROOF_CLEANUP_FAILED'}
       Assert-R05ProofBudget $budget Cleanup;Start-Sleep -Milliseconds 200;Assert-R05ProofBudget $budget Cleanup
      }
      $null=Invoke-R05ProtectedApi $budget Cleanup {Unregister-ScheduledTask -TaskName $owned.taskName -TaskPath '\' -Confirm:$false}
     }
     $left=Invoke-R05ProtectedApi $budget Cleanup {Get-ScheduledTask -TaskName $owned.taskName -TaskPath '\' -ErrorAction SilentlyContinue}
     $result.taskRemoved= -not [bool]$left
    }else{$result.taskRemoved=$true}
   }catch{Save-R05DiagnosticFault $budget Cleanup $_ $budget.DiagnosticComponent OTHER SOURCE_REFUSAL NOT_APPLICABLE;if($budget.HardExpired -or $budget.CleanupExpired){throw}}finally{$budget.DiagnosticComponent='NONE'}
   if($result.accountCreated){
    $budget.DiagnosticComponent='ACCOUNT_DISABLE'
    try{
     $live=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName}
     if($live.SID.Value -cne $owned.sid){throw 'PROOF_CLEANUP_FAILED'}
     $null=Invoke-R05ProtectedApi $budget Cleanup {Disable-LocalUser -InputObject $live}
    }catch{Save-R05DiagnosticFault $budget Cleanup $_ $budget.DiagnosticComponent OTHER SOURCE_REFUSAL NOT_APPLICABLE;if($budget.HardExpired -or $budget.CleanupExpired){throw}}finally{$budget.DiagnosticComponent='NONE'}
    $budget.DiagnosticComponent='BATCH_RIGHT'
    try{
     $live=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName}
     if($live.SID.Value -cne $owned.sid){throw 'PROOF_CLEANUP_FAILED'}
     $cleanupCheck=New-R05NativeBudgetCheck $budget Cleanup
     $null=Invoke-R05ProtectedApi $budget Cleanup {$null=[R05FixtureNative]::BatchRight($owned.sid,2,$cleanupCheck)}
     $remainingRight=Invoke-R05ProtectedApi $budget Cleanup {[R05FixtureNative]::BatchRight($owned.sid,0,$cleanupCheck)}
     $result.ownBatchRightRemovedOrAbsent= -not $remainingRight
    }catch{Save-R05DiagnosticFault $budget Cleanup $_ $budget.DiagnosticComponent OTHER SOURCE_REFUSAL NOT_APPLICABLE;if($budget.HardExpired -or $budget.CleanupExpired){throw}}finally{$budget.DiagnosticComponent='NONE'}
    $budget.DiagnosticComponent='PROFILE'
    try{
     $live=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName}
     if($live.SID.Value -cne $owned.sid){throw 'PROOF_CLEANUP_FAILED'}
     $waitStart=Get-R05BudgetTime $budget
     $waitUtc=$waitStart.utc.AddSeconds(30)
     foreach($limit in @($budget.CleanupUtc,$budget.HardUtc,$budget.ScopeExpiry,$budget.JobDeadline)){
      $reservedLimit=$limit.AddSeconds(-15);if($reservedLimit -lt $waitUtc){$waitUtc=$reservedLimit}
     }
     $waitMono=[Math]::Min($waitStart.mono+30,[Math]::Min($budget.CleanupMono,$budget.HardMono)-15)
     $profileQueries=0;$profileSleeps=0;$observedLoaded=$false
     while($true){
      Assert-R05ProofBudget $budget Cleanup
      $beforeQuery=Get-R05BudgetTime $budget
      if($beforeQuery.utc -ge $waitUtc -or $beforeQuery.mono -ge $waitMono){
       if($observedLoaded){Set-R05ProfileDiagnosticState $result.diagnostics LOADED_REFUSED}
       throw 'PROOF_CLEANUP_FAILED'
      }
      $profiles=@(Invoke-R05ProtectedApi $budget Cleanup {
       try{Get-CimInstance -ClassName Win32_UserProfile -Filter ('SID="'+$owned.sid+'"')}catch{Set-R05ProfileDiagnosticState $result.diagnostics QUERY_FAILED;throw}
      } -Operation PROFILE_QUERY)
      $profileQueries++
      foreach($profile in $profiles){
       if($profile.SID -cne $owned.sid){Set-R05ProfileDiagnosticState $result.diagnostics SID_MISMATCH_REFUSED;throw 'PROOF_CLEANUP_FAILED'}
       if($profile.Special){Set-R05ProfileDiagnosticState $result.diagnostics SPECIAL_REFUSED;throw 'PROOF_CLEANUP_FAILED'}
      }
      if($profiles.Count -gt 1){throw 'PROOF_CLEANUP_FAILED'}
      if($profiles.Count -eq 0 -or -not $profiles[0].Loaded){break}
      $observedLoaded=$true
      $beforeSleep=Get-R05BudgetTime $budget
      if($profileQueries -ge 61 -or $profileSleeps -ge 60 -or $beforeSleep.utc.AddMilliseconds(500) -gt $waitUtc -or $beforeSleep.mono+0.5 -gt $waitMono){
       Set-R05ProfileDiagnosticState $result.diagnostics LOADED_REFUSED;throw 'PROOF_CLEANUP_FAILED'
      }
      Assert-R05ProofBudget $budget Cleanup;Start-Sleep -Milliseconds 500;Assert-R05ProofBudget $budget Cleanup
      $profileSleeps++
      # A stalled monotonic clock is a readiness refusal, not a new global
      # clock verdict. Independent remaining cleanup keeps its original guards.
      if((Get-R05BudgetTime $budget).mono -le $beforeSleep.mono){Set-R05ProfileDiagnosticState $result.diagnostics LOADED_REFUSED;throw 'PROOF_CLEANUP_FAILED'}
     }
     foreach($profile in $profiles){
      if($profile.SID -cne $owned.sid){Set-R05ProfileDiagnosticState $result.diagnostics SID_MISMATCH_REFUSED;throw 'PROOF_CLEANUP_FAILED'}
      if($profile.Special){Set-R05ProfileDiagnosticState $result.diagnostics SPECIAL_REFUSED;throw 'PROOF_CLEANUP_FAILED'}
      if($profile.Loaded){Set-R05ProfileDiagnosticState $result.diagnostics LOADED_REFUSED;throw 'PROOF_CLEANUP_FAILED'}
      $null=Invoke-R05ProtectedApi $budget Cleanup {
       try{Remove-CimInstance -InputObject $profile}catch{Set-R05ProfileDiagnosticState $result.diagnostics REMOVE_FAILED;throw}
      } -Operation PROFILE_REMOVE
     }
     $remainingProfiles=@(Invoke-R05ProtectedApi $budget Cleanup {
      try{Get-CimInstance -ClassName Win32_UserProfile -Filter ('SID="'+$owned.sid+'"')}catch{Set-R05ProfileDiagnosticState $result.diagnostics READBACK_FAILED;throw}
     } -Operation PROFILE_READBACK)
     $result.ownProfileRemovedOrAbsent=$remainingProfiles.Count -eq 0
     Set-R05ProfileDiagnosticState $result.diagnostics $(if($remainingProfiles.Count -ne 0){'STILL_PRESENT'}elseif($profiles.Count -eq 0){'ABSENT_CONFIRMED'}else{'REMOVED_AND_ABSENT_CONFIRMED'})
     if($remainingProfiles.Count -ne 0){Save-R05DiagnosticFault $budget Cleanup $null PROFILE PROFILE_READBACK SOURCE_REFUSAL NOT_APPLICABLE}
    }catch{Save-R05DiagnosticFault $budget Cleanup $_ $budget.DiagnosticComponent OTHER SOURCE_REFUSAL NOT_APPLICABLE;if($budget.HardExpired -or $budget.CleanupExpired){throw}}finally{$budget.DiagnosticComponent='NONE'}
    $budget.DiagnosticComponent='ACCOUNT_REMOVE'
    try{
     $live=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName}
     if($live.SID.Value -cne $owned.sid){throw 'PROOF_CLEANUP_FAILED'}
     $null=Invoke-R05ProtectedApi $budget Cleanup {Remove-LocalUser -InputObject $live}
     $remainingUser=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName -ErrorAction SilentlyContinue}
     $result.accountRemoved= -not [bool]$remainingUser
    }catch{Save-R05DiagnosticFault $budget Cleanup $_ $budget.DiagnosticComponent OTHER SOURCE_REFUSAL NOT_APPLICABLE;if($budget.HardExpired -or $budget.CleanupExpired){throw}}finally{$budget.DiagnosticComponent='NONE'}
   }else{
    if($owned.accountAttempted){
     $ambiguous=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName -ErrorAction SilentlyContinue}
     $result.accountRemoved= -not [bool]$ambiguous
    }else{$result.accountRemoved=$true}
    $result.ownProfileRemovedOrAbsent=$true;$result.ownBatchRightRemovedOrAbsent=$true
   }
   $budget.DiagnosticComponent='FILES'
   try{
    if($owned.rootCreated){
     $exists=Invoke-R05ProtectedApi $budget Cleanup {Test-Path -LiteralPath $owned.root}
     if($exists){
      if([IO.Path]::GetFileName($owned.root) -cne ('goriq-r05-proof-'+$owned.nonce)){throw 'PROOF_CLEANUP_FAILED'}
      $rootItem=Invoke-R05ProtectedApi $budget Cleanup {Get-Item -LiteralPath $owned.root}
      $children=@(Invoke-R05ProtectedApi $budget Cleanup {Get-ChildItem -LiteralPath $owned.root -Recurse -Force})
      $all=@($rootItem)+$children
      if(@($all | Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0}).Count){throw 'PROOF_CLEANUP_FAILED'}
      $null=Invoke-R05ProtectedApi $budget Cleanup {Remove-Item -LiteralPath $owned.root -Recurse -Force}
     }
     $left=Invoke-R05ProtectedApi $budget Cleanup {Test-Path -LiteralPath $owned.root}
     $result.ownFilesRemoved= -not $left
    }elseif($owned.rootAttempted){
     $left=Invoke-R05ProtectedApi $budget Cleanup {Test-Path -LiteralPath $owned.root}
     $result.ownFilesRemoved= -not $left
    }else{$result.ownFilesRemoved=$true}
   }catch{Save-R05DiagnosticFault $budget Cleanup $_ $budget.DiagnosticComponent OTHER SOURCE_REFUSAL NOT_APPLICABLE;if($budget.HardExpired -or $budget.CleanupExpired){throw}}finally{$budget.DiagnosticComponent='NONE'}
   $result.cleanupVerified=$result.taskRemoved -and $result.accountRemoved -and $result.ownProfileRemovedOrAbsent -and $result.ownBatchRightRemovedOrAbsent -and $result.ownFilesRemoved
   if(-not $result.cleanupVerified){throw 'PROOF_CLEANUP_FAILED'}
  }.GetNewClosure()
  $outcome=Invoke-R05BudgetedRun $budget $forward $cleanup {$owned.stage}.GetNewClosure()
  $result.forwardCompleted=$outcome.forwardCompleted;$result.finalDeadlineValid=$outcome.finalDeadlineValid
  $result.failureCode=$outcome.failureCode;$result.cleanupFailureCode=$outcome.cleanupFailureCode
  if($result.failureCode){$result.failedStage=$outcome.failedStage}
 }catch{$result.failureCode=Get-R05FailureCode $_;$result.failedStage=$owned.stage}
 finally{
  # Release-only disposal/memory clearing is safe after expiry; it admits no new protected effect.
  $owned.password=$null;if($owned.secure){$owned.secure.Dispose();$owned.secure=$null}
 }
 if($budget){
  $result.forwardDeadlineExceeded=$budget.ForwardExpired;$result.cleanupDeadlineExceeded=$budget.CleanupExpired;$result.hardDeadlineExceeded=$budget.HardExpired
 }
 $required=@('forwardCompleted','finalDeadlineValid','baselineRan','changedRan','restoredRan','actionRestored','cleanupVerified','allThreeActionFieldsChanged','actualAccountSidMatched','passwordLogonPreserved','limitedPrincipalPreserved','nonActionDefinitionPreserved','taskSecurityPreserved','updateOmittedUserAndPassword','restoreOmittedUserAndPassword')
 $result.complete=$result.mode -eq 'APPLY' -and $null -eq $result.failureCode -and @($required | Where-Object {$result[$_] -ne $true}).Count -eq 0
 if($result.complete){try{Assert-R05ProofBudget $budget Final}catch{$result.complete=$false;$result.failureCode=Get-R05FailureCode $_;$result.failedStage='final-deadline'}}
 return $result
}
if($MyInvocation.InvocationName -ne '.'){
 $output=Invoke-R05CredentialProof
 $wire=$output|ConvertTo-Json -Depth 5 -Compress
 if($output.complete){
  try{Assert-R05ProofBudget $script:R05LastBudget Final}
  catch{$output.complete=$false;$output.failureCode=Get-R05FailureCode $_;$output.failedStage='final-deadline';$wire=$output|ConvertTo-Json -Depth 5 -Compress}
 }
 Write-Output $wire
 if($output.failureCode -or ($Apply -and -not $output.complete)){exit 1}
}

