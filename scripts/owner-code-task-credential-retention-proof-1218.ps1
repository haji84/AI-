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
function New-R05FixtureResult {
 return [ordered]@{schemaVersion=2;issue=1218;operation='ephemeral-password-task-retention-proof';complete=$false;
  mode='PLAN_ONLY';failureCode=$null;failedStage=$null;cleanupFailureCode=$null;sourceRevision=$null;scriptSha256=$null;approvalSha256=$null;
  runId=$null;runAttempt=1;attemptId=$null;validationAccepted=$false;accountCreated=$false;taskCreated=$false;
  conditionalBatchRightAdded=$false;baselineRan=$false;changedRan=$false;restoredRan=$false;
  actualAccountSidMatched=$false;passwordLogonPreserved=$false;limitedPrincipalPreserved=$false;
  nonActionDefinitionPreserved=$false;taskSecurityPreserved=$false;actionRestored=$false;
  updateOmittedUserAndPassword=$false;restoreOmittedUserAndPassword=$false;allThreeActionFieldsChanged=$false;windowsBuild=$null;
  taskRemoved=$false;accountRemoved=$false;ownProfileRemovedOrAbsent=$false;ownBatchRightRemovedOrAbsent=$false;
  ownFilesRemoved=$false;cleanupVerified=$false;existingTaskTouched=$false;productionTouched=$false;
  deadlineBudgetAdmitted=$false;forwardCompleted=$false;finalDeadlineValid=$false;forwardDeadlineExceeded=$false;cleanupDeadlineExceeded=$false;hardDeadlineExceeded=$false;
  credentialValueEmitted=$false;rawIdentityOrPathEmitted=$false;nativeZBookAcceptanceCredit=0}
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
 param([R05ProofBudget]$Budget,[ValidateSet('Forward','Cleanup')][string]$Phase,[scriptblock]$Action)
 Assert-R05ProofBudget $Budget $Phase
 $failure=$null;$value=$null
 try{$value=& $Action}catch{$failure=$_}
 # Action records returned owned handles/identities BEFORE this post-call guard.
 # A blocking OS API cannot be interrupted here; a late return cannot authorize another forward API or PASS.
 Assert-R05ProofBudget $Budget $Phase
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
 try{
  Assert-R05ProofBudget $Budget Forward
  & $Forward | Out-Null
  Assert-R05ProofBudget $Budget Forward
  $out.forwardCompleted=$true
 }catch{$out.failureCode=Get-R05FailureCode $_;$out.failedStage=& $GetStage}
 finally{
  try{Start-R05ProofCleanup $Budget;& $Cleanup | Out-Null;Assert-R05ProofBudget $Budget Cleanup;$out.cleanupCompleted=$true}
  catch{$out.cleanupFailureCode=Get-R05FailureCode $_;if(-not $out.failureCode){$out.failureCode=$out.cleanupFailureCode;$out.failedStage='cleanup'}}
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
  $script:R05LastBudget=$budget;$result.deadlineBudgetAdmitted=$true;$result.mode='APPLY'
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
    # Intentionally omit User, Password, Principal, Trigger and Settings.
    Set-ScheduledTask -TaskName $owned.taskName -TaskPath '\' -Action $changedAction | Out-Null
    $result.updateOmittedUserAndPassword=$true
   }
   $changed=Get-R05TaskSnapshot $owned.taskName $owned.sid $budget
   if($changed.nonAction -cne $before.nonAction -or $changed.security -cne $before.security -or $changed.action -ceq $before.action){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
   if($changed.execute -ceq $before.execute -or $changed.arguments -ceq $before.arguments -or $changed.workingDirectory -ceq $before.workingDirectory){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
   $result.allThreeActionFieldsChanged=$true
   $owned.stage='changed-execution';$result.changedRan=Invoke-R05TaskRun $owned.taskName $results $owned.sid 'changed' $budget
   $owned.stage='action-restore'
   $null=Invoke-R05ProtectedApi $budget Forward {
    Set-ScheduledTask -TaskName $owned.taskName -TaskPath '\' -Action $baseAction | Out-Null
    $result.restoreOmittedUserAndPassword=$true
   }
   $restored=Get-R05TaskSnapshot $owned.taskName $owned.sid $budget
   if($restored.nonAction -cne $before.nonAction -or $restored.security -cne $before.security -or $restored.action -cne $before.action){throw 'PROOF_TASK_BOUNDARY_CHANGED'}
   $result.actionRestored=$true
   $owned.stage='restored-execution';$result.restoredRan=Invoke-R05TaskRun $owned.taskName $results $owned.sid 'baseline' $budget
   $result.actualAccountSidMatched=$true;$result.passwordLogonPreserved=$true;$result.limitedPrincipalPreserved=$true
   $result.nonActionDefinitionPreserved=$true;$result.taskSecurityPreserved=$true
  }.GetNewClosure()
  $cleanup={
   $owned.stage='cleanup'
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
   }catch{if($budget.HardExpired -or $budget.CleanupExpired){throw}}
   if($result.accountCreated){
    try{
     $live=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName}
     if($live.SID.Value -cne $owned.sid){throw 'PROOF_CLEANUP_FAILED'}
     $null=Invoke-R05ProtectedApi $budget Cleanup {Disable-LocalUser -InputObject $live}
    }catch{if($budget.HardExpired -or $budget.CleanupExpired){throw}}
    try{
     $live=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName}
     if($live.SID.Value -cne $owned.sid){throw 'PROOF_CLEANUP_FAILED'}
     $cleanupCheck=New-R05NativeBudgetCheck $budget Cleanup
     $null=Invoke-R05ProtectedApi $budget Cleanup {$null=[R05FixtureNative]::BatchRight($owned.sid,2,$cleanupCheck)}
     $remainingRight=Invoke-R05ProtectedApi $budget Cleanup {[R05FixtureNative]::BatchRight($owned.sid,0,$cleanupCheck)}
     $result.ownBatchRightRemovedOrAbsent= -not $remainingRight
    }catch{if($budget.HardExpired -or $budget.CleanupExpired){throw}}
    try{
     $live=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName}
     if($live.SID.Value -cne $owned.sid){throw 'PROOF_CLEANUP_FAILED'}
     $profiles=@(Invoke-R05ProtectedApi $budget Cleanup {Get-CimInstance -ClassName Win32_UserProfile -Filter ('SID="'+$owned.sid+'"')})
     foreach($profile in $profiles){
      if($profile.SID -cne $owned.sid -or $profile.Special -or $profile.Loaded){throw 'PROOF_CLEANUP_FAILED'}
      $null=Invoke-R05ProtectedApi $budget Cleanup {Remove-CimInstance -InputObject $profile}
     }
     $remainingProfiles=@(Invoke-R05ProtectedApi $budget Cleanup {Get-CimInstance -ClassName Win32_UserProfile -Filter ('SID="'+$owned.sid+'"')})
     $result.ownProfileRemovedOrAbsent=$remainingProfiles.Count -eq 0
    }catch{if($budget.HardExpired -or $budget.CleanupExpired){throw}}
    try{
     $live=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName}
     if($live.SID.Value -cne $owned.sid){throw 'PROOF_CLEANUP_FAILED'}
     $null=Invoke-R05ProtectedApi $budget Cleanup {Remove-LocalUser -InputObject $live}
     $remainingUser=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName -ErrorAction SilentlyContinue}
     $result.accountRemoved= -not [bool]$remainingUser
    }catch{if($budget.HardExpired -or $budget.CleanupExpired){throw}}
   }else{
    if($owned.accountAttempted){
     $ambiguous=Invoke-R05ProtectedApi $budget Cleanup {Get-LocalUser -Name $owned.userName -ErrorAction SilentlyContinue}
     $result.accountRemoved= -not [bool]$ambiguous
    }else{$result.accountRemoved=$true}
    $result.ownProfileRemovedOrAbsent=$true;$result.ownBatchRightRemovedOrAbsent=$true
   }
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
   }catch{if($budget.HardExpired -or $budget.CleanupExpired){throw}}
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

