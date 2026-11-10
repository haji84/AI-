param([ValidateSet('matrix','native-variant','preloaded-type','clock-boundary','journal-boundary','xml-boundary','clock-kernel-expiry','readonly-com-transport','guarded-c3','guarded-c3-boundaries','guarded-c3-boundaries-0','guarded-c3-boundaries-1','guarded-c3-boundaries-2','guarded-c3-boundaries-3','guarded-c3-protocol','guarded-c3-http','validator-default-environment','guarded-c3-restoration-reporting','guarded-c3-fractional-clock')][string]$Scenario='matrix')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$c3BoundaryPart=$null
switch -CaseSensitive ($Scenario){'guarded-c3-boundaries-0'{$c3BoundaryPart=0};'guarded-c3-boundaries-1'{$c3BoundaryPart=1};'guarded-c3-boundaries-2'{$c3BoundaryPart=2};'guarded-c3-boundaries-3'{$c3BoundaryPart=3}}
if($Scenario -like 'guarded-c3-boundaries-*' -and $null -eq $c3BoundaryPart){throw 'PUBLIC_C3_PARTITION_SCENARIO_REQUIRED'}
if($null -ne $c3BoundaryPart){$Scenario='guarded-c3-boundaries'}
if($Scenario -eq 'readonly-com-transport'){
 # Fresh process, actual unchanged helper binding, no fixture types/providers.
 # Root-folder reads only: never GetTask/enumeration/registration/task effects.
 $helper=Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-production-cutover-1218.ps1'
 $value=@{scope='PUBLIC_READONLY_COM_TRANSPORT_ONLY';actualWindowsExecuted=$false;status='INCONCLUSIVE';phase='PLATFORM_REQUIRED';hresult='0';ownedServiceCreated=$false;connectReturned=$false;rootReturned=$false;fixedRootNameVerified=$false;fixedRootPathVerified=$false;ownedObjectsReleased=$false;realTaskCredentialCalls=0;nativeGrant=$false};$service=$null;$root=$null
 $value.phase='SOURCE_READ'
 try{$sha=[Security.Cryptography.SHA256]::Create();try{$value.helperSourceSha256=([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($helper)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
 catch{$exception=$_.Exception;while($exception.InnerException){$exception=$exception.InnerException};$value.hresult=([int]$exception.HResult).ToString([Globalization.CultureInfo]::InvariantCulture);$value|ConvertTo-Json -Compress;exit}
 $value.phase='PLATFORM_REQUIRED'
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){$value.status='NOT_RUN';$value|ConvertTo-Json -Compress;exit}
 $value.actualWindowsExecuted=$true
 try{
  $value.phase='IMPORT_HELPER';. $helper
  $value.phase='INITIALIZE_BINDING';Initialize-OwnerProductionTaskUpdateBinding
  $value.phase='NEW_SERVICE';$service=New-OwnerProductionTaskService;$value.ownedServiceCreated=[Runtime.InteropServices.Marshal]::IsComObject($service);if(-not $value.ownedServiceCreated){throw 'READONLY_COM_SERVICE_REQUIRED'}
  $value.phase='CONNECT';[OwnerProductionTaskUpdateBinding]::Connect($service);$value.connectReturned=$true
  $value.phase='ROOT';$root=[OwnerProductionTaskUpdateBinding]::Root($service);$value.rootReturned=($null -ne $root -and [Runtime.InteropServices.Marshal]::IsComObject($root));if(-not $value.rootReturned){throw 'READONLY_COM_ROOT_REQUIRED'}
  $value.phase='ROOT_PROPERTIES';$name=$root.Name;$path=$root.Path;$value.fixedRootNameVerified=($name -is [string] -and $name.Length -le 8 -and $name -ceq '\');$value.fixedRootPathVerified=($path -is [string] -and $path.Length -le 8 -and $path -ceq '\');if(-not $value.fixedRootNameVerified -or -not $value.fixedRootPathVerified){throw 'READONLY_COM_FIXED_ROOT_REQUIRED'}
  $value.status='PASS'
 }catch{$exception=$_.Exception;while($exception.InnerException){$exception=$exception.InnerException};$value.hresult=([int]$exception.HResult).ToString([Globalization.CultureInfo]::InvariantCulture)}
 finally{
  try{if($root -or $service){Close-OwnerProductionHandles @($root,$service)};$value.ownedObjectsReleased=$true}catch{$value.status='INCONCLUSIVE';$value.phase='RELEASE';$exception=$_.Exception;while($exception.InnerException){$exception=$exception.InnerException};$value.hresult=([int]$exception.HResult).ToString([Globalization.CultureInfo]::InvariantCulture)}
  $root=$null;$service=$null;$name=$null;$path=$null
 }
 if($value.status -ceq 'PASS'){$value.phase='COMPLETE'}
 $value|ConvertTo-Json -Compress;exit
}
if($Scenario -eq 'validator-default-environment'){
 $helper=Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-production-cutover-1218.ps1';. $helper
 $env:NODE_OPTIONS='--require=PUBLIC_OWNED_PRELOAD_CANARY';$env:NODE_PATH='PUBLIC_OWNED_MODULE_CANARY';$env:OPENSSL_CONF='PUBLIC_OWNED_CONF_CANARY'
 $data=[pscustomobject]@{nodePath='C:\public-node\node.exe';controllerRoot='C:\public-source';configuration=@{releaseRoot='C:\public-runtime';stateRoot='C:\Owner\JARVIS\production'}};$p=New-OwnerProductionExerciseValidatorLeaf $data
 try{$e=$p.StartInfo.EnvironmentVariables;$absent=(-not $e.ContainsKey('NODE_OPTIONS') -and -not $e.ContainsKey('NODE_PATH') -and -not $e.ContainsKey('OPENSSL_CONF'));@{pass=($absent -and $e.Count -eq 0);startupControlsAbsent=$absent;environmentKeys=$e.Count;started=$false;nativeGrant=$false}|ConvertTo-Json -Compress}finally{$p.Dispose()};exit
}
function Require([bool]$Condition,[string]$Code){if(-not $Condition){throw ('PRODUCTION_FIXTURE_'+$Code)}}
function Digest([string]$Value){$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function ComSnapshotHash([string]$Xml,[string]$Security){
 $stream=[IO.MemoryStream]::new();$writer=[IO.BinaryWriter]::new($stream,[Text.UTF8Encoding]::new($false,$true));$h=[Security.Cryptography.SHA256]::Create()
 try{foreach($part in @('GORIQ:1218:task-com-snapshot:v1','\','JARVIS Remote Host',$Xml,$Security)){if($null -eq $part){throw 'MISSING_COM_PART'};$b=[Text.UTF8Encoding]::new($false,$true).GetBytes($part);$writer.Write([uint32]$b.Length);$writer.Write($b)};$writer.Flush();return ([BitConverter]::ToString($h.ComputeHash($stream.ToArray()))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose();$writer.Dispose();$stream.Dispose()}
}
Add-Type @'
using System;using System.Collections;using System.Security;
public static class OwnerProductionFixtureTrace {public static int Enumerations,Counts,Items,Contexts;public static void Clear(){Enumerations=Counts=Items=Contexts=0;}}
public class OwnerProductionFixtureExec {public string Path,Arguments,WorkingDirectory,Id="KEEP_EXEC_ID";public int Type=0;public OwnerProductionFixtureExec(string p,string a,string d){Path=p;Arguments=a;WorkingDirectory=d;}}
public class OwnerProductionFixtureActions:IEnumerable {
 public OwnerProductionFixtureExec[] Values;public string StoredContext="KEEP_CONTEXT";
 public OwnerProductionFixtureActions(int n,string p,string a,string d){Values=new OwnerProductionFixtureExec[n];for(int i=0;i<n;i++)Values[i]=new OwnerProductionFixtureExec(p,a,d);}
 public int Count {get{OwnerProductionFixtureTrace.Counts++;return Values.Length;}}
 public string Context {get{OwnerProductionFixtureTrace.Contexts++;return StoredContext;}}
 public object Item(int i){OwnerProductionFixtureTrace.Items++;return Values[i-1];}
 public IEnumerator GetEnumerator(){OwnerProductionFixtureTrace.Enumerations++;return Values.GetEnumerator();}
}
public class OwnerProductionFixturePrincipal {public string UserId;public int LogonType=1,RunLevel=0;}
public class OwnerProductionFixtureDefinition {
 public OwnerProductionFixturePrincipal Principal=new OwnerProductionFixturePrincipal();public OwnerProductionFixtureActions Actions;public bool Tamper;public string OriginalPath;public string CoherenceMode="";public bool CoherenceTargetOnly=true;
 public OwnerProductionFixtureDefinition(string sid,int n,string p,string a,string d){Principal.UserId=sid;OriginalPath=p;Actions=new OwnerProductionFixtureActions(n,p,a,d);}
 public string XmlText {get{
 string s="<Task xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\"><Principals><Principal><UserId>"+SecurityElement.Escape(Principal.UserId)+"</UserId><LogonType>Password</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><Description>"+(Tamper&&Actions.Values.Length>0&&Actions.Values[0].Path!=OriginalPath?"CHANGED_SETTING":"KEEP_SETTING")+"</Description></Settings><Actions Context=\""+SecurityElement.Escape(Actions.StoredContext)+"\">";
 foreach(OwnerProductionFixtureExec e in Actions.Values)s+="<Exec id=\""+SecurityElement.Escape(e.Id)+"\"><Command>"+SecurityElement.Escape(e.Path)+"</Command><Arguments>"+SecurityElement.Escape(e.Arguments)+"</Arguments><WorkingDirectory>"+SecurityElement.Escape(e.WorkingDirectory)+"</WorkingDirectory></Exec>";
 s+="</Actions></Task>";
 if(CoherenceMode!=""&&Actions.Values.Length>0&&(!CoherenceTargetOnly||Actions.Values[0].Path=="C:\\public-node\\node.exe")){
  if(CoherenceMode=="command")s=s.Replace("<Command>","<Command>WRONG_");
  if(CoherenceMode=="arguments")s=s.Replace("<Arguments>","<Arguments>WRONG_");
  if(CoherenceMode=="directory")s=s.Replace("<WorkingDirectory>","<WorkingDirectory>WRONG_");
  if(CoherenceMode=="id")s=s.Replace("id=\"KEEP_EXEC_ID\"","id=\"WRONG_ID\"");
  if(CoherenceMode=="context")s=s.Replace("Context=\"KEEP_CONTEXT\"","Context=\"WRONG_CONTEXT\"");
  if(CoherenceMode=="attribute")s=s.Replace("<Command>","<Command unexpected=\"true\">");
  if(CoherenceMode=="nested")s=s.Replace("<Command>","<Command><Injected />");
  if(CoherenceMode=="duplicate")s=s.Replace("</Command>","</Command><Command>EXTRA</Command>");
  if(CoherenceMode=="namespace")s=s.Replace("<Command>","<Command xmlns=\"urn:wrong\">");
 }
 return s;
 }}
}
public class OwnerProductionFixtureService {public object Folder;public void Connect(){}public object GetFolder(string path){if(path!="\\")throw new Exception("WRONG_ROOT");return Folder;}}
public delegate object OwnerProductionFixtureRegisterCallback(object[] values);
public class OwnerProductionFixtureFolder {public Func<string,object> Lookup;public OwnerProductionFixtureRegisterCallback Register;public object GetTask(string name){return Lookup(name);}public object RegisterTaskDefinition(string name,object definition,int flags,object user,object password,int logon,object sddl){return Register(new object[]{name,definition,flags,user,password,logon,sddl});}}
'@ | Out-Null
$helper=Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-production-cutover-1218.ps1'
# CLR fakes compile before this missing-feature refusal; no real TaskService exists.
if(-not [IO.File]::Exists($helper)){throw 'PRODUCTION_HELPER_NOT_IMPLEMENTED'}
. $helper
if($Scenario -like 'guarded-c3*' -and -not (Get-Command Invoke-OwnerProductionGuardedExercise -ErrorAction SilentlyContinue)){throw 'GUARDED_C3_NOT_IMPLEMENTED'}
if($Scenario -eq 'preloaded-type'){Add-Type 'public class OwnerProductionTaskUpdateBinding { public static int UntrustedMarker() { return 7; } }'|Out-Null;$refused=$false;try{Initialize-OwnerProductionTaskUpdateBinding}catch{$refused=$true};Require $refused 'UNEXPECTED_TYPE_REFUSED';@{scenario=$Scenario;pass=$true;realTaskCredentialCalls=0}|ConvertTo-Json -Compress;exit}
$script:issuer=[Collections.Generic.List[object]]::new()
$script:current=$null
$script:token=$null
function New-FakeDefinition {
 $s=$script:current;$d=[OwnerProductionFixtureDefinition]::new($s.sid,$s.count,$s.stored.execute,$s.stored.arguments,$s.stored.workingDirectory);$d.Principal.LogonType=$s.logon;$d.Principal.RunLevel=$s.level;$d.Actions.StoredContext=$s.context
 if($s.count -gt 0){$d.Actions.Values[0].Id=$s.id;$d.Actions.Values[0].Type=$s.type};$d.Tamper=$s.tamper;if($s.xmlStage -ne 'after' -or $s.registrations -gt 0){$d.CoherenceMode=$s.xmlMode;$d.CoherenceTargetOnly=($s.xmlStage -ne 'before')};return $d
}
function New-FakeRegistered {
 $r=[pscustomobject]@{Path=$script:current.path};$r|Add-Member ScriptProperty Definition {New-FakeDefinition};$r|Add-Member ScriptMethod GetSecurityDescriptor {param($bits)Require ($bits -eq 7) 'SECURITY_BITS';return $script:current.security};return $r
}
$folder=[OwnerProductionFixtureFolder]::new()
$folder.Lookup=[System.Func[System.String,System.Object]]{param($name)Require ($name -ceq 'JARVIS Remote Host') 'LITERAL_TASK';$script:current.lookups++;if($script:current.raceAt -eq $script:current.lookups){$script:current.context='RACED_CONTEXT'};New-FakeRegistered}
$folder.Register=[OwnerProductionFixtureRegisterCallback]{param($v)
 Require ($script:current.journals -eq 1) 'JOURNAL_BEFORE_REGISTRATION';$script:current.registrations++;$script:current.vector=$v
 if($script:current.throw -eq 'old'){throw [Runtime.InteropServices.COMException]::new('fixture-private-error',-2147024891)}
 $a=$v[1].Actions.Item(1);$script:current.stored=@{execute=$a.Path;arguments=$a.Arguments;workingDirectory=$a.WorkingDirectory};$script:current.id=$a.Id;$script:current.context=$v[1].Actions.Context
 if($script:current.postSecurity){$script:current.security='CHANGED_SECURITY'};if($script:current.postContext){$script:current.context='CHANGED_CONTEXT'}
 if($script:current.throw -eq 'new'){throw [Runtime.InteropServices.COMException]::new('fixture-private-error',-2147024891)}
 if($script:current.late){$script:current.expired=$true};New-FakeRegistered
}
$script:service=[OwnerProductionFixtureService]::new();$script:service.Folder=$folder
function New-OwnerProductionTaskService {$script:current.services++;if($script:current.expired){$script:current.servicesAfterExpiry++};return $script:service}
function Get-OwnerProductionKernelObservation {$script:current.kernelReads++;if($script:current.kernelReads -eq $script:current.kernelExpireAt){$script:current.expired=$true};return [pscustomobject]@{ownerSid=$script:current.kernelSid;sessionId=$script:current.session;processId=$PID}}
function Get-OwnerProductionClockState($Identity){if($null -ne $script:current.clockOverride){return $script:current.clockOverride};Require ([object]::ReferenceEquals($Identity,$script:current.clock)) 'CLOCK_IDENTITY';if($script:current.expired){throw 'ROTATION_CUTOVER_SCOPE_EXPIRED'};return [pscustomobject]@{remainingForwardSeconds=600;remainingHardSeconds=720;hardEndUtc='2026-11-06T20:00:00.000Z'}}
$script:receiptIssuer=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()
function Resolve-OwnerProductionTaskWriteahead($Receipt){$row=$null;if($null -ne $Receipt -and $script:receiptIssuer.TryGetValue($Receipt,[ref]$row)){return $row};throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
function New-OwnerProductionTaskWriteahead($Identity,$Snapshot,$Target){Require ([object]::ReferenceEquals($Identity,$script:current.journal)) 'JOURNAL_IDENTITY';if($script:current.journalFailure){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'};$script:current.journals++;if($script:current.journalAfterThrow){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'};Require ($script:current.journals -eq 1) 'ONE_WRITEAHEAD';$receipt=[object]::new();$row=@{receiptIdentity=$receipt;journalIdentity=$Identity;attemptIdentity=$script:current.attempt;originalClockIdentity=$script:current.clock;admissionFingerprint=(Get-OwnerProductionAdmissionFingerprint (Resolve-OwnerProductionNativeAdmission $script:token))};if($script:current.receiptMismatch -eq 'journal'){$row.journalIdentity=[object]::new()};if($script:current.receiptMismatch -eq 'attempt'){$row.attemptIdentity=[object]::new()};if($script:current.receiptMismatch -eq 'clock'){$row.originalClockIdentity=[object]::new()};if($script:current.receiptMismatch -eq 'fingerprint'){$row.admissionFingerprint='0'*64};$script:receiptIssuer.Add($receipt,$row);if($script:current.receiptOverrideEnabled){return ,$script:current.receiptOverride};return $receipt}
function Start-ScheduledTask {throw 'FORBIDDEN_START'}
function Stop-ScheduledTask {throw 'FORBIDDEN_STOP'}
function Set-ScheduledTask {throw 'FORBIDDEN_CIM_UPDATE'}
function Register-ScheduledTask {throw 'FORBIDDEN_REGISTER_CMDLET'}
function Unregister-ScheduledTask {throw 'FORBIDDEN_REMOVE_TASK'}
function New-LocalUser {throw 'FORBIDDEN_ACCOUNT'}
function Set-LocalUser {throw 'FORBIDDEN_ACCOUNT'}
function Remove-LocalUser {throw 'FORBIDDEN_ACCOUNT'}
function Setup([int]$Index) {
 $script:current=@{sid='S-1-5-21-111-222-333-444';kernelSid='S-1-5-21-111-222-333-444';session=1;count=1;logon=1;level=0;type=0;path='\JARVIS Remote Host';id='KEEP_EXEC_ID';context='KEEP_CONTEXT';security='PUBLIC_FIXED_SECURITY';stored=@{execute='C:\public-legacy\powershell.exe';arguments='-File "C:\public-legacy\launch.ps1"';workingDirectory='C:\public-runtime'};target=@{execute='C:\public-node\node.exe';arguments='"C:\public-runtime\scripts\jarvis-remote-host.mjs"';workingDirectory='C:\public-runtime';nodeSha256=('d'*64);hostSha256=('e'*64)};registrations=0;journals=0;services=0;lookups=0;vector=$null;tamper=$false;raceAt=-1;throw='';late=$false;expired=$false;journalFailure=$false;journalAfterThrow=$false;postSecurity=$false;postContext=$false;revoked=$false;clock=[object]::new();journal=[object]::new();attempt=[object]::new();clockOverride=$null;receiptOverrideEnabled=$false;receiptOverride=$null;receiptMismatch='';xmlMode='';xmlStage='working';kernelReads=0;kernelExpireAt=-1;servicesAfterExpiry=0}
 $s=$script:current;$rawXml=(New-FakeDefinition).XmlText;$comHash=ComSnapshotHash $rawXml $s.security;$xml=[xml]$rawXml;$full=Digest $rawXml;$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');foreach($name in @('Command','Arguments','WorkingDirectory')){$xml.SelectSingleNode(('/t:Task/t:Actions/t:Exec/t:'+$name),$ns).InnerText=''}
 $original=@{comSnapshotProfile='goriq-fixed-owner-task-com-snapshot-v1';expectedComSnapshotSha256=$comHash;definitionSha256=$full;envelopeSha256=(Digest $xml.OuterXml);securitySha256=(Digest $s.security);actionId=$s.id;actionsContext=$s.context}
 $record=@{profile='jarvis-owner-production-cutover-v1';sourceRevision=('a'*40);sourceClosureSha256=('b'*64);originalGrantSha256=('c'*64);attemptId=('00000000-0000-4000-8000-'+$Index.ToString('D12'));ownerSid=$s.sid;sessionId=1;processId=$PID;attemptIdentity=$s.attempt;originalTask=$original;target=$s.target;proofEvidenceIdentity=[object]::new();originalClockIdentity=$s.clock;journalIdentity=$s.journal;recoveryWitnessIdentity=[object]::new();preservationSessionIdentity=[object]::new()}
 $script:token=[object]::new();[void]$script:issuer.Add(@{token=$script:token;record=$record});[OwnerProductionFixtureTrace]::Clear();return $record
}
function Closed($Result){Require ($Result.PSObject.Properties.Name.Count -eq 6) 'CLOSED_RESULT';Require ($Result.schemaVersion -eq 1 -and $Result.migrationVerified -is [bool] -and $Result.registrationAttempted -is [bool]) 'RESULT_TYPES';Require ($Result.callState -cin @('NOT_ENTERED','RETURNED','THREW') -and $Result.observedState -cin @('UNKNOWN','OLD_LEGACY','KNOWN_TARGET','DIVERGED')) 'RESULT_ENUMS';Require (($Result|ConvertTo-Json -Depth 5 -Compress) -notmatch 'fixture-private|C:\\|S-1-5-21') 'NO_RAW_VALUES'}
function Refused([scriptblock]$Call){$caught=$false;try{& $Call|Out-Null}catch{$caught=$true};Require $caught 'EXPECTED_REFUSAL'}
# Default actual native admission must refuse; fake issuer is installed only below.
$null=Setup 1;Refused {Get-OwnerProductionTaskBinding -Admission ([pscustomobject]@{proofPassed=$true;sourceVerified=$true})};Require ($script:current.services -eq 0) 'UNWIRED_NO_COM'
function Resolve-OwnerProductionNativeAdmission($Admission) {
 if($script:current.revoked){throw 'ROTATION_CUTOVER_SOURCE_REQUIRED'}
 foreach($row in $script:issuer){if([object]::ReferenceEquals($Admission,$row.token)){return $row.record}}
 throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'
}
function Vector($Values){Require ($Values.Count -eq 7 -and $Values[0] -ceq 'JARVIS Remote Host' -and $Values[2] -eq 52 -and $null -eq $Values[3] -and $null -eq $Values[4] -and $Values[5] -eq 0 -and $null -eq $Values[6]) 'EXACT_VECTOR'}

if($Scenario -like 'guarded-c3*'){
 $unwiredC3=Invoke-OwnerProductionGuardedExercise -Admission ([object]::new());Require (-not $unwiredC3.complete -and $script:current.registrations -eq 0) 'C3_UNWIRED_DEFAULT_REFUSED'
 $parameters=@((Get-Command Invoke-OwnerProductionGuardedExercise).Parameters.Keys);Require ($parameters.Count -eq 1 -and $parameters[0] -ceq 'Admission') 'C3_ADMISSION_ONLY_ENTRY'
 $script:c3ActualValidatorConstructor=(Get-Command New-OwnerProductionExerciseValidatorLeaf).ScriptBlock
 $script:c3=$null;$script:memory=$null;$script:c3Index=$(switch($Scenario){'guarded-c3-protocol'{9000};'guarded-c3-boundaries'{12000};'guarded-c3-http'{15000};default{18000}});$script:c3ContextSeen=[Collections.Generic.HashSet[object]]::new();$script:c3AttemptSeen=[Collections.Generic.HashSet[object]]::new()
 function C3-Touch([string]$Name){
  if($script:c3.expired){$script:c3.afterExpiry++;throw 'PRIVATE_C3_LATE_IO'}
  [void]$script:c3.trace.Add($Name)
  if($script:c3.expireBefore -ceq $Name){$script:c3.hard=0;$script:c3.forward=0;$script:c3.expired=$true;throw 'PRIVATE_C3_EXPIRED_BEFORE'}
  if($script:c3.throwLeaf -ceq $Name){throw 'PRIVATE_C3_LEAF_ERROR'}
 }
 function C3-After([string]$Name){if($script:c3.expireAfter -ceq $Name){$script:c3.hard=0;$script:c3.forward=0;$script:c3.expired=$true}}
 function Get-OwnerProductionClockState($Identity){
  Require ([object]::ReferenceEquals($Identity,$script:current.clock)) 'C3_ORIGINAL_CLOCK'
  if(-not $script:c3){return [pscustomobject]@{remainingForwardSeconds=600;remainingHardSeconds=720;hardEndUtc='2026-11-06T20:00:00.000Z'}}
  $script:c3.clockReads++;$m=$null;if($script:c3.cutBoundary -or $script:c3.traceFrames){$m=$memory}
  if($m -is [Collections.IDictionary] -and $m.Contains('outcome') -and $m.Contains('boundary')){[void]$script:c3.seen.Add([string]$m.boundary);if($script:c3.cutBoundary -ceq $m.boundary -and (($script:c3.cutWhen -ceq 'pre' -and $m.outcome -ceq 'NOT_ENTERED') -or ($script:c3.cutWhen -ceq 'post' -and $m.outcome -cin @('RETURNED','THREW_UNKNOWN')))){$script:c3.cutSeen=$true;$script:c3.hard=0;$script:c3.forward=0;$script:c3.expired=$true}}
  return [pscustomobject]@{remainingForwardSeconds=$script:c3.forward;remainingHardSeconds=$script:c3.hard;hardEndUtc='2026-11-06T20:00:00.000Z'}
 }
 function Resolve-OwnerProductionExerciseContext($Admission){
  C3-Touch 'context-resolve';if(-not [object]::ReferenceEquals($Admission,$script:token) -and -not $script:c3.allowRemint){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
  $script:c3.resolves++;if($script:c3.copyContext -and $script:c3.resolves -gt 1){return [pscustomobject]$script:c3.context.PSObject.Copy()};return $script:c3.context
 }
 function Assert-OwnerProductionExerciseWitnesses($Identity,$Phase){
  C3-Touch 'witnesses';Require ([object]::ReferenceEquals($Identity,$script:c3.context.contextIdentity)) 'C3_CONTEXT_REFERENCE';Require ($Phase -cin @('FORWARD','RECOVERY')) 'C3_PHASE';if($Phase -ceq 'RECOVERY'){$script:c3.recoveryWitnesses++}
  if($script:c3.sourceDrift -or $script:c3.peerLost -or -not $script:c3.automation -or $script:c3.taskDrift){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
  Require ($script:current.registrations -eq 1 -and $script:current.stored.execute -ceq $script:c3.target.execute) 'C3_NO_SECOND_MIGRATION'
  $state=$null;if($script:OwnerProductionHelperState.exerciseContexts.TryGetValue($Identity,[ref]$state)){
   $actual=$script:c3.files[$script:c3.context.configuration.configPath]
   if($state.forwardReplaceEntered -and $actual.identityKey -cne $state.original.identityKey -and $actual.identityKey -ceq $state.candidateIdentity){$script:c3.candidateIdentityObserved=$true}
   if($actual.sha256 -cne $state.original.sha256 -and $actual.sha256 -cne $state.candidateHash){throw 'ROTATION_CUTOVER_EXERCISE_CONFIGURATION_CHANGED'}
  }
 }
 function New-OwnerProductionExerciseWriteahead($Identity,$Operation){
  C3-Touch 'journal-reserve';Require ([object]::ReferenceEquals($Identity,$script:c3.context.contextIdentity) -and $Operation -cin $script:OwnerProductionExerciseOperations) 'C3_CLOSED_OPERATION'
  if($script:c3.rows.ContainsKey($Operation)){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
  $receipt=[object]::new();$row=@{receipt=$receipt;context=$Identity;attempt=$script:c3.context.attemptIdentity;journal=$script:c3.context.journalIdentity;clock=$script:c3.context.originalClockIdentity;operation=$Operation;outcome='RESERVED'};$script:c3.rows[$Operation]=$row;$script:c3.receipts.Add($receipt,$row)
  if($script:c3.ambiguousJournal){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'};if($script:c3.foreignReceipt){return [object]::new()};return $receipt
 }
 function Set-OwnerProductionExerciseEffectOutcome($Receipt,$Outcome){
  C3-Touch 'journal-outcome';Require ($Outcome -cin @('ENTERED','RETURNED','THREW_UNKNOWN')) 'C3_OUTCOME_ENUM';$row=$null
  if(-not $script:c3.receipts.TryGetValue($Receipt,[ref]$row)){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
  foreach($pair in @(@($row.receipt,$Receipt),@($row.context,$script:c3.context.contextIdentity),@($row.attempt,$script:c3.context.attemptIdentity),@($row.journal,$script:c3.context.journalIdentity),@($row.clock,$script:c3.context.originalClockIdentity))){Require ([object]::ReferenceEquals($pair[0],$pair[1])) 'C3_RECEIPT_PROVENANCE'}
  if($Outcome -ceq 'ENTERED' -and $script:c3.booleanEntered){return $true}
  if($Outcome -cne 'ENTERED' -and $script:c3.outcomeRefusal -and $row.operation -ceq 'FORWARD_REPLACE'){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
  Require ($script:c3.hard -gt 0 -and $row.operation -cin $script:OwnerProductionExerciseOperations) 'C3_NO_LATE_JOURNAL';$row.outcome=$Outcome
 }
 function Invoke-OwnerProductionExerciseCheckpoint($Identity,$Event){
  C3-Touch ('checkpoint-'+$Event);Require ([object]::ReferenceEquals($Identity,$script:c3.context.contextIdentity) -and $Event -cin @('before-rotation','before-commit','after-rollback','before-planned-restore','after-planned-restore')) 'C3_SAME_HELD38';[void]$script:c3.events.Add($Event)
  $v=@{status='PASS';pcSidecars=@{status='PASS'};reasonCodes=@()};foreach($key in @('databaseBindingMatched','cohortAuthorityVerified','baselineCohortPreserved','fleetMetadataPreserved','identitiesPreserved','keysPreserved','workerLifecycleHistoryPreserved','auditRetainedHistoryPreserved','taskPayloadsPreserved','nonceProtectionPreserved')){$v[$key]=$true};if($script:c3.sidecarDrift -or ($script:c3.restoredCheckpointFailure -and $Event -ceq 'after-planned-restore')){$v.pcSidecars.status='FAIL'};return $v
 }
 function C3-HashBytes([byte[]]$Bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
 function C3-Snapshot([byte[]]$Bytes,[string]$Identity){return @{bytes=$Bytes;sha256=(C3-HashBytes $Bytes);identityKey=$Identity;aclSha256=(Digest 'PUBLIC_C3_ACL')}}
 function C3-ReadStream([byte[]]$Bytes,[string]$Kind){
  $v=[pscustomobject]@{bytes=$Bytes;position=0;kind=$Kind;disposed=$false;CanTimeout=$true;ReadTimeout=0;WriteTimeout=0}
  $v|Add-Member ScriptMethod Read {param($b,$o,$count)C3-Touch $this.kind;if($this.kind -ceq 'http-read'){Require ($this.ReadTimeout -gt 0 -and $this.ReadTimeout -le 3000 -and $this.ReadTimeout -le [Math]::Floor($(if((C3-State).phase -ceq 'FORWARD'){$script:c3.forward}else{$script:c3.hard})*1000)) 'C3_RESPONSE_STREAM_REMAINING_TIMEOUT'};$n=[Math]::Min($count,$this.bytes.Length-$this.position);if($n -gt 0){[Array]::Copy($this.bytes,$this.position,$b,$o,$n);$this.position+=$n};C3-After $this.kind;return [int]$n}
  $v|Add-Member ScriptMethod Dispose {$this.disposed=$true};[void]$script:c3.resources.Add($v);return $v
 }
 function Get-OwnerProductionExerciseDriveTypeLeaf($Root){C3-Touch 'drive';C3-After 'drive';return [IO.DriveType]::Fixed}
 function Get-OwnerProductionExerciseMetadataLeaf($Path){C3-Touch 'metadata';$file=$script:c3.files.ContainsKey($Path);$absent=(-not $file -and $Path -match '\.(candidate|backup|failed)$');C3-After 'metadata';return @{exists=(-not $absent);directory=(-not $file);reparse=$script:c3.metaReparse}}
 function Get-OwnerProductionExerciseAclLeaf($Path){C3-Touch 'acl';$v=[pscustomobject]@{};$v|Add-Member ScriptMethod GetOwner {param($t)return @{Value=$(if($script:c3.foreignOwner){'S-1-5-21-111-222-333-999'}else{$script:c3.context.ownerSid})}};$v|Add-Member ScriptMethod GetAccessRules {param($a,$b,$t)return @()};$v|Add-Member ScriptMethod GetSecurityDescriptorSddlForm {param($s)return $(if($script:c3.aclDrift){'DIFFERENT_PUBLIC_ACL'}else{'PUBLIC_C3_ACL'})};C3-After 'acl';return $v}
 function Set-OwnerProductionExerciseAclLeaf($Path,$Acl){C3-Touch 'set-acl';Require ($script:c3.files.ContainsKey($Path)) 'C3_OWNED_ACL';$script:c3.files[$Path].aclSha256=Digest 'PUBLIC_C3_ACL';C3-After 'set-acl'}
 function Open-OwnerProductionExerciseReadLeaf($Path){C3-Touch 'file-open';if(-not $script:c3.files.ContainsKey($Path)){throw 'PRIVATE_C3_MISSING_FILE'};$s=C3-ReadStream $script:c3.files[$Path].bytes 'file-read';C3-After 'file-open';return $s}
 function Open-OwnerProductionExerciseDatabaseLeaf($Path){return Open-OwnerProductionExerciseReadLeaf $Path}
 function Get-OwnerProductionExerciseFileIdentityLeaf($Stream,$Path){C3-Touch 'file-identity';$v=@{identityKey=$script:c3.files[$Path].identityKey;links=$(if($script:c3.hardLink){2}else{1});finalPath=$Path;reparse=$false};C3-After 'file-identity';return $v}
 function Open-OwnerProductionExerciseWriteLeaf($Path){
  C3-Touch 'file-create';Require (-not $script:c3.files.ContainsKey($Path)) 'C3_CREATE_NEW';$script:c3.files[$Path]=C3-Snapshot ([byte[]]@()) ('CANDIDATE-'+$script:c3Index)
  $v=[pscustomobject]@{path=$Path;disposed=$false}
  $v|Add-Member ScriptMethod Write {param($bytes,$offset,$count)C3-Touch 'file-write';$b=New-Object byte[] $count;[Array]::Copy($bytes,$offset,$b,0,$count);$id=$script:c3.files[$this.path].identityKey;$script:c3.files[$this.path]=C3-Snapshot $b $id;C3-After 'file-write'}
  $v|Add-Member ScriptMethod Flush {param($durable)C3-Touch 'file-flush';C3-After 'file-flush'};$v|Add-Member ScriptMethod Dispose {$this.disposed=$true};[void]$script:c3.resources.Add($v);C3-After 'file-create';return $v
 }
 function Replace-OwnerProductionExerciseFileLeaf($Replacement,$Destination,$Backup){
  C3-Touch 'replace';Require ($script:c3.files.ContainsKey($Replacement) -and $script:c3.files.ContainsKey($Destination) -and -not $script:c3.files.ContainsKey($Backup)) 'C3_REPLACE_EXACT_OWNED_TRANSITION'
  $isForward=$Replacement.EndsWith('.candidate');$script:c3.files[$Backup]=$script:c3.files[$Destination];$script:c3.files[$Destination]=$script:c3.files[$Replacement];$script:c3.files.Remove($Replacement)
  if($isForward -and $script:c3.crossForward){$script:c3.forward=0;$script:c3.hard=$script:c3.crossForward}
  if(($isForward -and $script:c3.replaceThrows) -or (-not $isForward -and $script:c3.restoreThrows)){$script:c3.restoreThrows=$false;C3-After 'replace';throw 'PRIVATE_C3_REPLACE_UNKNOWN'};C3-After 'replace'
 }
 function Remove-OwnerProductionExerciseFileLeaf($Path){C3-Touch 'remove';Require ($Path.EndsWith('.candidate') -and $script:c3.files.ContainsKey($Path)) 'C3_DELETE_ONLY_OWNED_CANDIDATE';[void]$script:c3.removed.Add($Path);$script:c3.files.Remove($Path);C3-After 'remove'}
 function ConvertFrom-OwnerProductionExerciseCipherLeaf($Bytes){C3-Touch 'decrypt';$s=[Text.Encoding]::ASCII.GetString($Bytes);$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))|ConvertFrom-Json;if($script:c3.projectionDrift){$v.environment.OTHER='changed'};C3-After 'decrypt';return $v}
 function ConvertTo-OwnerProductionExerciseCipherLeaf($Json){C3-Touch 'encrypt';$v=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Json));C3-After 'encrypt';return $v}
 function New-OwnerProductionExerciseCodeLeaf {C3-Touch 'generate';C3-After 'generate';return 'PRIVATE_C3_NEW_CODE_01234567890123456789'}
 function Show-OwnerProductionExerciseConfirmationLeaf($State){C3-Touch 'confirmation';if($script:c3.caseShapeDrift){$v=$script:c3.context.profile;$script:c3.context.PSObject.Properties.Remove('profile');$script:c3.context|Add-Member NoteProperty Profile $v};if($script:c3.bindingDrift){$script:c3.context.configuration.dbPath='C:\foreign.db'};C3-After 'confirmation';return [pscustomobject]@{confirmed=(-not $script:c3.cancel);warning=(-not $script:c3.noWarning)}}
 function Show-OwnerProductionExerciseResultLeaf($State,$Result){C3-Touch 'result-ui';if($script:c3.resultFailure){if($script:c3.resultHardOne){$script:c3.forward=0;$script:c3.hard=1};throw 'PUBLIC_C3_RESULT_UI_FAILURE'};C3-After 'result-ui'}
 function Get-OwnerProductionExerciseWindowsDirectoryLeaf {C3-Touch 'platform-windows';return 'C:\Windows'}
 function Get-OwnerProductionExerciseOwnerProfileLeaf {C3-Touch 'platform-profile';return 'C:\Owner'}
 function Get-OwnerProductionExerciseLocalAppDataLeaf {C3-Touch 'platform-local-app-data';return 'C:\Owner\AppData\Local'}
 function New-OwnerProductionExerciseValidatorLeaf($Context){
  C3-Touch 'validator-create';Require ([object]::ReferenceEquals($Context,$script:c3.context)) 'C3_VALIDATOR_CONTEXT'
  $input=[pscustomobject]@{AutoFlush=$true};$input|Add-Member ScriptMethod Write {param($json)C3-Touch 'validator-write';$script:c3.validatorJson=$json;C3-After 'validator-write'};$input|Add-Member ScriptMethod WriteAsync {param($json)C3-Touch 'validator-write';$script:c3.validatorJson=$json;if($script:c3.validatorBudget){$script:c3.forward=1;$script:c3.hard=121};C3-After 'validator-write';return [Threading.Tasks.Task]::Delay(0)};$input|Add-Member ScriptMethod Close {C3-Touch 'validator-close';C3-After 'validator-close'}
  $p=[pscustomobject]@{StandardInput=$input;StandardOutput=[IO.StringReader]::new('Production configuration structure: PASS');StandardError=[IO.StringReader]::new('');ExitCode=0;disposed=$false;canceled=$false}
  $p|Add-Member ScriptMethod Start {C3-Touch 'validator-start';C3-After 'validator-start';return $true};$p|Add-Member ScriptMethod WaitForExit {param($ms)if($this.canceled){return $true};C3-Touch 'validator-wait';$script:c3.validatorWait=$ms;Require ($ms -gt 0 -and $ms -le [Math]::Min(10000,[Math]::Floor($script:c3.forward*1000))) 'C3_VALIDATOR_REMAINING_BUDGET';C3-After 'validator-wait';return $true};$p|Add-Member ScriptMethod Kill {$this.canceled=$true;$script:c3.ownedChildCanceled++};$p|Add-Member ScriptMethod Dispose {$this.disposed=$true;$this.StandardOutput.Dispose();$this.StandardError.Dispose()};[void]$script:c3.resources.Add($p);C3-After 'validator-create';return $p
 }
 function Get-OwnerProductionExerciseLastRunLeaf {C3-Touch 'last-run';C3-After 'last-run';return [datetime]$script:c3.lastRun}
 function Get-OwnerProductionExerciseTaskStateLeaf {C3-Touch 'task-state';C3-After 'task-state';return $script:c3.taskState}
 function Stop-OwnerProductionExerciseTaskLeaf {C3-Touch 'task-stop';$script:c3.taskState=if($script:c3.stopNever){'Running'}else{'Ready'};if($script:c3.expireRecoveryStop -and (C3-State).phase -ceq 'RECOVERY'){$script:c3.hard=0;$script:c3.forward=0;$script:c3.expired=$true};C3-After 'task-stop'}
 function Start-OwnerProductionExerciseTaskLeaf {C3-Touch 'task-start';$script:c3.taskState='Running';$script:c3.lastRun=$script:c3.lastRun.AddSeconds(1);C3-After 'task-start'}
 function Wait-OwnerProductionExerciseLeaf($Milliseconds){C3-Touch 'sleep';Require ($Milliseconds -in @(100,1000)) 'C3_FIXED_SLEEP';if($script:c3.utcStall){$script:c3.hard=0;$script:c3.forward=0;$script:c3.expired=$true};C3-After 'sleep'}
 function New-OwnerProductionExerciseRequestLeaf($Uri){
  C3-Touch 'http-create';Require ($Uri -cin @('http://127.0.0.1:3000/api/owner-login','http://127.0.0.1:8787/health')) 'C3_FIXED_URI';[void]$script:c3.uris.Add($Uri)
  $v=[pscustomobject]@{uri=$Uri;Proxy='FOREIGN_PROXY';AllowAutoRedirect=$true;UseDefaultCredentials=$true;Credentials='FOREIGN';PreAuthenticate=$true;KeepAlive=$true;Accept='';CookieContainer=[Net.CookieContainer]::new();Timeout=0;ReadWriteTimeout=0;Method='';ContentType='';ContentLength=0;aborted=$false;ownedSend=$null;ownedResponse=$null;observedOwned=$null;observedMemory=$null}
  [void]$script:c3.requests.Add($v)
  if($script:c3.trackHttpAllocations){$frames=@(Get-PSCallStack|Where-Object {$_.FunctionName -ceq 'Invoke-OwnerProductionExerciseHttp'});Require ($frames.Count -eq 1) 'C3_PUBLIC_HTTP_FRAME';$locals=$frames[0].GetFrameVariables();Require ($locals.ContainsKey('ownedHttp') -and $locals.ContainsKey('memory')) 'C3_PUBLIC_HTTP_OWNED_LOCALS';$v.observedOwned=$locals['ownedHttp'].Value;$v.observedMemory=$locals['memory'].Value;Require ($v.observedOwned -is [Collections.IDictionary] -and $v.observedMemory -is [IO.MemoryStream]) 'C3_ACTUAL_HTTP_OWNED_ALLOCATIONS'}
  $v|Add-Member ScriptMethod GetRequestStream {
   C3-Touch 'http-request-stream';Require ($null -eq $this.Proxy -and -not $this.AllowAutoRedirect -and -not $this.UseDefaultCredentials -and $null -eq $this.Credentials -and -not $this.PreAuthenticate -and $this.Timeout -gt 0 -and $this.Timeout -le 3000 -and $this.ReadWriteTimeout -le 3000 -and $this.CookieContainer.Count -eq 0 -and $this.Method -ceq 'POST' -and $this.ContentType -ceq 'application/x-www-form-urlencoded') 'C3_NO_PROXY_REDIRECT_CREDENTIAL_FORWARD'
   $s=[pscustomobject]@{CanTimeout=$true;ReadTimeout=0;WriteTimeout=0;disposed=$false};$s|Add-Member ScriptMethod Write {param($bytes,$o,$n)C3-Touch 'http-write';Require ($this.WriteTimeout -gt 0 -and $this.WriteTimeout -le 3000 -and $this.WriteTimeout -le [Math]::Floor($(if((C3-State).phase -ceq 'FORWARD'){$script:c3.forward}else{$script:c3.hard})*1000)) 'C3_REQUEST_STREAM_REMAINING_TIMEOUT';$text=[Text.Encoding]::UTF8.GetString($bytes,$o,$n);Require ($text -ceq ('passcode='+[Uri]::EscapeDataString($(if($script:c3.expectedHttpCode){$script:c3.expectedHttpCode}else{$s=C3-State;if($s.restoreEntered -or $s.phase -ceq 'RECOVERY'){$s.oldCode}else{$s.newCode}})))) 'C3_FIXED_BODY';$script:c3.bodyWrites++;if($script:c3.httpBudget){$script:c3.forward=0.5;$script:c3.hard=120.5};C3-After 'http-write'};$s|Add-Member ScriptMethod Flush {C3-Touch 'http-flush';Require ($this.WriteTimeout -gt 0 -and $this.WriteTimeout -le [Math]::Floor($(if((C3-State).phase -ceq 'FORWARD'){$script:c3.forward}else{$script:c3.hard})*1000)) 'C3_FLUSH_REMAINING_TIMEOUT';C3-After 'http-flush'};$s|Add-Member ScriptMethod Dispose {if(-not $script:c3.expired){C3-Touch 'http-request-dispose'};$this.disposed=$true;C3-After 'http-request-dispose'};[void]$script:c3.resources.Add($s);$this.ownedSend=$s;if($script:c3.httpBudget){$script:c3.forward=1;$script:c3.hard=121};C3-After 'http-request-stream';return $s
  }
  $v|Add-Member ScriptMethod GetResponse {
   C3-Touch 'http-response';Require ($null -eq $this.Proxy -and -not $this.AllowAutoRedirect -and $this.CookieContainer.Count -eq 0 -and $this.Timeout -gt 0 -and $this.Timeout -le 3000) 'C3_RESPONSE_NO_FORWARD'
   $isLogin=$this.uri.EndsWith('/owner-login');Require ($this.Method -ceq $(if($isLogin){'POST'}else{'GET'})) 'C3_FIXED_METHOD'
   $content=if($isLogin){'{"ok":true}'}else{'{"ok":true,"service":"jarvis-broker","runtimeRevision":"'+('a'*40)+'"}'}
   $status=if($script:c3.httpStatus){$script:c3.httpStatus}else{200};if($script:c3.httpOversize){$content='x'*8193};if($script:c3.badHttpJson){$content='not-json'}
   $r=[pscustomobject]@{StatusCode=$status;ResponseUri=[uri]$this.uri;ContentLength=$(if($script:c3.unknownLength){-1}else{[Text.Encoding]::UTF8.GetByteCount($content)});bytes=[Text.Encoding]::UTF8.GetBytes($content);disposed=$false}
   $r|Add-Member ScriptMethod GetResponseStream {C3-Touch 'http-response-stream';$script:c3.bodyReads++;$s=C3-ReadStream $this.bytes 'http-read';C3-After 'http-response-stream';return $s};$r|Add-Member ScriptMethod Close {$this.disposed=$true};[void]$script:c3.resources.Add($r);$this.ownedResponse=$r;$script:c3.httpResponses++;C3-After 'http-response';return $r
  }
  $v|Add-Member ScriptMethod Abort {$this.aborted=$true;$script:c3.ownedRequestsCanceled++};C3-After 'http-create';return $v
 }
 function C3-Setup {
  $script:c3=$null;$script:c3Index++;$record=Setup $script:c3Index;$binding=Get-OwnerProductionTaskBinding -Admission $script:token;$migration=Set-OwnerProductionTaskAction -Binding $binding;Require $migration.migrationVerified 'C3_ORIGINAL_MIGRATION'
  $configuration=[pscustomobject]@{version=1;commit=('a'*40);releaseRoot='C:\public-runtime';environment=[pscustomobject]@{JARVIS_OWNER_SECRET='PRIVATE_C3_OLD_CODE_01234567890123456789';JARVIS_DB_PATH='C:\Owner\JARVIS\production\broker.db';OTHER='preserved'}}
  $cipher=[Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($configuration|ConvertTo-Json -Depth 20 -Compress))))
  $files=@{};$config='C:\Owner\JARVIS\production\config.dpapi';$files[$config]=C3-Snapshot $cipher 'ORIGINAL';foreach($pair in @(@('C:\public-runtime\jarvis-release.json','MANIFEST'),@('C:\public-runtime\.next\BUILD_ID','BUILD'),@('C:\public-runtime\scripts\jarvis-remote-host.mjs','HOST'),@('C:\Owner\JARVIS\production\broker.db','DATABASE'))){$files[$pair[0]]=C3-Snapshot ([Text.Encoding]::ASCII.GetBytes('public')) $pair[1]}
  $sidecars=@{};foreach($suffix in @('.pc-tasks.json','.pc-observations.json')){$path=$configuration.environment.JARVIS_DB_PATH+$suffix;$files[$path]=C3-Snapshot ([Text.Encoding]::ASCII.GetBytes('{}')) $suffix;$sidecars[$suffix]=$files[$path]}
  $cb=@{configuration=$configuration;configPath=$config;configSnapshot=$files[$config];stateRoot='C:\Owner\JARVIS\production';releaseRoot='C:\public-runtime';runtimeRevision=('a'*40);manifest=$files['C:\public-runtime\jarvis-release.json'];build=$files['C:\public-runtime\.next\BUILD_ID'];host=$files['C:\public-runtime\scripts\jarvis-remote-host.mjs'];dbPath=$configuration.environment.JARVIS_DB_PATH;dbIdentity=@{key='DATABASE'};sidecars=$sidecars;targetEnvironmentVerified=$false}
  $ctx=[pscustomobject][ordered]@{profile=$record.profile;sourceRevision=$record.sourceRevision;sourceClosureSha256=$record.sourceClosureSha256;originalGrantSha256=$record.originalGrantSha256;attemptId=$record.attemptId;ownerSid=$record.ownerSid;sessionId=$record.sessionId;processId=$record.processId;contextIdentity=[object]::new();attemptIdentity=$record.attemptIdentity;proofEvidenceIdentity=$record.proofEvidenceIdentity;originalClockIdentity=$record.originalClockIdentity;journalIdentity=$record.journalIdentity;recoveryWitnessIdentity=$record.recoveryWitnessIdentity;preservationSessionIdentity=$record.preservationSessionIdentity;sourceIdentity=[object]::new();expectedTaskIdentity=[object]::new();environmentIdentity=[object]::new();configuration=$cb;controllerRoot='C:\public-source';nodePath='C:\public-node\node.exe'}
  Require ($script:c3ContextSeen.Add($ctx.contextIdentity) -and $script:c3AttemptSeen.Add($ctx.attemptIdentity)) 'C3_FRESH_ATTEMPT_AND_CONTEXT_PER_CASE'
  $script:c3=@{context=$ctx;target=$record.target;files=$files;forward=600.0;hard=720.0;expired=$false;afterExpiry=0;cutBoundary='';cutWhen='';cutSeen=$false;expireBefore='';expireAfter='';throwLeaf='';trace=[Collections.Generic.List[string]]::new();seen=[Collections.Generic.HashSet[string]]::new();events=[Collections.Generic.List[string]]::new();rows=@{};receipts=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();resolves=0;allowRemint=$false;copyContext=$false;automation=$true;sourceDrift=$false;peerLost=$false;taskDrift=$false;projectionDrift=$false;sidecarDrift=$false;ambiguousJournal=$false;foreignReceipt=$false;booleanEntered=$false;outcomeRefusal=$false;candidateIdentityObserved=$false;recoveryWitnesses=0;removed=[Collections.Generic.List[string]]::new();cancel=$false;noWarning=$false;validatorJson=$null;ownedChildCanceled=0;ownedRequestsCanceled=0;lastRun=[datetime]'2026-11-06T10:00:00Z';taskState='Running';httpStatus=0;httpOversize=$false;unknownLength=$false;badHttpJson=$false;uris=[Collections.Generic.List[string]]::new();bodyWrites=0;bodyReads=0;httpResponses=0;crossForward=0;replaceThrows=$false;restoreThrows=$false;stopNever=$false;utcStall=$false;caseShapeDrift=$false;bindingDrift=$false;traceFrames=$false;validatorBudget=$false;validatorWait=0;httpBudget=$false;resources=[Collections.Generic.List[object]]::new();requests=[Collections.Generic.List[object]]::new();trackHttpAllocations=$false;clockReads=0;expectedHttpCode=$null;resultFailure=$false;resultHardOne=$false;restoredCheckpointFailure=$false;expireRecoveryStop=$false;metaReparse=$false;foreignOwner=$false;aclDrift=$false;hardLink=$false}
 }
 function C3-Run {return Invoke-OwnerProductionGuardedExercise -Admission $script:token}
 function C3-State {$s=$null;Require ($script:OwnerProductionHelperState.exerciseContexts.TryGetValue($script:c3.context.contextIdentity,[ref]$s)) 'C3_STATE_EXISTS';return $s}
 function C3-Refused($Value){Require (-not $Value.complete) 'C3_MUST_REFUSE'}
 function C3-NewHttpContext {C3-Setup;$script:c3.cancel=$true;$null=C3-Run;$script:c3.cancel=$false;$script:c3.expectedHttpCode='PRIVATE_C3_HTTP_CODE_01234567890123456789';return C3-State}
 function C3-ExactHttpRefusal([scriptblock]$Call,[string]$Expected){$actual=$null;try{&$Call|Out-Null}catch{$actual=$_.Exception.Message};Require ($actual -ceq $Expected) 'C3_HTTP_EXACT_REFUSAL'}
 function C3-HttpLifetimeRefs($State){return [ordered]@{state=$State;admission=$script:token;context=$script:c3.context;contextIdentity=$State.context.contextIdentity;attemptIdentity=$State.context.attemptIdentity;clockIdentity=$State.context.originalClockIdentity;journalIdentity=$State.context.journalIdentity;proofIdentity=$State.context.proofEvidenceIdentity;recoveryIdentity=$State.context.recoveryWitnessIdentity;preservationIdentity=$State.context.preservationSessionIdentity;sourceIdentity=$State.context.sourceIdentity;taskIdentity=$State.context.expectedTaskIdentity;environmentIdentity=$State.context.environmentIdentity;configuration=$State.context.configuration;slots=$State.slots;rows=$script:c3.rows;receipts=$script:c3.receipts;helper=$script:OwnerProductionHelperState;admissions=$script:OwnerProductionHelperState.exerciseAdmissions;contexts=$script:OwnerProductionHelperState.exerciseContexts;attempts=$script:OwnerProductionHelperState.exerciseAttempts;b2Attempts=$script:OwnerProductionHelperState.attempts;clocks=$script:OwnerProductionHelperState.clocks}}
 function C3-PinHttpLifetime($State){
  $b2=$null;$clock=$null;Require ($script:OwnerProductionHelperState.attempts.TryGetValue($State.context.attemptIdentity,[ref]$b2) -and $script:OwnerProductionHelperState.clocks.TryGetValue($State.context.originalClockIdentity,[ref]$clock)) 'C3_ORIGINAL_B2_AND_CLOCK_EXIST'
  $slots=@{};foreach($key in $State.slots.Keys){$v=$State.slots[$key];$slots[$key]=@{reference=$v;receipt=$v.receipt;memory=$v.memory;durable=$v.durable;operation=$v.operation}}
  $rows=@{};foreach($key in $script:c3.rows.Keys){$v=$script:c3.rows[$key];$rows[$key]=@{reference=$v;receipt=$v.receipt;outcome=$v.outcome;context=$v.context;attempt=$v.attempt;journal=$v.journal;clock=$v.clock;operation=$v.operation}}
  return @{refs=(C3-HttpLifetimeRefs $State);b2=$b2;clock=$clock;slots=$slots;rows=$rows;phase=$State.phase;hardEnd=$State.hardEndUtc;forward=$State.forward;hard=$State.hard;providerForward=$script:c3.forward;providerHard=$script:c3.hard;contextCount=$script:c3ContextSeen.Count;attemptCount=$script:c3AttemptSeen.Count}
 }
 function C3-AssertHttpLifetime($State,$Pin,[bool]$Terminal=$false){
  $refs=C3-HttpLifetimeRefs $State;foreach($key in $Pin.refs.Keys){Require ([object]::ReferenceEquals($refs[$key],$Pin.refs[$key])) ('C3_HTTP_REFERENCE_'+$key)}
  foreach($pair in @(@('exerciseAdmissions',$script:token),@('exerciseAttempts',$State.context.attemptIdentity),@('exerciseContexts',$State.context.contextIdentity))){$again=$null;Require ($script:OwnerProductionHelperState[$pair[0]].TryGetValue($pair[1],[ref]$again) -and [object]::ReferenceEquals($again,$State)) 'C3_HTTP_ONE_C3_REGISTRATION'}
  $again=$null;$clock=$null;Require ($script:OwnerProductionHelperState.attempts.TryGetValue($State.context.attemptIdentity,[ref]$again) -and [object]::ReferenceEquals($again,$Pin.b2) -and $again.consumed -and $again.registrationAttempted -and $again.callState -ceq 'RETURNED' -and [object]::ReferenceEquals($again.admission,$script:token) -and $script:current.registrations -eq 1) 'C3_HTTP_ONE_CONSUMED_B2_MIGRATION'
  Require ($script:OwnerProductionHelperState.clocks.TryGetValue($State.context.originalClockIdentity,[ref]$clock) -and [object]::ReferenceEquals($clock,$Pin.clock) -and $State.phase -ceq $Pin.phase -and $State.terminal -eq $Terminal -and $script:c3ContextSeen.Count -eq $Pin.contextCount -and $script:c3AttemptSeen.Count -eq $Pin.attemptCount) 'C3_HTTP_NO_PHASE_ATTEMPT_CLOCK_RESET'
  Require ($State.slots.Count -eq $Pin.slots.Count -and $script:c3.rows.Count -eq $Pin.rows.Count) 'C3_HTTP_NO_OPERATION_RESERVATION'
  foreach($key in $Pin.slots.Keys){$old=$Pin.slots[$key];$v=$State.slots[$key];Require ([object]::ReferenceEquals($old.reference,$v) -and [object]::ReferenceEquals($old.receipt,$v.receipt) -and $old.memory -ceq $v.memory -and $old.durable -ceq $v.durable -and $old.operation -ceq $v.operation) 'C3_HTTP_SLOTS_UNCHANGED'}
  foreach($key in $Pin.rows.Keys){$old=$Pin.rows[$key];$v=$script:c3.rows[$key];foreach($field in @('receipt','context','attempt','journal','clock')){Require ([object]::ReferenceEquals($old[$field],$v[$field])) 'C3_HTTP_JOURNAL_REFERENCE'};Require ([object]::ReferenceEquals($old.reference,$v) -and $old.outcome -ceq $v.outcome -and $old.operation -ceq $v.operation) 'C3_HTTP_JOURNAL_OUTCOME_UNCHANGED'}
  Require ($State.hardEndUtc -ceq $Pin.hardEnd -and $clock.hardEndUtc -ceq $Pin.hardEnd -and $State.forward -le $Pin.forward -and $State.hard -le $Pin.hard -and $script:c3.forward -le $Pin.providerForward -and $script:c3.hard -le $Pin.providerHard) 'C3_HTTP_ORIGINAL_NONRENEWING_CLOCK'
  $Pin.forward=$State.forward;$Pin.hard=$State.hard;$Pin.providerForward=$script:c3.forward;$Pin.providerHard=$script:c3.hard
 }
 function C3-AssertRedirectTransport($Tracker,[int]$ResourceStart,[int]$RequestStart){
  Require ($script:c3.requests.Count -eq $RequestStart+1 -and $script:c3.resources.Count -eq $ResourceStart+2) 'C3_HTTP_ONE_FRESH_TRANSPORT'
  $r=$script:c3.requests[$RequestStart];Require ($r.aborted -and $r.ownedSend.disposed -and $r.ownedResponse.disposed -and $r.observedMemory -is [IO.MemoryStream] -and -not $r.observedMemory.CanRead -and $r.CookieContainer -is [Net.CookieContainer] -and $r.CookieContainer.Count -eq 0) 'C3_HTTP_EACH_OWNED_TRANSPORT_CLOSED'
  Assert-OwnerProductionShape $r.observedOwned @('request','send','response','read');Require ([object]::ReferenceEquals($r.observedOwned.request,$r) -and [object]::ReferenceEquals($r.observedOwned.response,$r.ownedResponse) -and $null -eq $r.observedOwned.send -and $null -eq $r.observedOwned.read -and [object]::ReferenceEquals($script:c3.resources[$ResourceStart],$r.ownedSend) -and [object]::ReferenceEquals($script:c3.resources[$ResourceStart+1],$r.ownedResponse) -and -not $r.KeepAlive -and $r.Accept -ceq 'application/json' -and $r.Method -ceq 'POST') 'C3_ACTUAL_PRODUCT_OWNED_RECORD'
  foreach($v in @($r,$r.ownedSend,$r.ownedResponse,$r.CookieContainer,$r.observedOwned,$r.observedMemory)){$previous=$null;Require (-not $Tracker.TryGetValue($v,[ref]$previous)) 'C3_HTTP_NO_TRANSPORT_REUSE';$Tracker.Add($v,[object]::new())}
 }
 function C3-LifecycleCounters($State){return [ordered]@{contextResolves=$script:c3.resolves;traceEntries=$script:c3.trace.Count;clockReads=$script:c3.clockReads;kernelReads=$script:current.kernelReads;services=$script:current.services;lookups=$script:current.lookups;registrations=$script:current.registrations;journals=$script:current.journals;rows=$script:c3.rows.Count;slots=$State.slots.Count;requests=$script:c3.requests.Count;resources=$script:c3.resources.Count;removed=$script:c3.removed.Count;checkpointEvents=$script:c3.events.Count;recoveryWitnesses=$script:c3.recoveryWitnesses}}
 function C3-LifecycleDelta($Before,$After,[bool]$Remint=$false){$delta=[ordered]@{};foreach($key in $Before.Keys){$delta[$key]=[int]$After[$key]-[int]$Before[$key];$expected=if($Remint -and $key -cin @('contextResolves','traceEntries')){1}else{0};Require ($delta[$key] -eq $expected) ('C3_LIFECYCLE_CALL_DELTA_'+$key)};return $delta}
 $summary=@{pass=$true;unwiredDefaultRefused=$true;admissionOnlyEntry=$true;realTaskCredentialCalls=0;nativeGrant=$false;freshContextPerCase=$true;freshTerminalContextPerCase=$true;operationCount=$script:OwnerProductionExerciseOperations.Count;results=@();hardExpiryNextProtectedCalls=0}
 if($Scenario -eq 'guarded-c3-fractional-clock'){
  $cases=@();foreach($row in @(@('mid-fraction',599.75,719.75,$true),@('near-forward-boundary',0.25,120.25,$true),@('near-forward-upper-fraction',0.75,120.75,$true),@('reserve-119.75',0,119.75,$true),@('reserve-0.25',0,0.25,$true),@('fractional-invalid-geometry',600,719.75,$false),@('integer-invalid-geometry',600,601,$false),@('future-increase',601,721,$false),@('invalid-near-boundary',0,120.25,$false))){
   $s=C3-NewHttpContext;$refs=C3-HttpLifetimeRefs $s;$deadline=$s.hardEndUtc;$script:c3.forward=$row[1];$script:c3.hard=$row[2];$accepted=$true;try{Assert-OwnerProductionExerciseRawClock $s}catch{Require ($_.Exception.Message -ceq 'ROTATION_CUTOVER_SCOPE_EXPIRED') 'C3_FRACTIONAL_CLOSED_ERROR';$accepted=$false}
   Require ($accepted -eq $row[3] -and $s.terminal -eq (-not $row[3]) -and $s.hardEndUtc -ceq $deadline) ('C3_FRACTIONAL_EXPECTED_'+$row[0]);$again=C3-HttpLifetimeRefs $s;foreach($key in $refs.Keys){Require ([object]::ReferenceEquals($again[$key],$refs[$key])) 'C3_FRACTIONAL_SAME_ORIGINAL_REGISTERED_REFERENCES'};Require ([object]::ReferenceEquals((C3-State),$s) -and $script:current.registrations -eq 1 -and $script:c3.requests.Count -eq 0) 'C3_FRACTIONAL_NO_IO_OR_REMIGRATION';$cases+=$row[0]
  }
  $s=C3-NewHttpContext;$clock=$s.context.originalClockIdentity;$deadline=$s.hardEndUtc;$script:c3.forward=0;$script:c3.hard=0;C3-ExactHttpRefusal {Assert-OwnerProductionExerciseRawClock $s} 'ROTATION_CUTOVER_SCOPE_EXPIRED';Require $s.terminal 'C3_FRACTIONAL_HARD0_TERMINAL';$cases+='hard0-terminal';$reads=$script:c3.clockReads;$script:c3.forward=599.75;$script:c3.hard=719.75;C3-ExactHttpRefusal {Assert-OwnerProductionExerciseRawClock $s} 'ROTATION_CUTOVER_SCOPE_EXPIRED';Require ($s.terminal -and $script:c3.clockReads -eq $reads -and [object]::ReferenceEquals($clock,$s.context.originalClockIdentity) -and $s.hardEndUtc -ceq $deadline -and $script:c3.requests.Count -eq 0) 'C3_FRACTIONAL_EXPIRED_CANNOT_REVIVE';$cases+='expired-cannot-revive'
  C3-Setup;$script:c3.crossForward=119.75;$value=C3-Run;Require (-not $value.complete -and $value.rotation.rollbackVerified -and $value.rotation.oldLoginVerified -and -not (C3-State).terminal -and (C3-State).phase -ceq 'RECOVERY' -and $script:c3.recoveryWitnesses -gt 0) 'C3_FRACTIONAL_REAL_ORIGINAL_RECOVERY';$cases+='actual-recovery-119.75'
  @{pass=$true;cases=$cases;sameOriginalRegisteredReferences=$true;realTaskCredentialCalls=0;nativeGrant=$false}|ConvertTo-Json -Depth 4 -Compress;exit
 }
 if($Scenario -eq 'guarded-c3-restoration-reporting'){
  $rows=@();foreach($kind in @('result-ui','result-ui-hard1','restoration-checkpoint')){C3-Setup;if($kind -ceq 'restoration-checkpoint'){$script:c3.restoredCheckpointFailure=$true}else{$script:c3.resultFailure=$true};if($kind -ceq 'result-ui-hard1'){$script:c3.resultHardOne=$true;$script:c3.expireRecoveryStop=$true};$value=C3-Run;$state=C3-State
   Require (-not $value.complete -and $script:c3.taskState -ceq 'Running' -and -not $state.slots.ContainsKey('RECOVERY_TASK_STOP') -and @($script:c3.trace|Where-Object {$_ -ceq 'task-stop'}).Count -eq 2 -and @($script:c3.trace|Where-Object {$_ -ceq 'task-start'}).Count -eq 2) ('WORKING_ORIGINAL_NOT_RESTOPPED_'+$kind)
   Require ($value.restoration.atomicRestorationVerified -and $value.restoration.oldLoginVerified -and $value.restoration.runtimeVerified -and -not $value.restoration.recoveryAttempted -and $script:c3.afterExpiry -eq 0) ('WORKING_ORIGINAL_EVIDENCE_'+$kind);if($kind -ceq 'restoration-checkpoint'){Require (-not $value.restoration.preservationVerified) 'R06_FAILURE_REMAINS_INCOMPLETE'};$rows+=,$value
  };@{pass=$true;results=$rows;cases=3;realTaskCredentialCalls=0;nativeGrant=$false}|ConvertTo-Json -Depth 8 -Compress;exit
 }
 if($Scenario -cin @('guarded-c3','guarded-c3-protocol')){
 C3-Setup;$success=C3-Run;Require $success.complete 'C3_SUCCESS';$summary.results+=,$success;$summary.candidateTransitionNotOriginalIdentity=$script:c3.candidateIdentityObserved;$traceBefore=[string]::Join(',',@($script:c3.trace));$resultBefore=$success|ConvertTo-Json -Depth 8 -Compress
 # One completed lifecycle owns the actual post-completion rejection probes.
 # Capture the success before those calls; the separate no-cut success follows.
 $summary.freshContextPerCase=$false;$completedState=C3-State;$lifecyclePin=C3-PinHttpLifetime $completedState;$reservationCount=$script:c3.rows.Count;$deltas=@{};$rejections=@();$replayCalls=0;$remintCalls=0;$reloadAttempts=0;$postReloadCalls=0
 $functions=@{};foreach($name in @('Invoke-OwnerProductionGuardedExercise','New-OwnerProductionExerciseResult','Assert-OwnerProductionExerciseGuard','Assert-OwnerProductionExerciseRawClock','Get-OwnerProductionTaskBinding','Set-OwnerProductionTaskAction','Resolve-OwnerProductionExerciseContext','Assert-OwnerProductionExerciseWitnesses','New-OwnerProductionExerciseWriteahead','Set-OwnerProductionExerciseEffectOutcome','Invoke-OwnerProductionExerciseCheckpoint','Get-OwnerProductionClockState','Resolve-OwnerProductionNativeAdmission')){$functions[$name]=(Get-Command $name).ScriptBlock}
 $before=C3-LifecycleCounters $completedState;$replayCalls++;$v=C3-Run;C3-Refused $v;$rejections+=,$v;Require ($script:c3.rows.Count -eq $reservationCount) 'C3_REPLAY_NO_RESERVATION';C3-AssertHttpLifetime $completedState $lifecyclePin;$deltas.replay=C3-LifecycleDelta $before (C3-LifecycleCounters $completedState);$summary.replayRefused=$true
 $before=C3-LifecycleCounters $completedState;$script:c3.allowRemint=$true;$foreignAdmission=[object]::new();$remintCalls++;$v=Invoke-OwnerProductionGuardedExercise -Admission $foreignAdmission;C3-Refused $v;$rejections+=,$v;$foreignState=$null;Require (-not $script:OwnerProductionHelperState.exerciseAdmissions.TryGetValue($foreignAdmission,[ref]$foreignState)) 'C3_REMINT_NOT_REGISTERED';C3-AssertHttpLifetime $completedState $lifecyclePin;$deltas.remint=C3-LifecycleDelta $before (C3-LifecycleCounters $completedState) $true;$summary.remintRefused=$true
 $before=C3-LifecycleCounters $completedState;$reloadCode=$null;$reloadAttempts++;try{. $helper}catch{$reloadCode=$_.Exception.Message};Require ($reloadCode -ceq 'ROTATION_CUTOVER_RELOAD_REFUSED') 'C3_RELOAD_EXACT_EARLY_REFUSAL';foreach($name in $functions.Keys){Require ([object]::ReferenceEquals($functions[$name],(Get-Command $name).ScriptBlock)) 'C3_RELOAD_FUNCTIONS_NOT_RESET'};C3-AssertHttpLifetime $completedState $lifecyclePin;$deltas.reload=C3-LifecycleDelta $before (C3-LifecycleCounters $completedState)
 $before=C3-LifecycleCounters $completedState;$postReloadCalls++;$v=C3-Run;C3-Refused $v;$rejections+=,$v;C3-AssertHttpLifetime $completedState $lifecyclePin;$deltas.postReload=C3-LifecycleDelta $before (C3-LifecycleCounters $completedState);$summary.reloadRefused=$true
 Require ($replayCalls -eq 1 -and $remintCalls -eq 1 -and $reloadAttempts -eq 1 -and $postReloadCalls -eq 1 -and ($success|ConvertTo-Json -Depth 8 -Compress) -ceq $resultBefore) 'C3_COMPLETED_LIFECYCLE_CALLS_AND_IMMUTABLE_SUCCESS';$summary.firstSuccessImmutable=$true;$summary.lifecycleRejectionResults=$rejections;$summary.lifecycleDeltas=$deltas;$summary.completedLifecycleMatrix=@{completedLifetimes=1;separateNoCutLifetime=1;replayCalls=$replayCalls;remintCalls=$remintCalls;reloadAttempts=$reloadAttempts;postReloadCalls=$postReloadCalls;sameConsumedState=$true;sameCWTRegistrations=$true;sameOriginalClock=$true;slotsAndJournalUnchanged=$true;reloadFunctionsUnchanged=$true}
 C3-Setup;$script:c3.traceFrames=$true;$equivalent=C3-Run;Require ($equivalent.complete -and ([string]::Join(',',@($script:c3.trace))) -ceq $traceBefore -and ($equivalent|ConvertTo-Json -Depth 8 -Compress) -ceq $resultBefore) 'C3_NO_CUT_TRACE_AND_SCHEMA_EQUIVALENCE';$summary.noCutTraceEquivalent=$true
 $saved=@{};foreach($name in @('NODE_OPTIONS','NODE_PATH','OPENSSL_CONF')){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,'PUBLIC_OWNED_STARTUP_CANARY','Process')}
 $actual=$null;try{$actual=&$script:c3ActualValidatorConstructor $script:c3.context;$envInfo=$actual.StartInfo.EnvironmentVariables;Require ($envInfo.Count -eq 4 -and $envInfo['SystemRoot'] -ceq 'C:\Windows' -and $envInfo['USERPROFILE'] -ceq 'C:\Owner' -and $envInfo['LOCALAPPDATA'] -ceq 'C:\Owner\AppData\Local' -and $envInfo['PATH'] -ceq 'C:\public-node;C:\Windows\System32\WindowsPowerShell\v1.0' -and -not $envInfo.ContainsKey('NODE_OPTIONS') -and -not $envInfo.ContainsKey('NODE_PATH') -and -not $envInfo.ContainsKey('OPENSSL_CONF')) 'ACTUAL_CTOR_VERIFIED_MINIMAL_ENVIRONMENT';$summary.actualConstructorEnvironmentClosed=$true}finally{if($actual){$actual.Dispose()};foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}}
 Require (($script:c3.events -join ',') -ceq 'before-rotation,before-commit,before-planned-restore,after-planned-restore') 'C3_CHECKPOINT_ORDER'
 C3-Setup;$script:c3.crossForward=119;$restored=C3-Run;Require (-not $restored.complete -and $restored.rotation.rollbackVerified) 'C3_FORWARD_EXHAUSTED_RECOVERED';$summary.results+=,$restored
 C3-Setup;$script:c3.expireBefore='result-ui';$plannedFailure=C3-Run
 # A planned restore failure that remains within the same raw reserve is a
 # different scenario from terminal hard expiry and must stay incomplete.
 C3-Setup;$script:c3.restoreThrows=$true;$plannedFailure=C3-Run;Require (-not $plannedFailure.complete -and $plannedFailure.restoration.recoveryVerified) 'C3_PLANNED_FAILURE_RECOVERY';$summary.results+=,$plannedFailure
 }
 $ids=@('authority-observations','context-allocation','confirmation-ui','result-ui','candidate-validator','restart-last-run','restart-stop','restart-stopping-loop','restart-start','restart-running-loop','login-sleep-and-task','login-post','runtime-health','runtime-config-db','attempt-record','credential-candidate','candidate-acl-hashes','forward-replace','forward-checkpoints','rollback-replace','rollback-runtime','candidate-cleanup','planned-restore','exercise-entry','exercise-protocol')
 if($Scenario -cin @('guarded-c3','guarded-c3-boundaries','guarded-c3-protocol','guarded-c3-http')){
 if($Scenario -ceq 'guarded-c3-protocol'){$ids=@('planned-restore')}elseif($Scenario -ceq 'guarded-c3-http'){$ids=@('candidate-cleanup')}elseif($Scenario -ceq 'guarded-c3-boundaries'){$ids=@($ids|Where-Object {$_ -cnotin @('planned-restore','candidate-cleanup')})}
 if($null -ne $c3BoundaryPart){switch($c3BoundaryPart){0{$ids=@($ids[0..5])};1{$ids=@($ids[6..11]);$script:c3Index+=12};2{$ids=@($ids[12..17]);$script:c3Index+=24};3{$ids=@($ids[18..22]);$script:c3Index+=36}};$summary.partIndex=$c3BoundaryPart}
 $count=0;foreach($id in $ids){foreach($when in @('pre','post')){C3-Setup;if($id -ceq 'rollback-replace'){$script:c3.crossForward=119};$script:c3.cutBoundary=$id;$script:c3.cutWhen=$when;$value=C3-Run;Require ($script:c3.cutSeen -and -not $value.complete -and $script:c3.afterExpiry -eq 0 -and @($script:c3.resources|Where-Object {-not $_.disposed}).Count -eq 0) ('C3_EXPIRY_'+$id+'_'+$when);$summary.hardExpiryNextProtectedCalls+=$script:c3.afterExpiry;$count++}}
 $summary.boundaryIds=$ids;$summary.expiryCases=$count
 }
 if($Scenario -cin @('guarded-c3','guarded-c3-protocol')){
 $clockCases=@();foreach($hard in @(119,1)){C3-Setup;$script:c3.crossForward=$hard;$v=C3-Run;$state=C3-State;Require (-not $state.terminal -and $script:c3.recoveryWitnesses -gt 0) ('C3_VALID_RECOVERY_'+$hard);$clockCases+=('recovery-'+$hard)}
 foreach($pair in @(@('hard-zero',0,0),@('fake-600-601',600,601),@('fake-1-119',1,119),@('renewed',601,721),@('utc-stall',0,0),@('invalid-number',[double]::NaN,720))){C3-Setup;if($pair[0] -ceq 'utc-stall'){$script:c3.stopNever=$true;$script:c3.utcStall=$true}else{$script:c3.forward=$pair[1];$script:c3.hard=$pair[2]};$v=C3-Run;C3-Refused $v;Require ((C3-State).terminal -and $script:c3.afterExpiry -eq 0) ('C3_BAD_CLOCK_'+$pair[0]);$clockCases+=$pair[0]};$summary.clockCases=$clockCases
 C3-Setup;$v=Invoke-OwnerProductionGuardedExercise -Admission ([pscustomobject]@{valid=$true});C3-Refused $v;$summary.copiedAdmissionRefused=$true
 foreach($key in @('sourceRevision','originalGrantSha256')){C3-Setup;$script:c3.context.$key=$(if($key -ceq 'sourceRevision'){'b'*40}else{'d'*64});$v=C3-Run;C3-Refused $v;Require ((C3-State).terminal -and $script:c3.rows.Count -eq 0) 'C3_ORIGINAL_SCALAR_PROVENANCE_BEFORE_JOURNAL'};$summary.sameOriginalProvenanceBound=$true
 C3-Setup;$script:c3.copyContext=$true;$v=C3-Run;C3-Refused $v;Require ($script:c3.trace -notcontains 'confirmation') 'C3_COPY_NO_EFFECT';$summary.copiedContextRefused=$true
 foreach($pair in @(@('noWarning','warningRequired'),@('cancel','cancelConsumesStage'),@('ambiguousJournal','journalUnknownConsumesStage'),@('booleanEntered','booleanEnteredRefused'),@('foreignReceipt','foreignReceiptRefused'),@('projectionDrift','projectionDriftRefused'),@('taskDrift','taskDriftRefused'),@('sourceDrift','sourceDriftTerminal'),@('peerLost','peerLossTerminal'),@('sidecarDrift','sidecarDriftRefused'),@('caseShapeDrift','shapeCaseDriftRefused'),@('bindingDrift','bindingScalarDriftRefused'))){C3-Setup;$script:c3[$pair[0]]=$true;$v=C3-Run;C3-Refused $v;$before=$script:c3.rows.Count;$v=C3-Run;C3-Refused $v;Require ($script:c3.rows.Count -eq $before) ('C3_ONCE_ONLY_'+$pair[0]);$summary[$pair[1]]=$true}
 foreach($flag in @('metaReparse','foreignOwner','aclDrift','hardLink')){C3-Setup;$script:c3[$flag]=$true;$v=C3-Run;C3-Refused $v;Require ((C3-State).terminal -and $script:c3.removed.Count -eq 0 -and $script:c3.trace -notcontains 'replace') ('C3_INTEGRITY_TERMINAL_'+$flag)};$summary.integrityDriftTerminal=$true
 C3-Setup;$script:c3.automation=$false;$v=C3-Run;C3-Refused $v;Require ($script:c3.trace -notcontains 'confirmation') 'C3_AUTOMATION_FROM_ORIGINAL_GRANT';$summary.automationApprovalRequired=$true
 foreach($throws in @($false,$true)){C3-Setup;$script:c3.expireAfter='replace';$script:c3.replaceThrows=$throws;$v=C3-Run;C3-Refused $v;$s=C3-State;$expected=if($throws){'THREW_UNKNOWN'}else{'RETURNED'};Require ($s.slots.FORWARD_REPLACE.memory -ceq $expected -and $s.slots.FORWARD_REPLACE.durable -ceq 'ENTERED' -and $script:c3.rows.FORWARD_REPLACE.outcome -ceq 'ENTERED' -and $script:c3.afterExpiry -eq 0) ('C3_MEMORY_BEFORE_POSTGUARD_'+$expected);$summary[$(if($throws){'threwRecordedBeforePostguard'}else{'returnedRecordedBeforePostguard'})]=$true};$summary.hardExpiryNoCleanup=$true
 C3-Setup;$script:c3.validatorBudget=$true;$v=C3-Run;C3-Refused $v;Require ($script:c3.validatorWait -gt 0 -and $script:c3.validatorWait -le 1000) 'C3_VALIDATOR_WAIT_CLAMPED';$summary.validatorBudgetClamped=$true
 C3-Setup;$script:c3.outcomeRefusal=$true;$v=C3-Run;C3-Refused $v;Require ((C3-State).slots.FORWARD_REPLACE.memory -ceq 'RETURNED' -and (C3-State).slots.FORWARD_REPLACE.durable -ceq 'ENTERED') 'C3_OUTCOME_REFUSAL_PRESERVES_MEMORY'
 C3-Setup;$script:c3.throwLeaf='file-flush';$v=C3-Run;C3-Refused $v;Require ($script:c3.removed.Count -eq 0 -and @($script:c3.files.Keys|Where-Object {$_ -like '*.candidate'}).Count -eq 1) 'C3_PARTIAL_CIPHER_RETAIN';$summary.partialCipherRetained=$true
 C3-Setup;$script:c3.throwLeaf='validator-start';$v=C3-Run;C3-Refused $v;Require ($script:c3.removed.Count -eq 0) 'C3_NO_UNOWNED_DELETE';$summary.cleanupOwnedOnly=$true
 }
 # The redirect data matrix uses one unchanged registered public lifetime.
 # Terminal boundary/stream expiry cases below keep independent fresh contexts.
 if($Scenario -cin @('guarded-c3','guarded-c3-http')){
 $summary.freshContextPerCase=$false;$beforeContexts=$script:c3ContextSeen.Count;$s=C3-NewHttpContext;$script:c3.trackHttpAllocations=$true;$pin=C3-PinHttpLifetime $s;Require ($script:c3ContextSeen.Count -eq $beforeContexts+1) 'C3_HTTP_ONE_MATRIX_CONTEXT';$unique=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();$closed=0
 foreach($status in 300..399){
  # Only these transport stimulus/measurement fields reset per request. URI,
  # resource, request and clock observations remain cumulative; no State reset.
  $script:c3.httpStatus=$status;$script:c3.bodyWrites=0;$script:c3.httpResponses=0;$script:c3.bodyReads=0;$script:c3.ownedRequestsCanceled=0
  if($status -gt 300){$script:c3.forward-=1;$script:c3.hard-=1}
  $resourceStart=$script:c3.resources.Count;$requestStart=$script:c3.requests.Count
  C3-ExactHttpRefusal {Invoke-OwnerProductionExerciseHttp $s 'LOGIN' 'PRIVATE_C3_HTTP_CODE_01234567890123456789'} 'ROTATION_CUTOVER_HTTP_REDIRECT'
  Require ($script:c3.bodyWrites -eq 1 -and $script:c3.httpResponses -eq 1 -and $script:c3.bodyReads -eq 0 -and $script:c3.ownedRequestsCanceled -eq 1 -and $script:c3.uris.Count -eq ($status-299) -and @($script:c3.uris|Where-Object {$_ -cne 'http://127.0.0.1:3000/api/owner-login'}).Count -eq 0) 'C3_REDIRECT_NEVER_FORWARDED'
  C3-AssertRedirectTransport $unique $resourceStart $requestStart;C3-AssertHttpLifetime $s $pin;$closed++
 }
 Require ($closed -eq 100 -and $script:c3.resources.Count -eq 200 -and $script:c3.requests.Count -eq 100 -and $script:c3.forward -eq 501 -and $script:c3.hard -eq 621) 'C3_HTTP_ONE_LIFETIME_100_REQUESTS'
 # Separate terminal sequence. Hard0 is the same raw original clock, advanced
 # between requests; neither terminal State nor original registration is reset.
 $s=C3-NewHttpContext;$script:c3.trackHttpAllocations=$true;$script:c3.httpStatus=302;$pin=C3-PinHttpLifetime $s
 C3-ExactHttpRefusal {Invoke-OwnerProductionExerciseHttp $s 'LOGIN' 'PRIVATE_C3_HTTP_CODE_01234567890123456789'} 'ROTATION_CUTOVER_HTTP_REDIRECT';C3-AssertRedirectTransport ([Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()) 0 0;C3-AssertHttpLifetime $s $pin
 $traceCount=$script:c3.trace.Count;$requestCount=$script:c3.requests.Count;$resourceCount=$script:c3.resources.Count;$clockReads=$script:c3.clockReads;$script:c3.forward=0;$script:c3.hard=0;$script:c3.expired=$true
 for($repeat=0;$repeat -lt 2;$repeat++){C3-ExactHttpRefusal {Invoke-OwnerProductionExerciseHttp $s 'LOGIN' 'PRIVATE_C3_HTTP_CODE_01234567890123456789'} 'ROTATION_CUTOVER_SCOPE_EXPIRED';C3-AssertHttpLifetime $s $pin $true;Require ($script:c3.trace.Count -eq $traceCount -and $script:c3.requests.Count -eq $requestCount -and $script:c3.resources.Count -eq $resourceCount -and $script:c3.bodyWrites -eq 1 -and $script:c3.httpResponses -eq 1 -and $script:c3.bodyReads -eq 0 -and $script:c3.afterExpiry -eq 0 -and $script:c3.forward -eq 0 -and $script:c3.hard -eq 0 -and $script:c3.clockReads -eq $clockReads+1) 'C3_HTTP_HARD0_NO_NEXT_IO_OR_RENEWAL'}
 $summary.httpLifetimeMatrix=@{requests=100;lifetimes=1;b2Migrations=1;c3Registrations=1;uniqueTransportObjects=600;perRequestCleanup=$closed;exactRedirects=100;sameAuthorityReferences=$true;unchangedOperationJournal=$true;originalClockNonrenewing=$true;hardZeroBetweenRequests=$true;hardZeroRefusals=2;nextProtectedTransportCalls=$script:c3.afterExpiry}
 foreach($unknown in @($false,$true)){$s=C3-NewHttpContext;$script:c3.httpOversize=$true;$script:c3.unknownLength=$unknown;Refused {Invoke-OwnerProductionExerciseHttp $s 'HEALTH'};Require ($script:c3.bodyReads -eq $(if($unknown){1}else{0})) 'C3_BOUNDED_RESPONSE'}
 foreach($leaf in @('http-create','http-request-stream','http-write','http-flush','http-request-dispose','http-response','http-response-stream','http-read')){foreach($when in @('pre','post')){$s=C3-NewHttpContext;if($when -ceq 'pre'){$script:c3.expireBefore=$leaf}else{$script:c3.expireAfter=$leaf};Refused {Invoke-OwnerProductionExerciseHttp $s 'LOGIN' 'PRIVATE_C3_HTTP_CODE_01234567890123456789'};Require ($script:c3.expired -and $script:c3.afterExpiry -eq 0 -and @($script:c3.resources|Where-Object {-not $_.disposed}).Count -eq 0) ('C3_STREAM_EXPIRY_'+$leaf+'_'+$when)}}
 $s=C3-NewHttpContext;$script:c3.httpBudget=$true;Refused {Invoke-OwnerProductionExerciseHttp $s 'LOGIN' 'PRIVATE_C3_HTTP_CODE_01234567890123456789'};Require ($script:c3.bodyWrites -eq 1 -and $script:c3.httpResponses -eq 0) 'C3_STREAM_BUDGET_TIGHTENS_BEFORE_RESPONSE';$summary.httpStreamBudgetClamped=$true
 $s=C3-NewHttpContext;$script:c3.throwLeaf='http-response';Refused {Invoke-OwnerProductionExerciseHttp $s 'HEALTH'};Require ($script:c3.ownedRequestsCanceled -eq 1) 'C3_OWNED_REQUEST_CANCEL'
 $summary.httpRedirectCases=100;$summary.httpStreamExpiryCases=16
 }
 $summary|ConvertTo-Json -Depth 8 -Compress;exit
}

$cases=@('forged-admission','forged-binding','success-enumerable','wrong-path','wrong-sid','wrong-logon','wrong-level','wrong-count','wrong-type','source-revoked','session-changed','clock-expired','journal-failure','prewrite-race','nonaction-tamper','post-security','post-context','throw-old','throw-new','postguard-expired','one-write','reminted-admission','parameters','vector','hash-abi','empty-envelope','journal-after-create','remint-after-prewrite','reload')
if($Scenario -eq 'native-variant'){
 Require ($env:OS -ceq 'Windows_NT') 'WINDOWS_ONLY_MEMORY'
 Initialize-OwnerProductionTaskUpdateBinding
 Add-Type @'
using System;using System.Runtime.InteropServices;
public static class OwnerProductionVariantProbe {[DllImport("oleaut32.dll")]static extern int VariantClear(IntPtr p);public static int Of(object v){IntPtr p=Marshal.AllocCoTaskMem(32);for(int n=0;n<32;n++)Marshal.WriteByte(p,n,0);try{Marshal.GetNativeVariantForObject(v,p);return Marshal.ReadInt16(p);}finally{VariantClear(p);Marshal.FreeCoTaskMem(p);}}}
'@|Out-Null
 $null=Setup 99;$packagedArguments=[OwnerProductionTaskUpdateBinding]::Arguments('JARVIS Remote Host',(New-FakeDefinition));Vector $packagedArguments;foreach($i in @(3,4,6)){Require ([OwnerProductionVariantProbe]::Of($packagedArguments[$i]) -eq 0) 'VT_EMPTY_ACTUAL_PACKAGED_ARGUMENT'}
 @{scenario=$Scenario;pass=$true;realTaskCredentialCalls=0}|ConvertTo-Json -Compress;exit
}
if($Scenario -eq 'clock-kernel-expiry'){
 $done=@();foreach($offset in @(3,1,2)){
  $record=Setup (800+$offset);$binding=Get-OwnerProductionTaskBinding -Admission $script:token;$beforeServices=$script:current.services;$beforeLookups=$script:current.lookups;$script:current.kernelExpireAt=$script:current.kernelReads+$offset
  $result=Set-OwnerProductionTaskAction -Binding $binding;Closed $result;Require ($script:current.expired -and -not $result.migrationVerified -and -not $result.registrationAttempted -and $result.failureCode -ceq 'ROTATION_CUTOVER_SCOPE_EXPIRED') 'KERNEL_CROSSED_ORIGINAL_DEADLINE';Require ($script:current.services -eq $beforeServices -and $script:current.servicesAfterExpiry -eq 0 -and $script:current.lookups -eq $beforeLookups -and $script:current.registrations -eq 0) ('ZERO_TARGET_CALLS_AFTER_KERNEL_EXPIRY_'+$offset)
  if($offset -eq 1){Require ($script:current.journals -eq 0) 'NO_JOURNAL_AFTER_KERNEL_EXPIRY'}else{Require ($script:current.journals -eq 1) 'ORIGINAL_JOURNAL_ALREADY_CONSUMED'}
  $script:current.expired=$false;$script:current.kernelExpireAt=-1;Refused {Get-OwnerProductionTaskBinding -Admission $script:token};Require ($script:current.services -eq $beforeServices) 'CLOCK_CANNOT_REVIVE_AFTER_KERNEL_EXPIRY';$done+=('kernel-boundary-'+$offset)
 }
 @{scenario=$Scenario;pass=$true;cases=$done;realTaskCredentialCalls=0}|ConvertTo-Json -Depth 5 -Compress;exit
}
if($Scenario -eq 'xml-boundary'){
 $done=@();$i=300
 foreach($stage in @('before','working','after','throw-readback')){foreach($mode in @('command','arguments','directory','id','context')){
  $i++;$record=Setup $i;$script:current.xmlMode=$mode;$script:current.xmlStage=$(if($stage -eq 'throw-readback'){'after'}else{$stage})
  if($stage -eq 'before'){
   $raw=(New-FakeDefinition).XmlText;$x=[xml]$raw;$ns=[Xml.XmlNamespaceManager]::new($x.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');foreach($field in @('Command','Arguments','WorkingDirectory')){$x.SelectSingleNode(('/t:Task/t:Actions/t:Exec/t:'+$field),$ns).InnerText=''};$record.originalTask.expectedComSnapshotSha256=ComSnapshotHash $raw $script:current.security;$record.originalTask.definitionSha256=Digest $raw;$record.originalTask.envelopeSha256=Digest $x.OuterXml
   Refused {Get-OwnerProductionTaskBinding -Admission $script:token};Require ($script:current.registrations -eq 0) 'XML_BASELINE_COHERENCE'
  }else{
   $binding=Get-OwnerProductionTaskBinding -Admission $script:token;if($stage -eq 'throw-readback'){$script:current.throw='new'};$result=Set-OwnerProductionTaskAction -Binding $binding;Closed $result;Require (-not $result.migrationVerified -and $result.observedState -cne 'KNOWN_TARGET') ('XML_COHERENCE_'+$stage+'_'+$mode)
   if($stage -eq 'working'){Require ($script:current.registrations -eq 0) 'NO_REGISTER_INCOHERENT_WORKING_DEFINITION'}else{Require ($script:current.registrations -eq 1) 'POST_REGISTER_COHERENCE';if($stage -eq 'throw-readback'){Require ($result.callState -ceq 'THREW') 'THREW_NOT_KNOWN_TARGET'}}
  };$done+=($stage+'-'+$mode)
 }}
 foreach($mode in @('attribute','nested','duplicate','namespace')){
  $i++;$record=Setup $i;$script:current.xmlMode=$mode;$script:current.xmlStage='before';$raw=(New-FakeDefinition).XmlText;$x=[xml]$raw;$ns=[Xml.XmlNamespaceManager]::new($x.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');foreach($field in @('Command','Arguments','WorkingDirectory')){foreach($node in $x.SelectNodes(('/t:Task/t:Actions/t:Exec/t:'+$field),$ns)){$node.InnerText=''}};$record.originalTask.expectedComSnapshotSha256=ComSnapshotHash $raw $script:current.security;$record.originalTask.definitionSha256=Digest $raw;$record.originalTask.envelopeSha256=Digest $x.OuterXml;Refused {Get-OwnerProductionTaskBinding -Admission $script:token};Require ($script:current.registrations -eq 0) 'XML_LEAF_STRUCTURE';$done+=('structure-'+$mode)
 }
 @{scenario=$Scenario;pass=$true;cases=$done;realTaskCredentialCalls=0}|ConvertTo-Json -Depth 5 -Compress;exit
}
if($Scenario -eq 'clock-boundary'){
 $bad=@(
  @{name='nan';forward=[double]::NaN;hard=[double]::NaN},@{name='infinity';forward=[double]::PositiveInfinity;hard=[double]::PositiveInfinity},@{name='negative-infinity';forward=[double]::NegativeInfinity;hard=720},
  @{name='bool';forward=$true;hard=720},@{name='string';forward='600';hard=720},@{name='null';forward=$null;hard=720},@{name='array';forward=@(600);hard=720},
  @{name='zero';forward=0;hard=720},@{name='negative';forward=-1;hard=720},@{name='unordered';forward=721;hard=720},@{name='increase';forward=601;hard=721},@{name='over-original-cap';forward=781;hard=901},
  @{name='reserve';forward=610;hard=720},@{name='changed-hard-end';forward=600;hard=720;end='2026-11-06T20:01:00.000Z'},@{name='malformed-hard-end';forward=600;hard=720;end='tomorrow'},@{name='extra';forward=600;hard=720;extra=$true}
 )
 $i=100;foreach($case in $bad){$i++;$record=Setup $i;$binding=Get-OwnerProductionTaskBinding -Admission $script:token;$before=$script:current.services;$kernelBefore=$script:current.kernelReads;$clock=@{remainingForwardSeconds=$case.forward;remainingHardSeconds=$case.hard;hardEndUtc='2026-11-06T20:00:00.000Z'};if($case.ContainsKey('end')){$clock.hardEndUtc=$case.end};if($case.ContainsKey('extra')){$clock.extra=$true};$script:current.clockOverride=$clock;$result=Set-OwnerProductionTaskAction -Binding $binding;Closed $result;Require (-not $result.migrationVerified -and -not $result.registrationAttempted -and $script:current.registrations -eq 0 -and $script:current.services -eq $before) ('INVALID_CLOCK_REFUSED_'+$case.name);Require ($script:current.kernelReads -eq $kernelBefore) 'NO_KERNEL_READ_AFTER_INVALID_CLOCK';$script:current.clockOverride=$null;Refused {Get-OwnerProductionTaskBinding -Admission $script:token};Require ($script:current.services -eq $before) 'INVALID_CLOCK_NOT_REVIVED';Require ($script:current.kernelReads -eq $kernelBefore) 'NO_KERNEL_READ_AFTER_CLOCK_REFUSAL'}
 @{scenario=$Scenario;pass=$true;cases=@($bad|ForEach-Object {$_.name});realTaskCredentialCalls=0}|ConvertTo-Json -Depth 5 -Compress;exit
}
if($Scenario -eq 'journal-boundary'){
 $bad=@(@{name='false';value=$false},@{name='true';value=$true},@{name='number';value=1},@{name='string';value='confirmed'},@{name='null';value=$null},@{name='array';value=@([object]::new())},@{name='forged-object';value=[object]::new()},@{name='flags-object';value=[pscustomobject]@{confirmed=$true}},@{name='wrong-journal';mismatch='journal'},@{name='wrong-attempt';mismatch='attempt'},@{name='wrong-clock';mismatch='clock'},@{name='wrong-fingerprint';mismatch='fingerprint'})
 $i=200;foreach($case in $bad){$i++;$record=Setup $i;$binding=Get-OwnerProductionTaskBinding -Admission $script:token;$before=$script:current.services;if($case.ContainsKey('mismatch')){$script:current.receiptMismatch=$case.mismatch}else{$script:current.receiptOverrideEnabled=$true;$script:current.receiptOverride=$case.value};$result=Set-OwnerProductionTaskAction -Binding $binding;Closed $result;Require (-not $result.migrationVerified -and -not $result.registrationAttempted -and $script:current.registrations -eq 0 -and $script:current.services -eq $before -and $script:current.journals -eq 1) ('UNCONFIRMED_JOURNAL_REFUSED_'+$case.name);$script:current.receiptOverrideEnabled=$false;$script:current.receiptMismatch='';$new=[object]::new();[void]$script:issuer.Add(@{token=$new;record=$record});$again=Set-OwnerProductionTaskAction -Binding (Get-OwnerProductionTaskBinding -Admission $new);Closed $again;Require (-not $again.migrationVerified -and $script:current.registrations -eq 0 -and $script:current.journals -eq 1 -and $script:current.services -eq $before) 'UNKNOWN_JOURNAL_NO_RETRY_AFTER_REMINT'}
 @{scenario=$Scenario;pass=$true;cases=@($bad|ForEach-Object {$_.name});realTaskCredentialCalls=0}|ConvertTo-Json -Depth 5 -Compress;exit
}
$index=1
foreach($name in $cases){
 $index++;$record=Setup $index
 if($name -eq 'forged-admission'){Refused {Get-OwnerProductionTaskBinding -Admission ([pscustomobject]$record)};Require ($script:current.services -eq 0) 'FORGED_NO_COM';continue}
 if($name -eq 'parameters'){
  foreach($pair in @(@('Get-OwnerProductionTaskBinding','Admission'),@('Set-OwnerProductionTaskAction','Binding'))){$p=@((Get-Command $pair[0]).Parameters.Keys|Where-Object {$_ -notin @('Verbose','Debug','ErrorAction','WarningAction','InformationAction','ProgressAction','ErrorVariable','WarningVariable','InformationVariable','OutVariable','OutBuffer','PipelineVariable')});Require ($p.Count -eq 1 -and $p[0] -ceq $pair[1]) 'NO_GENERIC_PARAMETERS'};continue
 }
 if($name -eq 'vector'){Initialize-OwnerProductionTaskUpdateBinding;Vector ([OwnerProductionTaskUpdateBinding]::Arguments('JARVIS Remote Host',(New-FakeDefinition)));continue}
 if($name -eq 'hash-abi'){$raw=(New-FakeDefinition).XmlText;Require ((Get-OwnerProductionComSnapshotHash -XmlText $raw -SecurityDescriptor $script:current.security) -ceq $record.originalTask.expectedComSnapshotSha256) 'COM_ABI';Require ((Get-OwnerProductionComSnapshotHash -XmlText ($raw+' ') -SecurityDescriptor $script:current.security) -cne $record.originalTask.expectedComSnapshotSha256) 'EXACT_RAW_XML';Refused {Get-OwnerProductionComSnapshotHash -XmlText $null -SecurityDescriptor $script:current.security};Require ((Get-OwnerProductionComSnapshotHash -XmlText 'a' -SecurityDescriptor 'bc') -cne (Get-OwnerProductionComSnapshotHash -XmlText 'ab' -SecurityDescriptor 'c')) 'LENGTH_PREFIX_COLLISION';continue}
 switch($name){'wrong-path'{$script:current.path='\OTHER\JARVIS Remote Host'}'wrong-sid'{$script:current.sid='S-1-5-21-111-222-333-555'}'wrong-logon'{$script:current.logon=2}'wrong-level'{$script:current.level=1}'wrong-count'{$script:current.count=2}'wrong-type'{$script:current.type=5}}
 if($name -like 'wrong-*'){Refused {Get-OwnerProductionTaskBinding -Admission $script:token};Require ($script:current.registrations -eq 0) 'BAD_BASELINE_NO_UPDATE';continue}
 if($name -eq 'empty-envelope'){$script:current.id='';$script:current.context='';$raw=(New-FakeDefinition).XmlText;$x=[xml]$raw;$ns=[Xml.XmlNamespaceManager]::new($x.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');foreach($field in @('Command','Arguments','WorkingDirectory')){$x.SelectSingleNode(('/t:Task/t:Actions/t:Exec/t:'+$field),$ns).InnerText=''};$record.originalTask=@{comSnapshotProfile='goriq-fixed-owner-task-com-snapshot-v1';expectedComSnapshotSha256=(ComSnapshotHash $raw $script:current.security);definitionSha256=(Digest $raw);envelopeSha256=(Digest $x.OuterXml);securitySha256=(Digest $script:current.security);actionId='';actionsContext=''}}
 $binding=Get-OwnerProductionTaskBinding -Admission $script:token;$beforeServices=$script:current.services;$beforeLookups=$script:current.lookups
 if($name -eq 'forged-binding'){$result=Set-OwnerProductionTaskAction -Binding ([pscustomobject]@{valid=$true;sourceVerified=$true});Closed $result;Require (-not $result.migrationVerified -and $script:current.registrations -eq 0) 'FORGED_BINDING_REFUSED';continue}
 switch($name){'source-revoked'{$script:current.revoked=$true}'session-changed'{$script:current.session=2}'clock-expired'{$script:current.expired=$true}'journal-failure'{$script:current.journalFailure=$true}'journal-after-create'{$script:current.journalAfterThrow=$true}'remint-after-prewrite'{$script:current.tamper=$true}'prewrite-race'{$script:current.raceAt=$script:current.lookups+2}'nonaction-tamper'{$script:current.tamper=$true}'post-security'{$script:current.postSecurity=$true}'post-context'{$script:current.postContext=$true}'throw-old'{$script:current.throw='old'}'throw-new'{$script:current.throw='new'}'postguard-expired'{$script:current.late=$true}}
 $result=Set-OwnerProductionTaskAction -Binding $binding;Closed $result
 if($name -in @('journal-after-create','remint-after-prewrite')){Require (-not $result.migrationVerified -and $script:current.registrations -eq 0 -and $script:current.journals -eq 1) 'FAILED_EFFECT_SLOT_CONSUMED';$script:current.tamper=$false;$script:current.journalAfterThrow=$false;$new=[object]::new();[void]$script:issuer.Add(@{token=$new;record=$record});$same=Get-OwnerProductionTaskBinding -Admission $new;$again=Set-OwnerProductionTaskAction -Binding $same;Closed $again;Require (-not $again.migrationVerified -and $script:current.registrations -eq 0 -and $script:current.journals -eq 1) 'REMINT_NO_RETRY_AFTER_PREWRITE_FAILURE';continue}
 if($name -in @('source-revoked','session-changed','clock-expired','journal-failure')){Require (-not $result.migrationVerified -and $script:current.registrations -eq 0 -and $script:current.services -eq $beforeServices) 'AUTHORITY_JOURNAL_BEFORE_COM';continue}
 if($name -in @('prewrite-race','nonaction-tamper')){Require (-not $result.migrationVerified -and $script:current.registrations -eq 0) 'BEFORE_UPDATE_REFUSAL';continue}
 Require ($script:current.registrations -eq 1 -and $script:current.journals -eq 1) 'ONE_EFFECT';Vector $script:current.vector
 if($name -in @('post-security','post-context')){Require (-not $result.migrationVerified -and $result.observedState -eq 'DIVERGED') 'POST_STATE_REFUSAL';continue}
 if($name -like 'throw-*'){Require (-not $result.migrationVerified -and $result.callState -eq 'THREW' -and $result.observedState -eq $(if($name -eq 'throw-old'){'OLD_LEGACY'}else{'KNOWN_TARGET'})) 'THROW_RECONCILE_NOT_PASS';continue}
 if($name -eq 'postguard-expired'){Require (-not $result.migrationVerified -and $result.callState -eq 'RETURNED' -and $result.observedState -eq 'UNKNOWN' -and $script:current.lookups -eq ($beforeLookups+2)) 'NO_READBACK_AFTER_DEADLINE';continue}
 Require ($result.migrationVerified -and $result.callState -eq 'RETURNED' -and $result.observedState -eq 'KNOWN_TARGET') 'KNOWN_TARGET_VERIFIED';Require ($script:current.id -ceq $record.originalTask.actionId -and $script:current.context -ceq $record.originalTask.actionsContext -and [OwnerProductionFixtureTrace]::Enumerations -eq 0) 'ENVELOPE_AND_COLLECTION_PRESERVED'
 if($name -eq 'reload'){Refused {. $helper};$again=Set-OwnerProductionTaskAction -Binding $binding;Closed $again;Require (-not $again.migrationVerified -and $script:current.registrations -eq 1 -and $script:current.journals -eq 1) 'RELOAD_NO_STATE_RESET'}
 if($name -eq 'reminted-admission'){$new=[object]::new();[void]$script:issuer.Add(@{token=$new;record=$record});$binding=Get-OwnerProductionTaskBinding -Admission $new}
 if($name -in @('one-write','reminted-admission')){$again=Set-OwnerProductionTaskAction -Binding $binding;Closed $again;Require (-not $again.migrationVerified -and $script:current.registrations -eq 1 -and $script:current.journals -eq 1) 'NO_REISSUED_ATTEMPT'}
}
@{scenario='matrix';pass=$true;cases=$cases;unwiredAdmissionRefused=$true;realTaskCredentialCalls=0}|ConvertTo-Json -Depth 5 -Compress
