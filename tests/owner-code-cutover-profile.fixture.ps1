param([ValidateSet('selector','capsule','execution-boundary','clr-public-policy','clr-public-profiler','clr-product-data','clr-product-profiler','owned-job-policy','owned-job-windows','owned-job-manager')][string]$Scenario='selector')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# PUBLIC owned-process mechanism only. These types are never product interop.
if($Scenario -in @('owned-job-policy','owned-job-windows','owned-job-manager')){
 $jobResult=@{scope='PUBLIC_OWNED_JOB_MECHANISM_ONLY';nativeAuthority=$false;status='INCONCLUSIVE';failureCode='PUBLIC_JOB_NOT_EXECUTED';actualWindowsExecuted=$false;actualProductInteropLinked=$false;privateCWTAuthorityLinked=$false;originalAdminClockLinked=$false;nativeGrant=$false;actualPrivateOrTaskCalls=0;ownedArtifactsRemoved=$true;ownedChildrenExited=$true}
 function Job-Public-Digest([byte[]]$Bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
 if($Scenario -eq 'owned-job-windows' -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){$jobResult.status='NOT_RUN';$jobResult.failureCode='PUBLIC_JOB_WINDOWS_REQUIRED';$jobResult.processAllocations=0;$jobResult.jobCreateCalls=0;$jobResult|ConvertTo-Json -Depth 5 -Compress;exit}
 $jobSource=@'
using System;using System.Diagnostics;using System.Runtime.CompilerServices;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public sealed class PublicOwnedJobPrototypeHandle:SafeHandleZeroOrMinusOneIsInvalid {
 public PublicOwnedJobPrototypeHandle():base(true){}public int PublicPrototypeMarker{get{return 1;}}
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool CloseHandle(IntPtr h);
 protected override bool ReleaseHandle(){return CloseHandle(handle);}
}
public sealed class PublicOwnedJobPrototype {
 [StructLayout(LayoutKind.Sequential)]struct Basic {public long ProcessTime,JobTime;public uint Flags;public UIntPtr MinWork,MaxWork;public uint Active;public UIntPtr Affinity;public uint Priority,Schedule;}
 [StructLayout(LayoutKind.Sequential)]struct Io {public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;}
 [StructLayout(LayoutKind.Sequential)]struct Extended {public Basic Basic;public Io Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern PublicOwnedJobPrototypeHandle CreateJobObjectW(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(PublicOwnedJobPrototypeHandle job,int kind,ref Extended info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetHandleInformation(PublicOwnedJobPrototypeHandle job,out uint flags);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(PublicOwnedJobPrototypeHandle job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool IsProcessInJob(IntPtr process,PublicOwnedJobPrototypeHandle job,out bool member);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateProcess(IntPtr process,uint exitCode);
 readonly ConditionalWeakTable<Process,ProcessStartInfo> allocations=new ConditionalWeakTable<Process,ProcessStartInfo>();
 Process node;ProcessStartInfo info;string image,args,cwd;PublicOwnedJobPrototypeHandle job;bool terminal,started,assigned;int calls,lastError;
 public int PublicPrototypeMarker{get{return 1;}}public bool Started{get{return started;}}public bool Assigned{get{return assigned;}}public bool Terminal{get{return terminal;}}public int NativeCalls{get{return calls;}}public int LastNativeError{get{return lastError;}}public bool NonInheritable{get;private set;}
 static void Windows(){if(Environment.OSVersion.Platform!=PlatformID.Win32NT)throw new InvalidOperationException("PUBLIC_JOB_WINDOWS_REQUIRED");}
 void Active(){if(terminal)throw new InvalidOperationException("PUBLIC_JOB_TERMINAL");}
 void NativeFailure(string code){lastError=Marshal.GetLastWin32Error();throw new InvalidOperationException(code);}
 public Process AllocateNode(ProcessStartInfo value){Active();if(node!=null||value==null||value.UseShellExecute||!String.IsNullOrEmpty(value.UserName))throw new InvalidOperationException("PUBLIC_JOB_ALLOCATION_REFUSED");info=value;image=value.FileName;args=value.Arguments;cwd=value.WorkingDirectory;node=new Process();node.StartInfo=value;allocations.Add(node,value);return node;}
 public void AssertOriginal(Process value){ProcessStartInfo original;if(value==null||!Object.ReferenceEquals(node,value)||!allocations.TryGetValue(value,out original)||!Object.ReferenceEquals(original,info)||!Object.ReferenceEquals(value.StartInfo,info)||info.FileName!=image||info.Arguments!=args||info.WorkingDirectory!=cwd)throw new InvalidOperationException("PUBLIC_JOB_ALLOCATION_REFUSED");}
 public void CreateOwnedJob(){Active();Windows();if(job!=null)throw new InvalidOperationException("PUBLIC_JOB_DUPLICATE_CREATE");calls++;job=CreateJobObjectW(IntPtr.Zero,null);if(job==null||job.IsInvalid)NativeFailure("PUBLIC_JOB_CREATE_FAILED");Extended limit=new Extended();limit.Basic.Flags=0x2000;calls++;if(!SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf(typeof(Extended))))NativeFailure("PUBLIC_JOB_LIMIT_FAILED");uint flags;calls++;if(!GetHandleInformation(job,out flags))NativeFailure("PUBLIC_JOB_FLAGS_FAILED");NonInheritable=(flags&1)==0;if(!NonInheritable)throw new InvalidOperationException("PUBLIC_JOB_INHERITABLE_REFUSED");}
 public void StartAllocated(Process value){Active();AssertOriginal(value);Windows();if(started)throw new InvalidOperationException("PUBLIC_JOB_DUPLICATE_START");if(!value.Start())throw new InvalidOperationException("PUBLIC_JOB_START_FAILED");started=true;IntPtr retained=value.Handle;if(retained==IntPtr.Zero)throw new InvalidOperationException("PUBLIC_JOB_PROCESS_HANDLE_REQUIRED");}
 public void AssignOriginal(Process value){Active();AssertOriginal(value);if(!started||job==null||job.IsClosed||job.IsInvalid)throw new InvalidOperationException("PUBLIC_JOB_ASSIGNMENT_REQUIRED");Windows();if(assigned)throw new InvalidOperationException("PUBLIC_JOB_DUPLICATE_ASSIGN");calls++;if(!AssignProcessToJobObject(job,value.Handle))NativeFailure("PUBLIC_JOB_ASSIGN_FAILED");bool member;calls++;if(!IsProcessInJob(value.Handle,job,out member))NativeFailure("PUBLIC_JOB_MEMBERSHIP_FAILED");if(!member)throw new InvalidOperationException("PUBLIC_JOB_MEMBERSHIP_REQUIRED");assigned=true;}
 public void AssertHelloAllowed(Process value){Active();AssertOriginal(value);if(!started||!assigned)throw new InvalidOperationException("PUBLIC_JOB_ASSIGNMENT_REQUIRED");}
 public bool CloseOwnedJob(){if(terminal)return false;terminal=true;if(job!=null){job.Dispose();job=null;}return true;}
 public void StopOnlyOwnedUnassigned(Process value){AssertOriginal(value);if(!started||assigned)throw new InvalidOperationException("PUBLIC_JOB_UNASSIGNED_CLEANUP_REQUIRED");Windows();if(!value.HasExited){calls++;if(!TerminateProcess(value.Handle,137))NativeFailure("PUBLIC_JOB_NODE_CONTAINMENT_FAILED");}}
}
'@
 $jobResult.prototypeSourceSha256=Job-Public-Digest ([Text.Encoding]::UTF8.GetBytes($jobSource))
 try{
  if(('PublicOwnedJobPrototype' -as [type]) -or ('PublicOwnedJobPrototypeHandle' -as [type])){throw 'PUBLIC_JOB_PRELOADED_TYPE_REFUSED'}
  $null=Add-Type -TypeDefinition $jobSource
 }catch{$jobResult.failureCode='PUBLIC_JOB_PROTOTYPE_SOURCE_REFUSED';$jobResult|ConvertTo-Json -Depth 5 -Compress;exit}
 # Closed numeric messages are lookup hints only. Binding requires actual held
 # process observations; duplicate identity tuples are never new authority.
 function Job-ParseIdentity([string]$Line,[string]$Role){
  if($Role -cnotin @('NODE','HELPER')){throw 'PUBLIC_JOB_IDENTITY_MESSAGE_REFUSED'}
  $match=[regex]::Match($Line,('^'+$Role+' ([1-9][0-9]{0,9}) ([1-9][0-9]{0,19})\z'))
  $idValue=0;$birth=0L
  if(-not $match.Success -or -not [int]::TryParse($match.Groups[1].Value,[ref]$idValue) -or -not [long]::TryParse($match.Groups[2].Value,[ref]$birth)){throw 'PUBLIC_JOB_IDENTITY_MESSAGE_REFUSED'}
  return @{role=$Role;id=$idValue;birth=$birth}
 }
 function Job-BindIdentity($Claim,[int]$ObservedId,[long]$ObservedBirth,[string]$ObservedImage,[string]$ExpectedImage,[int]$ObservedParent,[int]$ExpectedParent,$Rows){
  if($Claim.id -ne $ObservedId -or $Claim.birth -ne $ObservedBirth -or -not [string]::Equals($ObservedImage,$ExpectedImage,[StringComparison]::OrdinalIgnoreCase) -or $ObservedParent -ne $ExpectedParent -or $ExpectedParent -lt 1){throw 'PUBLIC_JOB_IDENTITY_REFUSED'}
  $key=[string]$Claim.id+':'+[string]$Claim.birth
  if(-not $Rows.Add($key)){throw 'PUBLIC_JOB_IDENTITY_REUSE_REFUSED'}
 }
 if($Scenario -eq 'owned-job-policy'){try{
  $a=[PublicOwnedJobPrototype]::new();$b=[PublicOwnedJobPrototype]::new();$i=[Diagnostics.ProcessStartInfo]::new();$i.FileName='PUBLIC_NOT_EXECUTED_NODE';$i.UseShellExecute=$false;$p=$a.AllocateNode($i);$j=[Diagnostics.ProcessStartInfo]::new();$j.FileName='PUBLIC_NOT_EXECUTED_NODE';$j.UseShellExecute=$false;$foreign=$b.AllocateNode($j)
  $foreignRefused=$false;$beforeHelloRefused=$false;$changedInfoRefused=$false
  try{$a.AssertOriginal($foreign)}catch{$foreignRefused=$_.Exception.Message.Contains('PUBLIC_JOB_ALLOCATION_REFUSED')}
  try{$a.AssertHelloAllowed($p)}catch{$beforeHelloRefused=$_.Exception.Message.Contains('PUBLIC_JOB_ASSIGNMENT_REQUIRED')}
  $i.Arguments='CHANGED_PUBLIC_DATA';try{$a.AssertOriginal($p)}catch{$changedInfoRefused=$_.Exception.Message.Contains('PUBLIC_JOB_ALLOCATION_REFUSED')}
  $closed=$a.CloseOwnedJob();$duplicate=$a.CloseOwnedJob();$null=$b.CloseOwnedJob();$p.Dispose();$foreign.Dispose()
  $rows=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal);$claim=Job-ParseIdentity 'HELPER 123 456' 'HELPER';Job-BindIdentity $claim 123 456 'PUBLIC_FIXED_IMAGE' 'PUBLIC_FIXED_IMAGE' 11 11 $rows
  $identity=@{};foreach($case in @('malformed','foreignRole','overflow','birthMismatch','imageMismatch','parentMismatch','reuse')){
   $refused=$false;try{switch($case){
    'malformed'{$null=Job-ParseIdentity 'HELPER 123 456 extra' 'HELPER'}
    'foreignRole'{$null=Job-ParseIdentity 'NODE 123 456' 'HELPER'}
    'overflow'{$null=Job-ParseIdentity 'HELPER 9999999999 456' 'HELPER'}
    'birthMismatch'{Job-BindIdentity $claim 123 457 'PUBLIC_FIXED_IMAGE' 'PUBLIC_FIXED_IMAGE' 11 11 $rows}
    'imageMismatch'{Job-BindIdentity $claim 123 456 'PUBLIC_FOREIGN_IMAGE' 'PUBLIC_FIXED_IMAGE' 11 11 $rows}
    'parentMismatch'{Job-BindIdentity $claim 123 456 'PUBLIC_FIXED_IMAGE' 'PUBLIC_FIXED_IMAGE' 12 11 $rows}
    'reuse'{Job-BindIdentity $claim 123 456 'PUBLIC_FIXED_IMAGE' 'PUBLIC_FIXED_IMAGE' 11 11 $rows}
   }}catch{$refused=$_.Exception.Message -cmatch '^PUBLIC_JOB_IDENTITY_(?:MESSAGE_REFUSED|REFUSED|REUSE_REFUSED)$'};$identity[$case]=$refused
  };$jobResult.identityRefusals=$identity
  $wireCases=@(('HELPER 123 456'+[string][char]10),('HELPER 123 456'+[string][char]13),('HELPER 123 456'+[string][char]13+[string][char]10),('HELPER 123 456 extra'),(' HELPER 123 456'),('HELPER 123 456 '),('HELPER 0123 456'),('HELPER 123 0456'),('HELPER 0 456'),('HELPER 123 0'),('HELPER -1 456'),('HELPER 123 -1'),('HELPER +123 456'),('HELPER 123 +456'),('helper 123 456'),('NODE 123 456'),('HELPER 2147483648 456'),('HELPER 123 9223372036854775808'),('HELPER 123'+[string][char]9+'456'),('HELPER 123 456'+[string][char]0),('HELPER 123 456'+[string][char]10+'HELPER 123 456'),(''),('HELPER 123'),('HELPER 123 456 789'));$wireRefused=0
  foreach($line in $wireCases){try{$null=Job-ParseIdentity $line 'HELPER'}catch{if($_.Exception.Message -ceq 'PUBLIC_JOB_IDENTITY_MESSAGE_REFUSED'){$wireRefused++}}}
  $maxClaim=Job-ParseIdentity 'HELPER 2147483647 9223372036854775807' 'HELPER'
  $jobResult.hostileIdentityMessageCount=$wireCases.Count;$jobResult.hostileIdentityMessagesRefused=($wireRefused -eq $wireCases.Count);$jobResult.identityUpperBoundsAccepted=($maxClaim.id -eq [int]::MaxValue -and $maxClaim.birth -eq [long]::MaxValue);$jobResult.tupleConsumesOnlyOnValidBinding=($rows.Count -eq 1)

  $jobResult.status='POLICY_ONLY';$jobResult.failureCode='NONE';$jobResult.foreignAllocationRefused=$foreignRefused;$jobResult.helloBeforeAssignmentRefused=$beforeHelloRefused;$jobResult.changedStartInfoRefused=$changedInfoRefused;$jobResult.firstCloseReturned=$closed;$jobResult.duplicateCloseReturned=$duplicate;$jobResult.nativeCalls=($a.NativeCalls+$b.NativeCalls);$jobResult.processesStarted=0;$jobResult|ConvertTo-Json -Depth 5 -Compress;exit
 }catch{$jobResult.failureCode='PUBLIC_JOB_POLICY_SETUP_REFUSED';$jobResult|ConvertTo-Json -Depth 5 -Compress;exit}}
 $jobWatch=[Diagnostics.Stopwatch]::StartNew();$jobRoot=$null;$script:jobOwners=[Collections.Generic.List[object]]::new();$script:jobRecords=[Collections.Generic.List[object]]::new();$script:jobObserved=[Collections.Generic.List[object]]::new();$script:managerRecord=$null;$script:jobIdentityRows=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 function Job-Remaining([int]$Cap){$left=14000-[int]$jobWatch.ElapsedMilliseconds;if($left -lt 1){throw 'PUBLIC_JOB_CASE_BUDGET_EXHAUSTED'};return [Math]::Min($Cap,$left)}
 function Job-Info([string]$Image,[string]$Arguments,[string]$Directory){$i=[Diagnostics.ProcessStartInfo]::new();$i.FileName=$Image;$i.Arguments=$Arguments;$i.WorkingDirectory=$Directory;$i.UseShellExecute=$false;$i.CreateNoWindow=$true;$i.RedirectStandardInput=$true;$i.RedirectStandardOutput=$true;$i.RedirectStandardError=$true;$i.EnvironmentVariables.Clear();$i.EnvironmentVariables['SystemRoot']=$windows;$i.EnvironmentVariables['windir']=$windows;$i.EnvironmentVariables['PATH']=$windows+'\System32';$i.EnvironmentVariables['TEMP']=$Directory;$i.EnvironmentVariables['TMP']=$Directory;$i.EnvironmentVariables['PSModulePath']=$windows+'\System32\WindowsPowerShell\v1.0\Modules';return $i}
 function Job-Line($Record){$t=$Record.process.StandardOutput.ReadLineAsync();if(-not $t.Wait((Job-Remaining 2500)) -or $t.IsFaulted){throw 'PUBLIC_JOB_MESSAGE_TIMEOUT'};$line=$t.Result;if($line -isnot [string] -or $line.Length -gt 128){throw 'PUBLIC_JOB_MESSAGE_REFUSED'};return $line}
 function Job-Observe([string]$Line,[string]$Role,[string]$Image,$Parent){
  $claim=Job-ParseIdentity $Line $Role;if($Parent.HasExited){throw 'PUBLIC_JOB_IDENTITY_MESSAGE_REFUSED'}
  $p=[Diagnostics.Process]::GetProcessById($claim.id);[void]$script:jobObserved.Add($p);$null=$p.Handle
  if($p.HasExited){throw 'PUBLIC_JOB_IDENTITY_REFUSED'}
  # Narrow readonly query of this already factory-reported child only. No scan,
  # PID assignment or PID termination; retained HANDLE is used after this point.
  $row=CimCmdlets\Get-CimInstance Win32_Process -Filter ('ProcessId='+$claim.id) -OperationTimeoutSec 2 -ErrorAction Stop
  if($null -eq $row -or $Parent.HasExited -or $p.HasExited){throw 'PUBLIC_JOB_PARENT_REFUSED'}
  Job-BindIdentity $claim $p.Id ($p.StartTime.ToUniversalTime().ToFileTimeUtc()) $p.MainModule.FileName $Image ([int]$row.ParentProcessId) $Parent.Id $script:jobIdentityRows
  return $p
 }
 function Job-StartNode([bool]$WithJob){$owner=[PublicOwnedJobPrototype]::new();[void]$script:jobOwners.Add($owner);if($WithJob){$owner.CreateOwnedJob()};$info=Job-Info $nodePath ('"'+$nodeScript+'"') $jobRoot;$p=$owner.AllocateNode($info);$record=@{owner=$owner;process=$p;stderr=$null;hello=$false};[void]$script:jobRecords.Add($record);$owner.StartAllocated($p);$record.stderr=$p.StandardError.ReadToEndAsync();$record.birth=$p.StartTime.ToUniversalTime().ToFileTimeUtc();if((Job-Line $record) -cne 'READY'){throw 'PUBLIC_JOB_READY_REQUIRED'};return $record}
 function Job-Hello($Record,[bool]$Assigned){if($Assigned){$Record.owner.AssertHelloAllowed($Record.process)};if($Record.hello){throw 'PUBLIC_JOB_DUPLICATE_HELLO'};$Record.process.StandardInput.WriteLine('HELLO');$Record.process.StandardInput.Flush();$Record.hello=$true;return Job-Observe (Job-Line $Record) 'HELPER' $fixedPS $Record.process}
 function Job-Wait($p,[int]$Cap){if(-not $p.WaitForExit((Job-Remaining $Cap))){throw 'PUBLIC_JOB_OWNED_EXIT_TIMEOUT'}}
 try{
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [IntPtr]::Size -ne 8 -or $PSVersionTable.PSVersion.Major -ne 5){throw 'PUBLIC_JOB_WINPS51_X64_REQUIRED'};$jobResult.actualWindowsExecuted=$true
  $windows=[Environment]::GetFolderPath('Windows');$fixedPS=$windows+'\System32\WindowsPowerShell\v1.0\powershell.exe';$selfPath=$MyInvocation.MyCommand.Path
  $data=if($Scenario -eq 'owned-job-manager'){[Console]::In.ReadLine()|ConvertFrom-Json}else{[Console]::In.ReadToEnd()|ConvertFrom-Json}
  $fields=if($Scenario -eq 'owned-job-manager'){@('requests','nodePath','nodeSha256','fixtureSha256','root')}else{@('requests','nodePath','nodeSha256','fixtureSha256')};$keys=@($data.PSObject.Properties.Name);if($keys.Count -ne $fields.Count -or @($fields|Where-Object {$keys -cnotcontains $_}).Count){throw 'PUBLIC_JOB_INPUT_REFUSED'}
  $nodePath=$data.nodePath;if($nodePath -isnot [string] -or $nodePath -cnotmatch '^[A-Za-z]:\\[^"\r\n\x00]+\\node\.exe$' -or $data.nodeSha256 -cnotmatch '^[a-f0-9]{64}$' -or $data.fixtureSha256 -cne (Job-Public-Digest ([IO.File]::ReadAllBytes($selfPath))) -or (Job-Public-Digest ([IO.File]::ReadAllBytes($nodePath))) -cne $data.nodeSha256 -or -not [IO.File]::Exists($fixedPS)){throw 'PUBLIC_JOB_FIXED_SOURCE_REQUIRED'}
  if($Scenario -eq 'owned-job-manager'){$jobRoot=[string]$data.root}else{$jobRoot=[IO.Path]::Combine([IO.Path]::GetTempPath(),('public-owned-job-'+[Guid]::NewGuid().ToString('N')));$null=[IO.Directory]::CreateDirectory($jobRoot)}
  if($jobRoot -cnotmatch '^[A-Za-z]:\\[^"\r\n\x00]+\\public-owned-job-[a-f0-9]{32}$'){throw 'PUBLIC_JOB_ROOT_REFUSED'};$nodeScript=[IO.Path]::Combine($jobRoot,'public-node.cjs');$helperScript=[IO.Path]::Combine($jobRoot,'public-helper.ps1')
  $helperSource='$ErrorActionPreference="Stop"; $p=[Diagnostics.Process]::GetCurrentProcess(); [Console]::Out.WriteLine(("HELPER "+$p.Id+" "+$p.StartTime.ToUniversalTime().ToFileTimeUtc())); [Console]::Out.Flush(); [Threading.Thread]::Sleep(5000); exit 73'
  $psLiteral=ConvertTo-Json -InputObject $fixedPS -Compress;$helperLiteral=ConvertTo-Json -InputObject $helperScript -Compress
  $nodeSource=@'
'use strict';const {spawn}=require('node:child_process');const fixedPS=__PS__,script=__HELPER__;let started=false,pending='';const timer=setTimeout(()=>process.exit(74),8000);process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{pending+=chunk;if(pending.length>16)process.exit(76);const at=pending.indexOf('\n');if(at<0)return;const line=pending.slice(0,at).replace(/\r$/,'');pending=pending.slice(at+1);if(started||line!=='HELLO'||pending)process.exit(76);started=true;const child=spawn(fixedPS,['-NoLogo','-NoProfile','-NonInteractive','-File',script],{windowsHide:true,detached:false,stdio:['ignore','pipe','pipe'],env:{...process.env}});let text='',reported=false;child.on('error',()=>process.exit(76));child.stderr.on('data',()=>process.exit(76));child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{text+=part;if(text.length>128)process.exit(76);const end=text.indexOf('\n');if(end<0)return;const value=text.slice(0,end).replace(/\r$/,'');if(reported||text.slice(end+1)||!/^HELPER [1-9][0-9]{0,9} [1-9][0-9]{0,19}$/.test(value)||Number(value.split(' ')[1])!==child.pid)process.exit(76);reported=true;process.stdout.write(value+'\n');});});process.stdout.write('READY\n');
'@
  $nodeSource=$nodeSource.Replace('__PS__',$psLiteral).Replace('__HELPER__',$helperLiteral)
  if($Scenario -eq 'owned-job-manager'){if([IO.File]::ReadAllText($nodeScript) -cne $nodeSource -or [IO.File]::ReadAllText($helperScript) -cne $helperSource){throw 'PUBLIC_JOB_CHILD_SOURCE_REFUSED'}}else{[IO.File]::WriteAllText($nodeScript,$nodeSource,[Text.UTF8Encoding]::new($false));[IO.File]::WriteAllText($helperScript,$helperSource,[Text.UTF8Encoding]::new($false))}
  if($Scenario -eq 'owned-job-manager'){
   $record=Job-StartNode $true;$record.owner.AssignOriginal($record.process);[Console]::Out.WriteLine(('NODE '+$record.process.Id+' '+$record.birth));[Console]::Out.Flush();$heldHelper=Job-Hello $record $true;[Console]::Out.WriteLine(('HELPER '+$heldHelper.Id+' '+$heldHelper.StartTime.ToUniversalTime().ToFileTimeUtc()));[Console]::Out.Flush();[Threading.Thread]::Sleep(8000);exit 75
  }
  # Counterfactual: only original owned Node is terminated; verified helper must
  # still be alive, then self-reap with73. Never terminate a reported helper PID.
  $control=Job-StartNode $false;$controlHelper=Job-Hello $control $false;$outsideHelperHandle=$controlHelper.Handle;$outsideHelperBirth=$controlHelper.StartTime.ToUniversalTime().ToFileTimeUtc();if($controlHelper.HasExited){throw 'PUBLIC_JOB_COUNTERFACTUAL_POSITIVE_MISSING'};$control.owner.StopOnlyOwnedUnassigned($control.process);Job-Wait $control.process 1000;if($controlHelper.HasExited){throw 'PUBLIC_JOB_PARENT_ONLY_CONTROL_MISSING'};$jobResult.parentOnly=@{nodeExited=$true;helperAliveAfterParentKill=$true;helperSelfReaped=$false}
  $clean=Job-StartNode $true;$clean.owner.AssignOriginal($clean.process);$cleanHelper=Job-Hello $clean $true;if($clean.process.HasExited -or $cleanHelper.HasExited){throw 'PUBLIC_JOB_CLOSE_POSITIVE_MISSING'};$firstClose=$clean.owner.CloseOwnedJob();$duplicateClose=$clean.owner.CloseOwnedJob();Job-Wait $clean.process 1000;Job-Wait $cleanHelper 1000;if($cleanHelper.ExitCode -eq 73 -or $clean.process.ExitCode -eq 74){throw 'PUBLIC_JOB_TIMER_CANNOT_PROVE_CONTAINMENT'};if($controlHelper.HasExited -or $controlHelper.Handle -ne $outsideHelperHandle -or $controlHelper.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $outsideHelperBirth){throw 'PUBLIC_JOB_OUTSIDE_HELPER_POSITIVE_MISSING'};$jobResult.jobClose=@{assignedBeforeHello=$true;nonInheritable=$clean.owner.NonInheritable;nodeExited=$true;helperExited=$true;helperSelfTimerWasNotExitCause=$true;outsideJobHelperRemainedAlive=$true;firstClose=$firstClose;duplicateClose=$duplicateClose}
  Job-Wait $controlHelper 5500;if($controlHelper.ExitCode -ne 73){throw 'PUBLIC_JOB_HELPER_SELF_REAP_REQUIRED'};$jobResult.parentOnly.helperSelfReaped=$true
  # A closed-job assignment is refused before HELLO. Actual nested-job API
  # failure is not forced; if encountered above it fails closed without HELLO.
  $early=Job-StartNode $true;$null=$early.owner.CloseOwnedJob();$refused=$false;try{$early.owner.AssignOriginal($early.process)}catch{$refused=$true};if(-not $refused -or $early.hello){throw 'PUBLIC_JOB_PREHELLO_REFUSAL_REQUIRED'};$early.owner.StopOnlyOwnedUnassigned($early.process);Job-Wait $early.process 1000;$remaining=$early.process.StandardOutput.ReadToEndAsync();if(-not $remaining.Wait((Job-Remaining 500)) -or $remaining.Result.Length -ne 0){throw 'PUBLIC_JOB_HELPER_BEFORE_HELLO'};$jobResult.preHelloAssignment=@{closedJobRefused=$true;helloSent=$false;helperMessages=0;nodeContained=$true;forcedKernelAssignmentFailure=$false}
  $managerInfo=Job-Info $fixedPS ('-NoLogo -NoProfile -NonInteractive -File "'+$selfPath+'" -Scenario owned-job-manager') $jobRoot;$manager=[Diagnostics.Process]::new();$manager.StartInfo=$managerInfo;$script:managerRecord=@{process=$manager;stderr=$null};if(-not $manager.Start()){throw 'PUBLIC_JOB_MANAGER_START_FAILED'};$null=$manager.Handle;$script:managerRecord.stderr=$manager.StandardError.ReadToEndAsync();$managerInput=[ordered]@{requests=@();nodePath=$nodePath;nodeSha256=$data.nodeSha256;fixtureSha256=$data.fixtureSha256;root=$jobRoot}|ConvertTo-Json -Compress;$manager.StandardInput.WriteLine($managerInput);$manager.StandardInput.Flush();$deathNode=Job-Observe (Job-Line $script:managerRecord) 'NODE' $nodePath $manager;$deathHelper=Job-Observe (Job-Line $script:managerRecord) 'HELPER' $fixedPS $deathNode
  if($manager.HasExited -or $deathNode.HasExited -or $deathHelper.HasExited){throw 'PUBLIC_JOB_MANAGER_DEATH_POSITIVE_MISSING'};$manager.Kill();Job-Wait $manager 1000;Job-Wait $deathNode 1000;Job-Wait $deathHelper 1000;if($manager.ExitCode -eq 75 -or $deathNode.ExitCode -eq 74 -or $deathHelper.ExitCode -eq 73){throw 'PUBLIC_JOB_TIMER_CANNOT_PROVE_CONTAINMENT'};$jobResult.managerDeath=@{originalManagerKilled=$true;nodeExited=$true;helperExited=$true;selfTimersWereNotExitCause=$true}
  $jobResult.status='PASS';$jobResult.failureCode='NONE';$jobResult.selfTimersAreAdminClockProof=$false;$jobResult.noPidAssignmentOrTermination=$true;$jobResult.actualOriginalClockProof=$false;$jobResult.actualImplicitSQLiteCleanupProof=$false
 }catch{$code=[string]$_.Exception.Message;if($code -cnotmatch '^PUBLIC_JOB_[A-Z0-9_]+$'){$code='PUBLIC_JOB_PROBE_FAILED'};$jobResult.status='INCONCLUSIVE';$jobResult.failureCode=$code}
 finally{
  foreach($owner in $script:jobOwners){try{$null=$owner.CloseOwnedJob()}catch{$jobResult.ownedChildrenExited=$false}}
  foreach($record in $script:jobRecords){try{$null=$record.owner.CloseOwnedJob();if($record.owner.Started -and -not $record.process.HasExited){if(-not $record.owner.Assigned){$record.owner.StopOnlyOwnedUnassigned($record.process)};if(-not $record.process.WaitForExit(1000)){$jobResult.ownedChildrenExited=$false}}}catch{$jobResult.ownedChildrenExited=$false}}
  if($script:managerRecord){try{if(-not $script:managerRecord.process.HasExited){$script:managerRecord.process.Kill();if(-not $script:managerRecord.process.WaitForExit(1000)){$jobResult.ownedChildrenExited=$false}}}catch{$jobResult.ownedChildrenExited=$false}}
  foreach($p in $script:jobObserved){try{if(-not $p.HasExited){if(-not $p.WaitForExit(1000)){$jobResult.ownedChildrenExited=$false}}}catch{$jobResult.ownedChildrenExited=$false}finally{$p.Dispose()}}
  foreach($record in $script:jobRecords){$record.process.Dispose()};if($script:managerRecord){$script:managerRecord.process.Dispose()}
  if($Scenario -ne 'owned-job-manager' -and $jobRoot -and [IO.Directory]::Exists($jobRoot)){try{[IO.Directory]::Delete($jobRoot,$true)}catch{$jobResult.ownedArtifactsRemoved=$false}}
  if(-not $jobResult.ownedChildrenExited -or -not $jobResult.ownedArtifactsRemoved){$jobResult.status='FAIL';$jobResult.failureCode='PUBLIC_JOB_OWNED_CLEANUP_FAILED'}
 }
 if($Scenario -ne 'owned-job-manager'){$jobResult|ConvertTo-Json -Depth 6 -Compress};exit
}
# Test-only literal policy. This is deliberately NOT the product compiler.
# Future acceptance requires running/byte-binding its actual private output at
# this same A/B child boundary, followed by independent source review.
if($Scenario -in @('clr-public-policy','clr-public-profiler','clr-product-data','clr-product-profiler')){
 $literalPolicy='set "COR_ENABLE_PROFILING="&set "COR_PROFILER="&set "COR_PROFILER_PATH_32="&set "COR_PROFILER_PATH_64="&set "COR_PROFILER_PATH_ARM64="&set "COR_PROFILER_PATH="&set "APPDOMAIN_MANAGER_ASM="&set "APPDOMAIN_MANAGER_TYPE="&set "DEVPATH="&set "COMPLUS_ProfAPI_ProfilerCompatibilitySetting="&set "COMPLUS_MDA="&set "PSModuleAnalysisCachePath="&set "PSDisableModuleAnalysisCacheCleanup="'
 $policyBytes=[Text.Encoding]::UTF8.GetBytes($literalPolicy+'&set "PSModulePath={FIXED_SYSTEM_MODULES}"&"{FIXED_SYSTEM_PS}" -NoLogo -NoProfile -NonInteractive -File "{OWNED_PUBLIC_SCRIPT}"')
 $digest=[Security.Cryptography.SHA256]::Create();try{$policyHash=([BitConverter]::ToString($digest.ComputeHash($policyBytes))).Replace('-','').ToLowerInvariant()}finally{$digest.Dispose()}
 function Test-ClrPublicPath([string]$Path){
  # Spaces are supported. Shell expansions, quotes, control/non-ASCII chars,
  # alternate streams, relative/device/UNC forms and ambiguous segments refuse.
  if($Path -cnotmatch '^[A-Za-z]:\\[A-Za-z0-9 ._\\-]+$'){return $false}
  foreach($part in $Path.Substring(3).Split([char]92)){if(-not $part -or $part -in @('.','..') -or $part.EndsWith('.') -or $part.EndsWith(' ')){return $false}}
  return $true
 }
 function New-ClrPublicCommand([string]$FixedSystemPS,[string]$FixedModules,[string]$PublicScript){
  foreach($path in @($FixedSystemPS,$FixedModules,$PublicScript)){if(-not (Test-ClrPublicPath $path)){throw 'PUBLIC_CLR_PATH_REFUSED'}}
  # No command text or environment-name parameter exists. The sole action is
  # the owned fixed public script under fixed Windows PowerShell.
  return '/d /v:off /s /c "'+$literalPolicy+'&set "PSModulePath='+$FixedModules+'"&"'+$FixedSystemPS+'" -NoLogo -NoProfile -NonInteractive -File "'+$PublicScript+'""'
 }
 function Get-ClrPublicPairVerdict($Positive,$Clean){
  if(-not $Positive.profilerMarker){return 'INCONCLUSIVE_POSITIVE_MARKER_MISSING'}
  if(-not $Positive.scriptMarker){return 'INCONCLUSIVE_POSITIVE_SCRIPT_MISSING'}
  if(-not $Positive.profilerBeforeScript){return 'INCONCLUSIVE_POSITIVE_ORDER'}
  if($Positive.exitCode -ne 0){return 'INCONCLUSIVE_POSITIVE_EXIT'}
  if($Clean.profilerMarker){return 'FAIL_CLEAN_PROFILER_EXECUTED'}
  if(-not $Clean.scriptMarker){return 'FAIL_CLEAN_SCRIPT_MISSING'}
  if($Clean.exitCode -ne 0){return 'FAIL_CLEAN_EXIT'}
  return 'PASS'
 }
 function Get-ClrPublicDigest([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
 function New-ClrProductFixtureData([string]$WindowsDirectory,[string]$OwnerProfile,[string]$ReleaseRoot,[string]$EntrySha256){
  return [pscustomobject][ordered]@{profile='goriq-clean-start-command-data-v1';windowsDirectory=$WindowsDirectory;systemPowerShellPath=$WindowsDirectory+'\System32\WindowsPowerShell\v1.0\powershell.exe';ownerProfile=$OwnerProfile;ownerLocalAppData=$OwnerProfile+'\AppData\Local';retainedNodePath=$OwnerProfile+'\JARVIS\tools\node-v24.19.0-win-x64\node.exe';installRoot=$OwnerProfile+'\installation';releaseRoot=$ReleaseRoot;startupStateDirectory=$OwnerProfile+'\installation\startup-state';entrySha256=$EntrySha256;sourceRevision=('b'*40)}
 }
 $productCase=$Scenario -in @('clr-product-data','clr-product-profiler');$productDataResult=$null
 if($productCase){
  $productDataResult=@{scope='ACTUAL_PRODUCT_COMPILER_DATA_ONLY';actualProductCompilerDataCompiled=$false;actualProductCompilerLinked=$false;actualPrivateEntryReady=$false;nativeGrant=$false;actualWindowsExecuted=$false;status='INCONCLUSIVE';failureCode='PUBLIC_CLR_PRODUCT_COMPILER_REQUIRED'}
  try{
   # Retain and import the actual checkout bytes unchanged. No AST extraction,
   # tail rewriting, handoff path, environment backend or private-host call.
   $productSource=[IO.File]::ReadAllBytes((Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-rotation-native-1218.ps1'));$productDataResult.sourceUnderTestSha256=Get-ClrPublicDigest $productSource
   $importOutput=@(. ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($productSource))))
   if(-not (Get-Command New-OwnerCutoverCleanStartCommandData -ErrorAction SilentlyContinue)){throw 'PUBLIC_CLR_PRODUCT_COMPILER_REQUIRED'}
   $productDataResult.defaultSourceInvocationInert=($importOutput.Count -eq 0)
  }catch{$productDataResult|ConvertTo-Json -Depth 5 -Compress;exit}
 }
 if($Scenario -eq 'clr-product-data'){
  $data=New-ClrProductFixtureData 'C:\Windows' 'C:\Owned Public\owner profile' 'C:\Owned Public\release' ('a'*64)
  $command=New-OwnerCutoverCleanStartCommandData $data;$accepted=@($true)
  foreach($mutate in @({param($d)$d|Add-Member extra 'public'},{param($d)$d.PSObject.Properties.Remove('entrySha256')},{param($d)$d.profile='unknown'},{param($d)$d.windowsDirectory='C:\bad%windows'},{param($d)$d.ownerProfile="C:\bad'owner"},{param($d)$d.systemPowerShellPath='C:\Windows\foreign.exe'},{param($d)$d.retainedNodePath='C:\Owned Public\foreign.exe'},{param($d)$d.startupStateDirectory='C:\outside'},{param($d)$d.entrySha256='z'*64},{param($d)$d.sourceRevision='b'*39},{param($d)$d.ownerProfile=@($d.ownerProfile)})){
   $copy=$data.PSObject.Copy();&$mutate $copy;try{$null=New-OwnerCutoverCleanStartCommandData $copy;$accepted+=$true}catch{$accepted+=$false}
  }
  $match=[regex]::Match($command.arguments,' -EncodedCommand ([A-Za-z0-9+/=]+)"$');$capsule=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($match.Groups[1].Value));$payload=[regex]::Match($capsule,"FromBase64String\('([A-Za-z0-9+/=]+)'\)");$metadata=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.Groups[1].Value)))|Microsoft.PowerShell.Utility\ConvertFrom-Json
  $productDataResult.actualProductCompilerDataCompiled=$true;$productDataResult.status='PASS';$productDataResult.failureCode='NONE';$productDataResult.compiledCommandSha256=Get-ClrPublicDigest ([Text.Encoding]::UTF8.GetBytes($command.execute+"`n"+$command.arguments+"`n"+$command.workingDirectory))
  $productDataResult.closedTuple=(@($command.PSObject.Properties).Count -eq 5 -and @('profile','execute','arguments','workingDirectory','effectCapability'|Where-Object {$command.PSObject.Properties.Name -cnotcontains $_}).Count -eq 0 -and $command.profile -ceq 'goriq-clean-start-command-data-v1')
  $productDataResult.fixedCmd=($command.execute -ceq 'C:\Windows\System32\cmd.exe' -and $command.arguments.StartsWith('/d /v:off /s /c "'));$productDataResult.fixedWorkingDirectory=($command.workingDirectory -ceq $data.releaseRoot);$productDataResult.fixedPowerShell=$command.arguments.Contains(('"'+$data.systemPowerShellPath+'" -NoLogo -NoProfile -NonInteractive -EncodedCommand '));$productDataResult.effectCapability=$command.effectCapability;$productDataResult.retainedHashCapsuleBound=($metadata.installRoot -ceq $data.installRoot -and $metadata.entrySha256 -ceq $data.entrySha256 -and $metadata.sourceRevision -ceq $data.sourceRevision -and $capsule.Contains('\scripts\owner-code-rotation-native-1218.ps1') -and $capsule.Contains('if($x -cne $d.entrySha256)'));$productDataResult.acceptedCases=$accepted
  $productDataResult|ConvertTo-Json -Depth 5 -Compress;exit
 }
 if($Scenario -eq 'clr-public-policy'){
  $paths=@('C:\Windows\System32\cmd.exe','C:\Owned Public\probe.ps1','C:\bad&path\probe.ps1','C:\bad%path\probe.ps1','C:\bad!path\probe.ps1','C:\bad"path\probe.ps1',"C:\bad`npath\probe.ps1",'\\server\share\probe.ps1','C:\..\probe.ps1','C:\trailing.\probe.ps1','C:\bad(path)\probe.ps1','C:\bad^path\probe.ps1')
  $positive=@{profilerMarker=$true;scriptMarker=$true;profilerBeforeScript=$true;exitCode=0};$clean=@{profilerMarker=$false;scriptMarker=$true;profilerBeforeScript=$false;exitCode=0}
  $verdicts=@(Get-ClrPublicPairVerdict $positive $clean)
  foreach($patch in @(@{profilerMarker=$false},@{profilerBeforeScript=$false},@{scriptMarker=$false},@{exitCode=1})){$copy=$positive.Clone();foreach($k in $patch.Keys){$copy[$k]=$patch[$k]};$verdicts+=Get-ClrPublicPairVerdict $copy $clean}
  foreach($patch in @(@{profilerMarker=$true},@{scriptMarker=$false},@{exitCode=1})){$copy=$clean.Clone();foreach($k in $patch.Keys){$copy[$k]=$patch[$k]};$verdicts+=Get-ClrPublicPairVerdict $positive $copy}
  $command=New-ClrPublicCommand 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules' 'C:\Owned Public\probe.ps1'
  $names=@('COR_ENABLE_PROFILING','COR_PROFILER','COR_PROFILER_PATH_32','COR_PROFILER_PATH_64','COR_PROFILER_PATH_ARM64','COR_PROFILER_PATH','APPDOMAIN_MANAGER_ASM','APPDOMAIN_MANAGER_TYPE','DEVPATH','COMPLUS_ProfAPI_ProfilerCompatibilitySetting','COMPLUS_MDA','PSModuleAnalysisCachePath','PSDisableModuleAnalysisCacheCleanup')
  $envTable=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase);foreach($name in $names){$envTable.Add($name.ToLowerInvariant(),'public')}
  $clearMatches=[regex]::Matches($literalPolicy,'(?:^|&)set "([A-Za-z0-9_]+)="');foreach($m in $clearMatches){[void]$envTable.Remove($m.Groups[1].Value)}
  @{scope='PUBLIC_PLATFORM_MECHANISM_ONLY';actualProductPrefixLinked=$false;actualWindowsExecuted=$false;constantPolicySha256=$policyHash;pathCases=@($paths|ForEach-Object {Test-ClrPublicPath $_});verdictCases=$verdicts;staticInputsCleared=($clearMatches.Count -eq $names.Count -and @($names|Where-Object {-not $literalPolicy.Contains(('set "'+$_+'="'))}).Count -eq 0);caseInsensitiveAliasesCleared=($envTable.Count -eq 0);fixedSystemModulePath=$command.Contains('set "PSModulePath=C:\Windows\System32\WindowsPowerShell\v1.0\Modules"');fixedCmdFlags=$command.StartsWith('/d /v:off /s /c "');closedPublicScriptOnly=$command.EndsWith('-NoLogo -NoProfile -NonInteractive -File "C:\Owned Public\probe.ps1""');arbitraryEnvironmentNameInput=$false}|ConvertTo-Json -Depth 5 -Compress;exit
 }
 $result=@{scope='PUBLIC_PLATFORM_MECHANISM_ONLY';actualProductPrefixLinked=$false;actualWindowsExecuted=$false;constantPolicySha256=$policyHash;status='INCONCLUSIVE';failureCode='PUBLIC_CLR_WINDOWS_REQUIRED';pairs=@();ownedArtifactsRemoved=$true;ownedChildrenExited=$true}
 if($productCase){$result.scope='PUBLIC_ACTUAL_COMPILER_MECHANISM_ONLY';$result.Remove('actualProductPrefixLinked');$result.actualProductCompilerDataCompiled=$false;$result.actualProductCompilerLinked=$false;$result.actualPrivateEntryReady=$false;$result.nativeGrant=$false;$result.sourceUnderTestSha256=$productDataResult.sourceUnderTestSha256;$result.unmodifiedCommandExecuted=$false;$result.retainedHashRefusalObserved=$false}
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){$result.status='NOT_RUN';$result|ConvertTo-Json -Depth 6 -Compress;exit}
 $result.actualWindowsExecuted=$true;$root=$null
 function Invoke-ClrPublicOwnedProcess([string]$Image,[string]$Arguments,[string]$Directory,[hashtable]$Overrides){
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Image;$info.Arguments=$Arguments;$info.WorkingDirectory=$Directory;$info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  # Owned public baseline: never execute unrelated inherited CLR hooks. Only
  # this new process receives the three deliberate profiler inputs below.
  $info.EnvironmentVariables.Clear();$info.EnvironmentVariables['SystemRoot']=$windows;$info.EnvironmentVariables['windir']=$windows;$info.EnvironmentVariables['PATH']=[IO.Path]::Combine($windows,'System32');$info.EnvironmentVariables['TEMP']=$Directory;$info.EnvironmentVariables['TMP']=$Directory;$info.EnvironmentVariables['PSModulePath']=$modules
  foreach($k in $Overrides.Keys){$info.EnvironmentVariables[$k]=[string]$Overrides[$k]}
  $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$started=$false
  try{if(-not $child.Start()){throw 'PUBLIC_CLR_CHILD_START'};$started=$true;$stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync();if(-not $child.WaitForExit(10000)){throw 'PUBLIC_CLR_CHILD_TIMEOUT'};[void]$stdout.Result;[void]$stderr.Result;return $child.ExitCode}
  finally{
   if($started -and -not $child.HasExited){
    # Kill the owned CMD tree before closing its live process handle. The tree
    # contains only the new fixed public PS child, never an existing runtime.
    $killer=[Diagnostics.Process]::new();$killer.StartInfo=[Diagnostics.ProcessStartInfo]::new();$killer.StartInfo.FileName=[IO.Path]::Combine($windows,'System32\taskkill.exe');$killer.StartInfo.Arguments='/PID '+$child.Id+' /T /F';$killer.StartInfo.UseShellExecute=$false;$killer.StartInfo.RedirectStandardOutput=$true;$killer.StartInfo.RedirectStandardError=$true;$killerStarted=$false
    try{
     if(-not $killer.Start()){throw 'PUBLIC_CLR_OWNED_TREE_CLEANUP_FAILED'};$killerStarted=$true;$killOut=$killer.StandardOutput.ReadToEndAsync();$killErr=$killer.StandardError.ReadToEndAsync()
     if(-not $killer.WaitForExit(2000)){$killer.Kill();[void]$killer.WaitForExit(1000);$result.ownedChildrenExited=$false}
     if($killer.HasExited){[void]$killOut.Result;[void]$killErr.Result;if($killer.ExitCode -ne 0){$result.ownedChildrenExited=$false}}else{$result.ownedChildrenExited=$false}
     [void]$child.WaitForExit(2000)
    }catch{$result.ownedChildrenExited=$false}finally{if($killerStarted -and -not $killer.HasExited){$result.ownedChildrenExited=$false};$killer.Dispose()}
    if(-not $child.HasExited){try{$child.Kill();[void]$child.WaitForExit(1000)}catch{};$result.ownedChildrenExited=$false}
   }
   $child.Dispose()
  }
 }
 try{
  if([IntPtr]::Size -ne 8){throw 'PUBLIC_CLR_X64_REQUIRED'}
  $windows=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows);$programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
  $fixedPS=[IO.Path]::Combine($windows,'System32\WindowsPowerShell\v1.0\powershell.exe');$fixedCmd=[IO.Path]::Combine($windows,'System32\cmd.exe');$modules=[IO.Path]::Combine($windows,'System32\WindowsPowerShell\v1.0\Modules')
  foreach($path in @($fixedPS,$fixedCmd,$modules)){if(-not (Test-ClrPublicPath $path) -or -not [IO.File]::Exists($path) -and -not [IO.Directory]::Exists($path)){throw 'PUBLIC_CLR_FIXED_IMAGE_REQUIRED'}}
  $root=[IO.Path]::Combine([IO.Path]::GetTempPath(),('owned public clr '+[Guid]::NewGuid().ToString('N')));if($productCase){$root=[IO.Path]::Combine([IO.Path]::GetTempPath(),('p '+[Guid]::NewGuid().ToString('N')))};if(-not (Test-ClrPublicPath $root)){throw 'PUBLIC_CLR_PATH_REFUSED'};$null=[IO.Directory]::CreateDirectory($root)
  # Installed MSVC only; no package/toolchain installation, shell setup script,
  # registry registration, GAC/system config or product binary is involved.
  $vsRoot=[IO.Path]::Combine($programFiles,'Microsoft Visual Studio');$candidates=@()
  foreach($base in @($vsRoot,[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),'Microsoft Visual Studio'))){if([IO.Directory]::Exists($base)){foreach($year in [IO.Directory]::GetDirectories($base)){foreach($edition in [IO.Directory]::GetDirectories($year)){$tools=[IO.Path]::Combine($edition,'VC\Tools\MSVC');if([IO.Directory]::Exists($tools)){foreach($version in [IO.Directory]::GetDirectories($tools)){$cl=[IO.Path]::Combine($version,'bin\Hostx64\x64\cl.exe');if([IO.File]::Exists($cl)){$candidates+= $cl}}}}}}}
  if($candidates.Count -eq 0){throw 'PUBLIC_CLR_INSTALLED_COMPILER_REQUIRED'};$compiler=@($candidates|Sort-Object -Descending)[0]
  $kit=[IO.Path]::Combine($programFiles,'Windows Kits\10\Lib');$libs=@();if([IO.Directory]::Exists($kit)){foreach($version in [IO.Directory]::GetDirectories($kit)){$lib=[IO.Path]::Combine($version,'um\x64\kernel32.lib');if([IO.File]::Exists($lib)){$libs+=$lib}}};if($libs.Count -eq 0){throw 'PUBLIC_CLR_INSTALLED_SDK_REQUIRED'};$kernel=@($libs|Sort-Object -Descending)[0]
  # These installed tool paths are passed directly to ProcessStartInfo/MSVC,
  # never CMD. The standard Program Files (x86) parentheses are safe here.
  foreach($path in @($compiler,$kernel)){if($path -cnotmatch '^[A-Za-z]:\\[A-Za-z0-9 ._()\\-]+$' -or $path.Contains('\..\')){throw 'PUBLIC_CLR_TOOL_PATH_REFUSED'}}
  $events=[IO.Path]::Combine($root,'public.events');$source=[IO.Path]::Combine($root,'public-profiler.c');$dll=[IO.Path]::Combine($root,'public-profiler.dll');$script=[IO.Path]::Combine($root,'public-script.ps1')
  # The only C interpolation is an already conservatively validated owned path.
  $cPath=$events.Replace('\','\\')
  $c=@'
typedef void *HANDLE;
__declspec(dllimport) HANDLE __stdcall CreateFileW(const unsigned short *,unsigned long,unsigned long,void *,unsigned long,unsigned long,HANDLE);
__declspec(dllimport) int __stdcall WriteFile(HANDLE,const void *,unsigned long,unsigned long *,void *);
__declspec(dllimport) int __stdcall CloseHandle(HANDLE);
static const char marker[]="PUBLIC_CLR_PROFILER\n";
__declspec(dllexport) long __stdcall DllGetClassObject(const void *clsid,const void *iid,void **object) {
 HANDLE file=CreateFileW(L"OWNED_MARKER_PATH",4,7,0,4,128,0);
 unsigned long written=0;
 if(file!=(HANDLE)-1){WriteFile(file,marker,sizeof(marker)-1,&written,0);CloseHandle(file);}
 if(object)*object=0;
 return (long)0x80040111;
}
'@
  [IO.File]::WriteAllText($source,$c.Replace('OWNED_MARKER_PATH',$cPath),[Text.Encoding]::ASCII)
  $publicScript=@'
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Environment]::Version.Major -ne 4 -or [IntPtr]::Size -ne 8){exit 31}
[IO.File]::AppendAllText([IO.Path]::Combine($PSScriptRoot,'public.events'),"PUBLIC_WINPS51_SCRIPT`n",[Text.Encoding]::ASCII)
exit 0
'@
  [IO.File]::WriteAllText($script,$publicScript,[Text.Encoding]::ASCII)
  if($productCase){
   $data=New-ClrProductFixtureData $windows $root ([IO.Path]::Combine($root,'release')) ('a'*64)
   foreach($directory in @($data.ownerLocalAppData,$data.releaseRoot,$data.startupStateDirectory,[IO.Path]::Combine($data.installRoot,'scripts'))){$null=[IO.Directory]::CreateDirectory($directory)}
   $retainedEntry=[IO.Path]::Combine($data.installRoot,'scripts\owner-code-rotation-native-1218.ps1')
   # Owned dummy bytes are DATA only. They neither import the private entry nor
   # call Owner/task/receipt/activation/configuration/native-grant functions.
   $dummy=@'
param([switch]$StartOnly)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if(-not $StartOnly -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Environment]::Version.Major -ne 4 -or [IntPtr]::Size -ne 8){exit 31}
if($script:ownerCutoverRetainedStartupEntryContext.sourceRevision -cne ('b'*40)){exit 32}
[IO.File]::AppendAllText('OWNED_PUBLIC_EVENT_PATH',"PUBLIC_WINPS51_SCRIPT`n",[Text.Encoding]::ASCII)
exit 0
'@
   $dummyBytes=[Text.Encoding]::ASCII.GetBytes($dummy.Replace('OWNED_PUBLIC_EVENT_PATH',$events));[IO.File]::WriteAllBytes($retainedEntry,$dummyBytes);$data.entrySha256=Get-ClrPublicDigest $dummyBytes
   $productCommand=New-OwnerCutoverCleanStartCommandData $data
   if($productCommand.execute -cne $fixedCmd -or $productCommand.workingDirectory -cne $data.releaseRoot -or $productCommand.effectCapability -ne $false){throw 'PUBLIC_CLR_PRODUCT_TUPLE_REJECTED'}
   $result.actualProductCompilerDataCompiled=$true;$result.compiledCommandSha256=Get-ClrPublicDigest ([Text.Encoding]::UTF8.GetBytes($productCommand.execute+"`n"+$productCommand.arguments+"`n"+$productCommand.workingDirectory))
  }
  $compileArgs='/nologo /LD /O1 /Zl /Fo"'+[IO.Path]::Combine($root,'public-profiler.obj')+'" "'+$source+'" /link /NOENTRY /NODEFAULTLIB /MACHINE:X64 /OUT:"'+$dll+'" "'+$kernel+'"'
  # CL/_CL_ may inject compiler flags. Clear them only on this owned compiler.
  $compiled=Invoke-ClrPublicOwnedProcess $compiler $compileArgs $root @{CL='';_CL_=''}
  if($compiled -ne 0 -or -not [IO.File]::Exists($dll)){throw 'PUBLIC_CLR_COMPILE_FAILED'}
  $cleanArguments=if($productCase){$null}else{New-ClrPublicCommand $fixedPS $modules $script}
  $caseAliases=if($productCase){@($false)}else{@($false,$true)}
  foreach($lowerCase in $caseAliases){
   $positive=$null;$clean=$null
   foreach($isClean in @($false,$true)){
    if([IO.File]::Exists($events)){[IO.File]::Delete($events)}
    $hooks=@{COR_ENABLE_PROFILING='1';COR_PROFILER='{7E9D36B6-2E77-4D2D-AE54-6C455C24DB83}';COR_PROFILER_PATH_64=$dll}
    if($lowerCase){$alias=@{};foreach($k in $hooks.Keys){$alias[$k.ToLowerInvariant()]=$hooks[$k]};$hooks=$alias}
    $image=if($isClean){$fixedCmd}else{$fixedPS};$arguments=if($isClean){$cleanArguments}else{'-NoLogo -NoProfile -NonInteractive -File "'+$script+'"'}
    if($productCase -and $isClean){
     # Execute every returned tuple field verbatim. Never patch the capsule or
     # replace its tail, and never execute the dummy as an independent grant.
     $code=Invoke-ClrPublicOwnedProcess $productCommand.execute $productCommand.arguments $productCommand.workingDirectory $hooks;$result.unmodifiedCommandExecuted=$true
    }else{$code=Invoke-ClrPublicOwnedProcess $image $arguments $root $hooks}
    $text=if([IO.File]::Exists($events)){[IO.File]::ReadAllText($events)}else{''};$nativeIndex=$text.IndexOf("PUBLIC_CLR_PROFILER`n",[StringComparison]::Ordinal);$scriptIndex=$text.IndexOf("PUBLIC_WINPS51_SCRIPT`n",[StringComparison]::Ordinal)
    $observation=@{profilerMarker=($nativeIndex -ge 0);scriptMarker=($scriptIndex -ge 0);profilerBeforeScript=($nativeIndex -ge 0 -and $scriptIndex -gt $nativeIndex);exitCode=$code}
    if($isClean){$clean=$observation}else{$positive=$observation}
    if($productCase -and -not $isClean){
     $result.positiveControl=$positive
     # Do not even execute/count the actual-compiler clean child unless its
     # corresponding public native pre-script positive really worked.
     if(-not $positive.profilerMarker){throw 'INCONCLUSIVE_POSITIVE_MARKER_MISSING'}
     if(-not $positive.scriptMarker){throw 'INCONCLUSIVE_POSITIVE_SCRIPT_MISSING'}
     if(-not $positive.profilerBeforeScript){throw 'INCONCLUSIVE_POSITIVE_ORDER'}
     if($positive.exitCode -ne 0){throw 'INCONCLUSIVE_POSITIVE_EXIT'}
    }
   }
   $verdict=Get-ClrPublicPairVerdict $positive $clean;$result.pairs+=@{aliasCase=$lowerCase;unclean=$positive;clean=$clean;verdict=$verdict}
   if($verdict -cne 'PASS'){throw $verdict}
  }
  if($productCase){
   [IO.File]::Delete($events);[IO.File]::WriteAllBytes($retainedEntry,($dummyBytes+[byte]10))
   # The SAME unmodified compiler output must now refuse before dummy execution.
   $code=Invoke-ClrPublicOwnedProcess $productCommand.execute $productCommand.arguments $productCommand.workingDirectory $hooks
   $text=if([IO.File]::Exists($events)){[IO.File]::ReadAllText($events)}else{''};$nativeIndex=$text.IndexOf("PUBLIC_CLR_PROFILER`n",[StringComparison]::Ordinal);$scriptIndex=$text.IndexOf("PUBLIC_WINPS51_SCRIPT`n",[StringComparison]::Ordinal)
   $result.tamperedEntry=@{profilerMarker=($nativeIndex -ge 0);scriptMarker=($scriptIndex -ge 0);profilerBeforeScript=($nativeIndex -ge 0 -and $scriptIndex -gt $nativeIndex);exitCode=$code}
   if($nativeIndex -ge 0 -or $scriptIndex -ge 0 -or $code -ne 1){throw 'PUBLIC_CLR_RETAINED_HASH_REFUSAL_MISSING'}
   $result.retainedHashRefusalObserved=$true;$result.actualProductCompilerLinked=$true
  }
  $result.status='PASS';$result.failureCode='NONE'
 }catch{
  $code=[string]$_.Exception.Message
  if($code -cnotmatch '^(PUBLIC_CLR_[A-Z0-9_]+|INCONCLUSIVE_POSITIVE_[A-Z0-9_]+|FAIL_CLEAN_[A-Z0-9_]+)$'){$code='PUBLIC_CLR_PROBE_FAILED'}
  $result.failureCode=$code;$result.status=if($code.StartsWith('FAIL_')){'FAIL'}else{'INCONCLUSIVE'}
 }finally{
  if($root -and [IO.Directory]::Exists($root)){try{[IO.Directory]::Delete($root,$true)}catch{$result.ownedArtifactsRemoved=$false;$result.status='FAIL';$result.failureCode='PUBLIC_CLR_OWNED_CLEANUP_FAILED'}}
  if(-not $result.ownedChildrenExited){$result.status='FAIL';$result.failureCode='PUBLIC_CLR_OWNED_CHILD_STILL_RUNNING'}
 }
 $result|ConvertTo-Json -Depth 6 -Compress;exit
}
. (Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-rotation-native-1218.ps1')
if(-not (Get-Command Get-OwnerRotationProfileSelection -ErrorAction SilentlyContinue)){throw 'CUTOVER_PROFILE_SELECTION_MISSING'}
$inputData=[Console]::In.ReadToEnd()|ConvertFrom-Json
function node {throw 'FORBIDDEN_PATH_NODE'}
function Get-OwnerLauncherKernelContext {throw 'FORBIDDEN_PRIVATE_KERNEL'}
function Get-OwnerRotationPublicResource {throw 'FORBIDDEN_PUBLIC_API'}
if($Scenario -in @('capsule','execution-boundary')){
 $workflow=[IO.File]::ReadAllText((Join-Path (Split-Path $PSScriptRoot) '.github/workflows/gai-zbook-diagnostic-1218.yml'))
 $step=[regex]::Match($workflow,'(?ms)^      - name: Select closed rotation profile before any PATH Node\n(?<step>.*?)(?=^      - )').Groups['step'].Value
 if(-not $step){throw 'CUTOVER_PROFILE_CAPSULE_MISSING'};$body=[regex]::Match($step,'(?m)^        run: \|\n(?<body>(?:          .*\n)+)').Groups['body'].Value;$code=($body -split '\n'|ForEach-Object {if($_.Length -ge 10){$_.Substring(10)}else{$_}})-join "`n"
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($code,[ref]$tokens,[ref]$errors);if($errors.Count -ne 0){throw 'WORKFLOW_CAPSULE_PARSE'};$resource=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-OwnerRotationSelectorPublicResource'},$true);if(-not $resource){throw 'RESOURCE_BOUNDARY_MISSING'};$program=$code.Remove($resource.Extent.StartOffset,$resource.Extent.EndOffset-$resource.Extent.StartOffset)
 $script:capsuleCalls=[Collections.Generic.List[string]]::new();$script:capsuleCase='';$script:capsuleEntry=[IO.File]::ReadAllBytes((Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-rotation-native-1218.ps1'))
 function Get-OwnerRotationSelectorPublicResource([string]$Uri){[void]$script:capsuleCalls.Add($Uri);if($script:capsuleCase -eq 'transport'){throw 'FAKE_TRANSPORT_PRIVATE_CANARY'};if($Uri -ceq 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main'){$sha=if($script:capsuleCase -eq 'main-mismatch'){'f'*40}else{'a'*40};return ,[Text.Encoding]::UTF8.GetBytes(('{"object":{"sha":"'+$sha+'"}}'))};if($Uri -ceq ('https://raw.githubusercontent.com/haji84/AI-/'+('a'*40)+'/scripts/owner-code-rotation-native-1218.ps1')){if($script:capsuleCase -eq 'source-mismatch'){return ,[Text.Encoding]::UTF8.GetBytes("throw 'UNTRUSTED_SOURCE_EXECUTED'")};return ,$script:capsuleEntry};throw 'UNEXPECTED_PUBLIC_URL'}
 $results=@();foreach($request in $inputData.requests){$root=[IO.Path]::Combine([IO.Path]::GetTempPath(),('cutover-public-capsule-'+[IO.Path]::GetRandomFileName()));$null=[IO.Directory]::CreateDirectory([IO.Path]::Combine($root,'owner-native-12345678-1','scripts'));$local=[IO.Path]::Combine($root,'owner-native-12345678-1','scripts','owner-code-rotation-native-1218.ps1');[IO.File]::WriteAllBytes($local,$script:capsuleEntry);$script:capsuleCase=$request.case;$script:capsuleCalls.Clear();foreach($property in $request.environment.PSObject.Properties){[Environment]::SetEnvironmentVariable($property.Name,[string]$property.Value)};$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64=$request.encoded;$env:GITHUB_WORKSPACE=$root;$env:GITHUB_OUTPUT=[IO.Path]::Combine($root,'profile-output');$env:JARVIS_PRODUCTION_CONFIG=''
  if($request.case -eq 'local-tamper'){[IO.File]::WriteAllText($local,"throw 'UNTRUSTED_SOURCE_EXECUTED'")}
  try{& ([scriptblock]::Create($program));$output=[IO.File]::ReadAllText($env:GITHUB_OUTPUT)
  if($Scenario -eq 'execution-boundary'){
   $env:GORIQ_OWNER_ROTATION_PROFILE='CUTOVER_V1';$env:GORIQ_C1_PROBE_MARKER=[IO.Path]::Combine($root,'owned-marker');$mutation='[IO.File]::WriteAllText($env:GORIQ_C1_PROBE_MARKER,"PUBLIC_UNVERIFIED_ENTRY_EXECUTED"); exit 0'
   if($request.case -eq 'post-selector'){[IO.File]::WriteAllText($local,$mutation)}
   $rotation=[regex]::Match($workflow,'(?ms)^      - name: Run separately approved bounded native rotation entry\n(?<step>.*?)(?=^      - )').Groups['step'].Value;$rotationBody=[regex]::Match($rotation,'(?m)^        run: \|\n(?<body>(?:          .*\n)+)').Groups['body'].Value;$programChild=($rotationBody -split '\n'|ForEach-Object {if($_.Length -ge 10){$_.Substring(10)}else{$_}})-join "`n"
   $t=$null;$err=$null;$tree=[Management.Automation.Language.Parser]::ParseInput($programChild,[ref]$t,[ref]$err);if($err.Count -ne 0){throw 'ROTATION_BODY_PARSE'};$fetchFunction=$tree.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-OwnerRotationSelectorPublicResource'},$true);if($fetchFunction){$programChild=$programChild.Remove($fetchFunction.Extent.StartOffset,$fetchFunction.Extent.EndOffset-$fetchFunction.Extent.StartOffset)}
   $boundary='. ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($entryBytes)))';$boundaryFound=$programChild.Contains($boundary)
   if($request.case -eq 'post-final-verification' -and $boundaryFound){$programChild=$programChild.Replace($boundary,('[IO.File]::WriteAllText($localEntry,'+"'"+$mutation.Replace("'","''")+"'"+");`n"+$boundary))}
   # Substitute only the unavailable Windows child image on Linux; retain the actual body/arguments.
   $shell=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;if([IO.Path]::DirectorySeparatorChar -ne [char]92){$programChild=$programChild.Replace("'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'",("'"+$shell.Replace("'","''")+"'"))}
   $fake='function Get-OwnerRotationSelectorPublicResource {'+(Get-Item Function:Get-OwnerRotationSelectorPublicResource).Definition+'}'
   $prefix="`$ErrorActionPreference='Stop'`n"+'$script:capsuleCalls=[Collections.Generic.List[string]]::new();$script:capsuleCase="";$script:capsuleEntry=[Convert]::FromBase64String("'+[Convert]::ToBase64String($script:capsuleEntry)+'");'+"`n"+$fake+"`n"
   $programChild=$programChild.Replace('$bootstrap = Invoke-OwnerCutoverBootstrap',"function Get-OwnerCutoverPublicReadiness {throw 'ROTATION_CUTOVER_BOOTSTRAP_INCOMPLETE'}`n"+'$bootstrap = Invoke-OwnerCutoverBootstrap')
   $scriptPath=[IO.Path]::Combine($root,'actual-rotation-wrapper.ps1');[IO.File]::WriteAllText($scriptPath,$prefix+$programChild,[Text.UTF8Encoding]::new($false));$info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$shell;$info.Arguments='-NoLogo -NoProfile -NonInteractive -File "'+$scriptPath+'"';$info.WorkingDirectory=if($request.case -eq 'wrong-cwd'){$root}else{[IO.Path]::Combine($root,'owner-native-12345678-1')};$info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$child=[Diagnostics.Process]::new();$child.StartInfo=$info
   try{if(-not $child.Start()){throw 'OWNED_CHILD_START'};$out=$child.StandardOutput.ReadToEndAsync();$errors=$child.StandardError.ReadToEndAsync();if(-not $child.WaitForExit(10000)){$child.Kill();[void]$child.WaitForExit(2000);throw 'OWNED_CHILD_TIMEOUT'};$stdout=$out.Result;$stderr=$errors.Result;$value=$null;try{$value=$stdout|ConvertFrom-Json}catch{};$results+=@{accepted=$true;selectorOutput=$output;modifiedCheckoutExecuted=[IO.File]::Exists($env:GORIQ_C1_PROBE_MARKER);processExit=$child.ExitCode;stdoutValue=$value;stderrPresent=($stderr.Length -gt 0);heldBytesBoundaryFound=$boundaryFound;ownedChildExited=$child.HasExited;actualApiNativeCalls=0}}finally{$child.Dispose()}
  }else{$results+=@{accepted=$true;output=$output;calls=@($script:capsuleCalls)}}}catch{$results+=@{accepted=$false;output='';calls=@($script:capsuleCalls);errorText=[string]$_.Exception.Message}}finally{[IO.Directory]::Delete($root,$true)}
 }
 @{rows=$results;actualApiNativeCalls=0}|ConvertTo-Json -Depth 8 -Compress;exit
}
$rows=@();foreach($request in $inputData.requests){try{$value=Get-OwnerRotationProfileSelection -Encoded $request.encoded -Environment $request.environment -Now ([datetimeoffset]::Parse($request.now));$rows+=@{accepted=$true;value=$value}}catch{$rows+=@{accepted=$false;code='ROTATION_ENTRY_PROFILE_REFUSED'}}}
@{rows=$rows;actualApiNativeCalls=0}|ConvertTo-Json -Depth 8 -Compress
