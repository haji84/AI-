param([ValidateSet('state-single','update-restore','zero-actions','multiple-actions','com-memory')][string]$Scenario)
$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-task-credential-retention-proof-1218.ps1')
function Require([bool]$Value,[string]$Code){if(-not $Value){throw ('COLLECTION_'+$Code)}}
function New-CollectionBudget {
 $now=[datetimeoffset]::Parse('2026-11-06T05:00:00Z')
 $b=New-R05ProofBudget -ScopeExpiry $now.AddHours(1) -JobDeadline $now.AddSeconds(660) -UtcClock {$now}.GetNewClosure() -MonoClock {[double]0}
 $b.Diagnostics=New-R05Diagnostics;return $b
}
$nonce='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$owned=@{nonce=$nonce;taskName=('Goriq-R05-CredentialRetention-'+$nonce);sid='S-1-5-21-111-222-333-444'}
$baseAction=[pscustomobject]@{Execute='C:\PUBLIC\base.exe';Arguments='PUBLIC_BASE_ARGS';WorkingDirectory='C:\PUBLIC'}
$changedAction=[pscustomobject]@{Execute='C:\PUBLIC\changed.exe';Arguments='PUBLIC_CHANGED_ARGS';WorkingDirectory='C:\PUBLIC\changed'}
if($Scenario -eq 'com-memory'){
 Require ($env:OS -ceq 'Windows_NT' -and $env:GITHUB_ACTIONS -ceq 'true' -and $env:RUNNER_ENVIRONMENT -ceq 'github-hosted') 'HOSTED_MEMORY_GATE'
 $service=$null;$definition=$null;$principal=$null;$actions=$null;$exec=$null
 try{
  $service=New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $definition=$service.NewTask(0)
  $principal=$definition.Principal;$principal.Id='PUBLIC_CONTEXT';$principal.UserId=$owned.sid;$principal.LogonType=1;$principal.RunLevel=0
  $actions=$definition.Actions;$actions.Context='PUBLIC_CONTEXT'
  $exec=$actions.Create(0);$exec.Id='PUBLIC_ACTION_ID';$exec.Path=$baseAction.Execute;$exec.Arguments=$baseAction.Arguments;$exec.WorkingDirectory=$baseAction.WorkingDirectory
  # The task definition is real COM memory. Only the unregistered task's
  # unavailable registered-path/security boundary is an inert wrapper.
  $registered=[pscustomobject]@{Path=('\'+$owned.taskName);Definition=$definition}
  $registered|Add-Member ScriptMethod GetSecurityDescriptor {param($bits)if($bits -ne 7){throw 'COLLECTION_SECURITY_BITS'};return 'PUBLIC_FIXED_SECURITY'}
  $budget=New-CollectionBudget
  foreach($operation in @('TASK_ACTION_UPDATE','TASK_ACTION_RESTORE')){
   $state=Get-R05TaskUpdateState $registered $owned.taskName $owned.sid $budget $operation
   Require ($state.id -ceq 'PUBLIC_ACTION_ID' -and $state.context -ceq 'PUBLIC_CONTEXT') 'COM_ID_CONTEXT_PRESERVED'
   Require ($state.execute -ceq $baseAction.Execute -and $state.arguments -ceq $baseAction.Arguments -and $state.workingDirectory -ceq $baseAction.WorkingDirectory) 'COM_ACTION_FIELDS_PRESERVED'
   Require ($state.definition.Actions.Count -eq 1 -and $state.definition.Actions.Item(1).Id -ceq 'PUBLIC_ACTION_ID' -and $state.definition.Triggers.Count -eq 0) 'COM_COLLECTION_AND_NO_TRIGGERS'
  }
 }finally{
  foreach($handle in @($exec,$actions,$principal,$definition,$service)){
   if($null -ne $handle -and [Runtime.InteropServices.Marshal]::IsComObject($handle)){$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($handle)}
  }
 }
}else{
 # Real IEnumerable shape, retained by typed constructor/field assignment.
 # Enumeration is observable; it is never needed to read Count/Item/Context.
 Add-Type @'
using System;
using System.Collections;
using System.Security;
public static class R05CollectionTrace {
 public static int Enumerations, Counts, Items, Contexts, Registrations;
 public static void Clear(){Enumerations=Counts=Items=Contexts=Registrations=0;}
}
public class R05CollectionExec {
 public string Path, Arguments, WorkingDirectory, Id="PUBLIC_ACTION_ID";
 public int Type=0;
 public R05CollectionExec(string path,string args,string dir){Path=path;Arguments=args;WorkingDirectory=dir;}
}
public class R05EnumerableActions:IEnumerable {
 public R05CollectionExec[] Values;
 public R05EnumerableActions(int count,string path,string args,string dir){
  Values=new R05CollectionExec[count];for(int i=0;i<count;i++)Values[i]=new R05CollectionExec(path,args,dir);
 }
 public int Count {get{R05CollectionTrace.Counts++;return Values.Length;}}
 public string Context {get{R05CollectionTrace.Contexts++;return "PUBLIC_CONTEXT";}}
 public object Item(int index){R05CollectionTrace.Items++;return Values[index-1];}
 public IEnumerator GetEnumerator(){R05CollectionTrace.Enumerations++;return Values.GetEnumerator();}
}
public class R05CollectionPrincipal {
 public string UserId="S-1-5-21-111-222-333-444";public int LogonType=1,RunLevel=0;
}
public class R05CollectionDefinition {
 public R05CollectionPrincipal Principal=new R05CollectionPrincipal();
 public R05EnumerableActions Actions;
 public R05CollectionDefinition(int count,string path,string args,string dir){Actions=new R05EnumerableActions(count,path,args,dir);}
 public string XmlText {get{
  string xml="<Task xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\"><Principals><Principal><UserId>S-1-5-21-111-222-333-444</UserId><LogonType>Password</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><Description>PUBLIC_SETTING</Description></Settings><Actions Context=\"PUBLIC_CONTEXT\">";
  foreach(R05CollectionExec a in Actions.Values)xml+="<Exec id=\""+SecurityElement.Escape(a.Id)+"\"><Command>"+SecurityElement.Escape(a.Path)+"</Command><Arguments>"+SecurityElement.Escape(a.Arguments)+"</Arguments><WorkingDirectory>"+SecurityElement.Escape(a.WorkingDirectory)+"</WorkingDirectory></Exec>";
  return xml+"</Actions></Task>";
 }}
}
public class R05CollectionRegistered {
 public string Path="\\Goriq-R05-CredentialRetention-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
 public R05CollectionDefinition Definition;
 public R05CollectionRegistered(R05CollectionDefinition definition){Definition=definition;}
 public string GetSecurityDescriptor(int bits){if(bits!=7)throw new Exception("COLLECTION_SECURITY_BITS");return "PUBLIC_FIXED_SECURITY";}
}
public delegate object R05CollectionRegister(object[] args);
public class R05CollectionFolder {
 public Func<string,object> Lookup;public R05CollectionRegister Register;
 public object GetTask(string name){return Lookup(name);}
 public object RegisterTaskDefinition(string name,object definition,int flags,object user,object password,int logon,object sddl){R05CollectionTrace.Registrations++;return Register(new object[]{name,definition,flags,user,password,logon,sddl});}
}
public class R05CollectionService {
 public R05CollectionFolder Folder;
 public void Connect(){}
 public object GetFolder(string path){if(path!="\\")throw new Exception("COLLECTION_ROOT");return Folder;}
}
'@
 $script:stored=$baseAction;$script:count=1
 if($Scenario -eq 'zero-actions'){$script:count=0}
 if($Scenario -eq 'multiple-actions'){$script:count=2}
 function New-CollectionRegistered {
  $definition=[R05CollectionDefinition]::new($script:count,$script:stored.Execute,$script:stored.Arguments,$script:stored.WorkingDirectory)
  return [R05CollectionRegistered]::new($definition)
 }
 $folder=[R05CollectionFolder]::new()
 $folder.Lookup=[System.Func[string,object]]{param($name)Require ($name -ceq $owned.taskName) 'LOOKUP_ONLY_OWN_NAME';New-CollectionRegistered}
 $folder.Register=[R05CollectionRegister]{param($values)
  Require ($values.Count -eq 7 -and $values[0] -ceq $owned.taskName -and $values[2] -eq 52 -and $null -eq $values[3] -and $null -eq $values[4] -and $values[5] -eq 0 -and $null -eq $values[6]) 'UPDATE_ONLY_NO_CREDENTIAL_ARGUMENTS'
  $d=$values[1];$a=$d.Actions.Values[0]
  Require ($d.Actions.Values.Length -eq 1 -and $a.Id -ceq 'PUBLIC_ACTION_ID' -and $d.Principal.UserId -ceq $owned.sid -and $d.Principal.LogonType -eq 1 -and $d.Principal.RunLevel -eq 0) 'REGISTER_BOUNDARIES_PRESERVED'
  $script:stored=[pscustomobject]@{Execute=$a.Path;Arguments=$a.Arguments;WorkingDirectory=$a.WorkingDirectory}
  New-CollectionRegistered
 }
 $script:service=[R05CollectionService]::new();$script:service.Folder=$folder
 function New-R05TaskUpdateService {return $script:service}
 $budget=New-CollectionBudget
 [R05CollectionTrace]::Clear()
 if($Scenario -eq 'state-single'){
  $registered=New-CollectionRegistered
  Require ($registered.Definition.Actions -is [R05EnumerableActions]) 'SETUP_RETAINS_COLLECTION'
  $state=Get-R05TaskUpdateState $registered $owned.taskName $owned.sid $budget TASK_ACTION_UPDATE
  Require ($state.id -ceq 'PUBLIC_ACTION_ID' -and $state.context -ceq 'PUBLIC_CONTEXT' -and $state.execute -ceq $baseAction.Execute -and $state.arguments -ceq $baseAction.Arguments -and $state.workingDirectory -ceq $baseAction.WorkingDirectory) 'STATE_FIELDS_PRESERVED'
  Require ([object]::ReferenceEquals($state.definition.Actions,$registered.Definition.Actions) -and [object]::ReferenceEquals($state.exec,$registered.Definition.Actions.Values[0])) 'COLLECTION_AND_ITEM_IDENTITY'
  Require ([R05CollectionTrace]::Counts -eq 1 -and [R05CollectionTrace]::Items -eq 1 -and [R05CollectionTrace]::Contexts -eq 1 -and [R05CollectionTrace]::Registrations -eq 0) 'COLLECTION_MEMBERS_READ_WITHOUT_REGISTRATION'
 }elseif($Scenario -eq 'update-restore'){
  Set-R05OwnedTaskAction -Owned $owned -Action $changedAction -Budget $budget -Operation TASK_ACTION_UPDATE
  Require ([R05CollectionTrace]::Registrations -eq 1 -and $script:stored.Execute -ceq $changedAction.Execute -and $script:stored.Arguments -ceq $changedAction.Arguments -and $script:stored.WorkingDirectory -ceq $changedAction.WorkingDirectory) 'FORWARD_THREE_FIELDS'
  Set-R05OwnedTaskAction -Owned $owned -Action $baseAction -Budget $budget -Operation TASK_ACTION_RESTORE
  Require ([R05CollectionTrace]::Registrations -eq 2 -and $script:stored.Execute -ceq $baseAction.Execute -and $script:stored.Arguments -ceq $baseAction.Arguments -and $script:stored.WorkingDirectory -ceq $baseAction.WorkingDirectory) 'REVERSE_THREE_FIELDS'
  Require ([R05CollectionTrace]::Counts -eq 6 -and [R05CollectionTrace]::Items -eq 6 -and [R05CollectionTrace]::Contexts -eq 6) 'ALL_SIX_STATE_READS_KEEP_COLLECTION'
 }else{
  $caught=$null
  try{Get-R05TaskUpdateState (New-CollectionRegistered) $owned.taskName $owned.sid $budget TASK_ACTION_UPDATE|Out-Null}catch{$caught=$_}
  Require ($null -ne $caught -and $caught.Exception.Message -ceq 'PROOF_TASK_BOUNDARY_CHANGED') 'STATE_REJECTS_ACTION_COUNT_AT_KNOWN_BOUNDARY'
  $caught=$null
  try{Set-R05OwnedTaskAction -Owned $owned -Action $changedAction -Budget $budget -Operation TASK_ACTION_UPDATE}catch{$caught=$_}
  Require ($null -ne $caught -and $caught.Exception.Message -ceq 'PROOF_TASK_BOUNDARY_CHANGED') 'UPDATER_REJECTS_ACTION_COUNT_AT_KNOWN_BOUNDARY'
  Require ([R05CollectionTrace]::Counts -eq 2 -and [R05CollectionTrace]::Items -eq 0 -and [R05CollectionTrace]::Contexts -eq 0 -and [R05CollectionTrace]::Registrations -eq 0 -and $script:stored.Execute -ceq $baseAction.Execute) 'BAD_COUNT_NO_ITEM_OR_REGISTER'
 }
 Require ([R05CollectionTrace]::Enumerations -eq 0) 'COLLECTION_NEVER_ENUMERATED'
}
@{scenario=$Scenario;pass=$true;realTaskRegistrationCalls=0;realCredentialCalls=0}|ConvertTo-Json -Compress
