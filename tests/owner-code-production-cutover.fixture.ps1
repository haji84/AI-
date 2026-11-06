param([ValidateSet('matrix','native-variant','preloaded-type','clock-boundary','journal-boundary','xml-boundary','clock-kernel-expiry')][string]$Scenario='matrix')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
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
if($Scenario -eq 'preloaded-type'){Add-Type 'public class OwnerProductionTaskUpdateBinding {}'|Out-Null;$refused=$false;try{Initialize-OwnerProductionTaskUpdateBinding}catch{$refused=$true};Require $refused 'UNEXPECTED_TYPE_REFUSED';@{scenario=$Scenario;pass=$true;realTaskCredentialCalls=0}|ConvertTo-Json -Compress;exit}
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
