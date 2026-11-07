[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Source-only adapter. Genuine native admission/clock/journal providers are
# deliberately unavailable until the complete reviewed entry is connected.
if(Get-Variable -Name OwnerProductionHelperState -Scope Script -ErrorAction SilentlyContinue){throw 'ROTATION_CUTOVER_RELOAD_REFUSED'}
$script:OwnerProductionHelperState=@{bindings=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();attempts=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();typeReady=$false;clocks=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()}
function Resolve-OwnerProductionNativeAdmission($Admission){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
function Get-OwnerProductionKernelObservation {throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
function Get-OwnerProductionClockState($Identity){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
function New-OwnerProductionTaskWriteahead($Identity,$Snapshot,$Target){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
function Resolve-OwnerProductionTaskWriteahead($Receipt){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
function New-OwnerProductionTaskService {New-Object -ComObject 'Schedule.Service'}
function Get-OwnerProductionDigest([string]$Text){$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash([Text.UTF8Encoding]::new($false,$true).GetBytes($Text)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Get-OwnerProductionComSnapshotHash {
 param([object]$XmlText,[object]$SecurityDescriptor)
 if($XmlText -isnot [string] -or [string]::IsNullOrWhiteSpace($XmlText) -or $SecurityDescriptor -isnot [string] -or [string]::IsNullOrWhiteSpace($SecurityDescriptor)){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 $stream=[IO.MemoryStream]::new();$writer=[IO.BinaryWriter]::new($stream,[Text.UTF8Encoding]::new($false,$true));$hash=[Security.Cryptography.SHA256]::Create()
 try{foreach($part in @('GORIQ:1218:task-com-snapshot:v1','\','JARVIS Remote Host',$XmlText,$SecurityDescriptor)){$bytes=[Text.UTF8Encoding]::new($false,$true).GetBytes($part);$writer.Write([uint32]$bytes.Length);$writer.Write($bytes)};$writer.Flush();return ([BitConverter]::ToString($hash.ComputeHash($stream.ToArray()))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose();$writer.Dispose();$stream.Dispose()}
}
function Assert-OwnerProductionShape($Value,[string[]]$Expected){
 if($null -eq $Value){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
 $keys=if($Value -is [Collections.IDictionary]){@($Value.Keys)}else{@($Value.PSObject.Properties.Name)}
 if($keys.Count -ne $Expected.Count){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
 foreach($key in $Expected){if($keys -cnotcontains $key){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}}
}
function Test-OwnerProductionFiniteNumber($Value){
 if($Value -isnot [byte] -and $Value -isnot [sbyte] -and $Value -isnot [int16] -and $Value -isnot [uint16] -and $Value -isnot [int] -and $Value -isnot [uint32] -and $Value -isnot [long] -and $Value -isnot [uint64] -and $Value -isnot [single] -and $Value -isnot [double] -and $Value -isnot [decimal]){return $false}
 return (-not [double]::IsNaN([double]$Value) -and -not [double]::IsInfinity([double]$Value))
}
function Assert-OwnerProductionClock($Identity){
 $observation=$null
 if(-not $script:OwnerProductionHelperState.clocks.TryGetValue($Identity,[ref]$observation)){$observation=@{initialized=$false;invalid=$false;hardEndUtc=$null;forward=0.0;hard=0.0};$script:OwnerProductionHelperState.clocks.Add($Identity,$observation)}
 if($observation.invalid){throw 'ROTATION_CUTOVER_SCOPE_EXPIRED'}
 try{
  $clock=Get-OwnerProductionClockState $Identity
  Assert-OwnerProductionShape $clock @('remainingForwardSeconds','remainingHardSeconds','hardEndUtc')
  if(-not (Test-OwnerProductionFiniteNumber $clock.remainingForwardSeconds) -or -not (Test-OwnerProductionFiniteNumber $clock.remainingHardSeconds) -or $clock.hardEndUtc -isnot [string]){throw 'INVALID_CLOCK'}
  $forward=[double]$clock.remainingForwardSeconds;$hard=[double]$clock.remainingHardSeconds;$end=[datetime]::MinValue
  if($forward -le 0 -or $hard -gt 900 -or $hard -lt ($forward+120) -or -not [datetime]::TryParseExact($clock.hardEndUtc,'yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal,[ref]$end)){throw 'INVALID_CLOCK'}
  if($observation.initialized -and ($clock.hardEndUtc -cne $observation.hardEndUtc -or $forward -gt $observation.forward -or $hard -gt $observation.hard)){throw 'INVALID_CLOCK'}
  $observation.initialized=$true;$observation.hardEndUtc=$clock.hardEndUtc;$observation.forward=$forward;$observation.hard=$hard
 }catch{$observation.invalid=$true;throw 'ROTATION_CUTOVER_SCOPE_EXPIRED'}
}
function Assert-OwnerProductionWriteahead($State,$Receipt){
 if($null -eq $Receipt -or $Receipt -is [string] -or $Receipt -is [Collections.IEnumerable] -or $Receipt.GetType().IsValueType){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
 $verified=Resolve-OwnerProductionTaskWriteahead $Receipt
 Assert-OwnerProductionShape $verified @('receiptIdentity','journalIdentity','attemptIdentity','originalClockIdentity','admissionFingerprint')
 foreach($pair in @(@($verified.receiptIdentity,$Receipt),@($verified.journalIdentity,$State.identities.journalIdentity),@($verified.attemptIdentity,$State.identities.attemptIdentity),@($verified.originalClockIdentity,$State.identities.originalClockIdentity))){if(-not [object]::ReferenceEquals($pair[0],$pair[1])){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}}
 if($verified.admissionFingerprint -isnot [string] -or $verified.admissionFingerprint -cne $State.fingerprint){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
}
function Get-OwnerProductionResolvedAdmission($Admission){
 $a=Resolve-OwnerProductionNativeAdmission $Admission
 Assert-OwnerProductionShape $a @('profile','sourceRevision','sourceClosureSha256','originalGrantSha256','attemptId','ownerSid','sessionId','processId','attemptIdentity','originalTask','target','proofEvidenceIdentity','originalClockIdentity','journalIdentity','recoveryWitnessIdentity','preservationSessionIdentity')
 if($a.profile -cne 'jarvis-owner-production-cutover-v1' -or $a.sourceRevision -isnot [string] -or $a.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $a.ownerSid -isnot [string] -or $a.ownerSid -cnotmatch '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$' -or $a.attemptId -isnot [string] -or $a.attemptId -cnotmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or $a.processId -isnot [int] -or $a.processId -ne $PID -or $a.sessionId -isnot [int] -or $a.sessionId -le 0){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
 foreach($key in @('sourceClosureSha256','originalGrantSha256')){if($a.$key -isnot [string] -or $a.$key -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}}
 foreach($key in @('attemptIdentity','proofEvidenceIdentity','originalClockIdentity','journalIdentity','recoveryWitnessIdentity','preservationSessionIdentity')){if($null -eq $a.$key -or $a.$key -is [bool] -or $a.$key -is [string] -or $a.$key.GetType().IsValueType){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}}
 Assert-OwnerProductionShape $a.originalTask @('comSnapshotProfile','expectedComSnapshotSha256','definitionSha256','envelopeSha256','securitySha256','actionId','actionsContext')
 if($a.originalTask.comSnapshotProfile -cne 'goriq-fixed-owner-task-com-snapshot-v1'){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
 foreach($key in @('expectedComSnapshotSha256','definitionSha256','envelopeSha256','securitySha256')){if($a.originalTask.$key -isnot [string] -or $a.originalTask.$key -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}}
 foreach($key in @('actionId','actionsContext')){if($a.originalTask.$key -isnot [string]){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}}
 Assert-OwnerProductionShape $a.target @('execute','arguments','workingDirectory','nodeSha256','hostSha256')
 foreach($key in @('execute','arguments','workingDirectory')){if($a.target.$key -isnot [string] -or [string]::IsNullOrWhiteSpace($a.target.$key) -or $a.target.$key -match '[\r\n\x00]'){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}}
 foreach($key in @('nodeSha256','hostSha256')){if($a.target.$key -isnot [string] -or $a.target.$key -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}}
 if($a.target.execute -cnotmatch '^[A-Za-z]:\\[^:]+$' -or $a.target.workingDirectory -cnotmatch '^[A-Za-z]:\\[^:]+$' -or $a.target.arguments -cne ('"'+$a.target.workingDirectory.TrimEnd([char]'\')+'\scripts\jarvis-remote-host.mjs"')){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
 Assert-OwnerProductionClock $a.originalClockIdentity
 $kernel=Get-OwnerProductionKernelObservation
 if($kernel.ownerSid -cne $a.ownerSid -or $kernel.sessionId -ne $a.sessionId -or $kernel.processId -ne $PID){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
 Assert-OwnerProductionClock $a.originalClockIdentity
 return $a
}
function Get-OwnerProductionAdmissionFingerprint($a){
 $parts=[ordered]@{profile=$a.profile;sourceRevision=$a.sourceRevision;sourceClosureSha256=$a.sourceClosureSha256;originalGrantSha256=$a.originalGrantSha256;attemptId=$a.attemptId;ownerSid=$a.ownerSid;sessionId=$a.sessionId;processId=$a.processId;originalTask=[ordered]@{};target=[ordered]@{}}
 foreach($key in @('comSnapshotProfile','expectedComSnapshotSha256','definitionSha256','envelopeSha256','securitySha256','actionId','actionsContext')){$parts.originalTask[$key]=$a.originalTask.$key}
 foreach($key in @('execute','arguments','workingDirectory','nodeSha256','hostSha256')){$parts.target[$key]=$a.target.$key}
 Get-OwnerProductionDigest ($parts|ConvertTo-Json -Depth 6 -Compress)
}
function Assert-OwnerProductionAuthority($State){
 $a=Get-OwnerProductionResolvedAdmission $State.admission
 if((Get-OwnerProductionAdmissionFingerprint $a) -cne $State.fingerprint){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}
 foreach($key in @('attemptIdentity','proofEvidenceIdentity','originalClockIdentity','journalIdentity','recoveryWitnessIdentity','preservationSessionIdentity')){if(-not [object]::ReferenceEquals($a.$key,$State.identities[$key])){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'}}
}
function Invoke-OwnerProductionApi($State,[scriptblock]$Action){
 Assert-OwnerProductionAuthority $State
 Assert-OwnerProductionClock $State.identities.originalClockIdentity
 $failure=$null;$value=$null
 try{$value=& $Action}catch{$failure=$_}
 Assert-OwnerProductionAuthority $State
 if($failure){throw $failure};return $value
}
function Initialize-OwnerProductionTaskUpdateBinding {
 if($script:OwnerProductionHelperState.typeReady){return}
 if('OwnerProductionTaskUpdateBinding' -as [type]){throw 'ROTATION_CUTOVER_SOURCE_REQUIRED'}
 Add-Type @'
using System;using System.Reflection;using System.Globalization;
public static class OwnerProductionTaskUpdateBinding {
 public static object[] Arguments(string name,object definition){return new object[]{name,definition,52,(object)null,(object)null,0,(object)null};}
 static object Call(object target,string method,object[] args){return target.GetType().InvokeMember(method,BindingFlags.InvokeMethod,null,target,args,null,CultureInfo.InvariantCulture,null);}
 public static void Connect(object service){Call(service,"Connect",new object[0]);}
 public static object Root(object service){return Call(service,"GetFolder",new object[]{"\\"});}
 public static object Update(object folder,string name,object definition){return Call(folder,"RegisterTaskDefinition",Arguments(name,definition));}
}
'@|Out-Null
 $script:OwnerProductionHelperState.typeReady=$true
}
function Get-OwnerProductionXmlState([string]$Text){
 if([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 65536 -or $Text -match '<!DOCTYPE'){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 $xml=[xml]::new();$xml.XmlResolver=$null;$xml.PreserveWhitespace=$true;$xml.LoadXml($Text);$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
 $actions=@($xml.SelectNodes('/t:Task/t:Actions',$ns));if($actions.Count -ne 1){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'};$exec=@($actions[0].SelectNodes('*'));if($exec.Count -ne 1 -or $exec[0].LocalName -cne 'Exec' -or $exec[0].NamespaceURI -cne $ns.LookupNamespace('t') -or $exec[0].SelectNodes('*').Count -ne 3){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 foreach($attribute in $actions[0].Attributes){if($attribute.Name -cne 'Context' -or $attribute.NamespaceURI -cne ''){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}}
 foreach($attribute in $exec[0].Attributes){if($attribute.Name -cne 'id' -or $attribute.NamespaceURI -cne ''){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}}
 $values=@{}
 foreach($field in @('Command','Arguments','WorkingDirectory')){
  $nodes=@($exec[0].SelectNodes(('t:'+$field),$ns));if($nodes.Count -ne 1 -or $nodes[0].Attributes.Count -ne 0){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
  foreach($child in $nodes[0].ChildNodes){if($child.NodeType -ne [Xml.XmlNodeType]::Text){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}}
  $values[$field]=$nodes[0].InnerText;$nodes[0].InnerText=''
 }
 return @{definitionSha256=(Get-OwnerProductionDigest $Text);envelopeSha256=(Get-OwnerProductionDigest $xml.OuterXml);execute=$values.Command;arguments=$values.Arguments;workingDirectory=$values.WorkingDirectory;actionId=$exec[0].GetAttribute('id');actionsContext=$actions[0].GetAttribute('Context')}
}
function Read-OwnerProductionTaskState($State,$Registered){
 $path=Invoke-OwnerProductionApi $State {$Registered.Path};if($path -isnot [string] -or $path -cne '\JARVIS Remote Host'){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 $definition=Invoke-OwnerProductionApi $State {$Registered.Definition};$principal=Invoke-OwnerProductionApi $State {$definition.Principal};$user=Invoke-OwnerProductionApi $State {$principal.UserId}
 if($user -isnot [string]){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 $sid=if($user -cmatch '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$'){$user}else{Invoke-OwnerProductionApi $State {([Security.Principal.NTAccount]::new($user)).Translate([Security.Principal.SecurityIdentifier]).Value}}
 $logon=Invoke-OwnerProductionApi $State {$principal.LogonType};$level=Invoke-OwnerProductionApi $State {$principal.RunLevel}
 if($sid -cne $State.ownerSid -or $logon -isnot [int] -or $logon -ne 1 -or $level -isnot [int] -or $level -ne 0){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 $envelope=Invoke-OwnerProductionApi $State {[pscustomobject]@{collection=$definition.Actions}};$actions=$envelope.collection;$count=Invoke-OwnerProductionApi $State {$actions.Count};if($count -isnot [int] -or $count -ne 1){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 $exec=Invoke-OwnerProductionApi $State {$actions.Item(1)};$type=Invoke-OwnerProductionApi $State {$exec.Type};if($type -isnot [int] -or $type -ne 0){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 $id=Invoke-OwnerProductionApi $State {$exec.Id};$context=Invoke-OwnerProductionApi $State {$actions.Context};$execute=Invoke-OwnerProductionApi $State {$exec.Path};$arguments=Invoke-OwnerProductionApi $State {$exec.Arguments};$directory=Invoke-OwnerProductionApi $State {$exec.WorkingDirectory};$text=Invoke-OwnerProductionApi $State {$definition.XmlText};$security=Invoke-OwnerProductionApi $State {$Registered.GetSecurityDescriptor(7)}
 foreach($s in @($id,$context,$execute,$arguments,$directory,$text,$security)){if($s -isnot [string]){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}}
 $xml=Get-OwnerProductionXmlState $text
 if($xml.execute -cne $execute -or $xml.arguments -cne $arguments -or $xml.workingDirectory -cne $directory -or $xml.actionId -cne $id -or $xml.actionsContext -cne $context){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 return @{definition=$definition;exec=$exec;rawXml=$text;rawSecurity=$security;comSnapshotProfile='goriq-fixed-owner-task-com-snapshot-v1';expectedComSnapshotSha256=(Get-OwnerProductionComSnapshotHash $text $security);definitionSha256=$xml.definitionSha256;envelopeSha256=$xml.envelopeSha256;securitySha256=(Get-OwnerProductionDigest $security);actionId=$id;actionsContext=$context;execute=$execute;arguments=$arguments;workingDirectory=$directory}
}
function Test-OwnerProductionOriginal($State,$Observed){foreach($key in @('comSnapshotProfile','expectedComSnapshotSha256','definitionSha256','envelopeSha256','securitySha256','actionId','actionsContext')){if($Observed[$key] -cne $State.original[$key]){return $false}};return $true}
function Get-OwnerProductionObservedState($State,$Observed){
 if(Test-OwnerProductionOriginal $State $Observed){return 'OLD_LEGACY'}
 if($Observed.envelopeSha256 -ceq $State.original.envelopeSha256 -and $Observed.securitySha256 -ceq $State.original.securitySha256 -and $Observed.actionId -ceq $State.original.actionId -and $Observed.actionsContext -ceq $State.original.actionsContext -and $Observed.execute -ceq $State.target.execute -and $Observed.arguments -ceq $State.target.arguments -and $Observed.workingDirectory -ceq $State.target.workingDirectory){return 'KNOWN_TARGET'}
 return 'DIVERGED'
}
function Close-OwnerProductionHandles($Handles){foreach($handle in $Handles){if($null -ne $handle -and [Runtime.InteropServices.Marshal]::IsComObject($handle)){$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($handle)}}}
function Get-OwnerProductionTaskBinding {
 param([object]$Admission)
 $a=Get-OwnerProductionResolvedAdmission $Admission;$old=$null
 if($script:OwnerProductionHelperState.attempts.TryGetValue($a.attemptIdentity,[ref]$old)){if($old.fingerprint -cne (Get-OwnerProductionAdmissionFingerprint $a)){throw 'ROTATION_CUTOVER_ADMISSION_REQUIRED'};Assert-OwnerProductionAuthority $old;return $old.binding}
 $identities=@{};foreach($key in @('attemptIdentity','proofEvidenceIdentity','originalClockIdentity','journalIdentity','recoveryWitnessIdentity','preservationSessionIdentity')){$identities[$key]=$a.$key}
 $original=@{};foreach($key in @('comSnapshotProfile','expectedComSnapshotSha256','definitionSha256','envelopeSha256','securitySha256','actionId','actionsContext')){$original[$key]=$a.originalTask.$key}
 $target=@{};foreach($key in @('execute','arguments','workingDirectory','nodeSha256','hostSha256')){$target[$key]=$a.target.$key}
 $state=@{admission=$Admission;identities=$identities;fingerprint=(Get-OwnerProductionAdmissionFingerprint $a);ownerSid=$a.ownerSid;original=$original;target=$target;binding=[object]::new();consumed=$false;registrationAttempted=$false;callState='NOT_ENTERED'};$handles=[Collections.Generic.List[object]]::new()
 try{Initialize-OwnerProductionTaskUpdateBinding;$service=Invoke-OwnerProductionApi $state {New-OwnerProductionTaskService};[void]$handles.Add($service);$null=Invoke-OwnerProductionApi $state {[OwnerProductionTaskUpdateBinding]::Connect($service)};$folder=Invoke-OwnerProductionApi $state {[OwnerProductionTaskUpdateBinding]::Root($service)};[void]$handles.Add($folder);$registered=Invoke-OwnerProductionApi $state {$folder.GetTask('JARVIS Remote Host')};[void]$handles.Add($registered);$before=Read-OwnerProductionTaskState $state $registered;[void]$handles.Add($before.exec);[void]$handles.Add($before.definition)
  if(-not (Test-OwnerProductionOriginal $state $before)){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
  Assert-OwnerProductionAuthority $state;$script:OwnerProductionHelperState.bindings.Add($state.binding,$state);$script:OwnerProductionHelperState.attempts.Add($a.attemptIdentity,$state);return $state.binding
 }finally{Close-OwnerProductionHandles $handles}
}
function Get-OwnerProductionFailureCode($ErrorRecord){
 $codes=@('ROTATION_CUTOVER_ADMISSION_REQUIRED','ROTATION_CUTOVER_BINDING_REQUIRED','ROTATION_CUTOVER_SCOPE_EXPIRED','ROTATION_CUTOVER_JOURNAL_REQUIRED','ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED','ROTATION_CUTOVER_ATTEMPT_CONSUMED','ROTATION_CUTOVER_SOURCE_REQUIRED','ROTATION_CUTOVER_UPDATE_FAILED','ROTATION_CUTOVER_RELOAD_REFUSED')
 $e=$ErrorRecord.Exception;while($e){if($e.Message -cin $codes){return $e.Message};$e=$e.InnerException};return 'ROTATION_CUTOVER_UPDATE_FAILED'
}
function Set-OwnerProductionTaskAction {
 param([object]$Binding)
 $result=[pscustomobject][ordered]@{schemaVersion=1;migrationVerified=$false;registrationAttempted=$false;callState='NOT_ENTERED';observedState='UNKNOWN';failureCode='ROTATION_CUTOVER_BINDING_REQUIRED'};$state=$null;$folder=$null;$handles=[Collections.Generic.List[object]]::new()
 if($null -eq $Binding -or -not $script:OwnerProductionHelperState.bindings.TryGetValue($Binding,[ref]$state)){return $result}
 if($state.consumed){$result.failureCode='ROTATION_CUTOVER_ATTEMPT_CONSUMED';return $result}
 $state.consumed=$true
 try{
  Assert-OwnerProductionAuthority $state;$receipt=New-OwnerProductionTaskWriteahead $state.identities.journalIdentity $state.original $state.target;Assert-OwnerProductionWriteahead $state $receipt;Assert-OwnerProductionAuthority $state
  $service=Invoke-OwnerProductionApi $state {New-OwnerProductionTaskService};[void]$handles.Add($service);$null=Invoke-OwnerProductionApi $state {[OwnerProductionTaskUpdateBinding]::Connect($service)};$folder=Invoke-OwnerProductionApi $state {[OwnerProductionTaskUpdateBinding]::Root($service)};[void]$handles.Add($folder);$registered=Invoke-OwnerProductionApi $state {$folder.GetTask('JARVIS Remote Host')};[void]$handles.Add($registered);$before=Read-OwnerProductionTaskState $state $registered;[void]$handles.Add($before.exec);[void]$handles.Add($before.definition)
  if(-not (Test-OwnerProductionOriginal $state $before)){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'};$exec=$before.exec
  $null=Invoke-OwnerProductionApi $state {$exec.Path=$state.target.execute};$null=Invoke-OwnerProductionApi $state {$exec.Arguments=$state.target.arguments};$null=Invoke-OwnerProductionApi $state {$exec.WorkingDirectory=$state.target.workingDirectory}
  $edited=Invoke-OwnerProductionApi $state {$before.definition.XmlText};$editedXml=Get-OwnerProductionXmlState $edited
  $editedExecute=Invoke-OwnerProductionApi $state {$exec.Path};$editedArguments=Invoke-OwnerProductionApi $state {$exec.Arguments};$editedDirectory=Invoke-OwnerProductionApi $state {$exec.WorkingDirectory};$editedId=Invoke-OwnerProductionApi $state {$exec.Id};$editedCollection=Invoke-OwnerProductionApi $state {[pscustomobject]@{collection=$before.definition.Actions}};$editedContext=Invoke-OwnerProductionApi $state {$editedCollection.collection.Context}
  if($editedXml.envelopeSha256 -cne $state.original.envelopeSha256 -or $editedXml.execute -cne $state.target.execute -or $editedXml.arguments -cne $state.target.arguments -or $editedXml.workingDirectory -cne $state.target.workingDirectory -or $editedXml.execute -cne $editedExecute -or $editedXml.arguments -cne $editedArguments -or $editedXml.workingDirectory -cne $editedDirectory -or $editedXml.actionId -cne $editedId -or $editedId -cne $state.original.actionId -or $editedXml.actionsContext -cne $editedContext -or $editedContext -cne $state.original.actionsContext){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
  $fresh=Invoke-OwnerProductionApi $state {$folder.GetTask('JARVIS Remote Host')};[void]$handles.Add($fresh);$freshState=Read-OwnerProductionTaskState $state $fresh;[void]$handles.Add($freshState.exec);[void]$handles.Add($freshState.definition);if(-not (Test-OwnerProductionOriginal $state $freshState)){throw 'ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
  $null=Invoke-OwnerProductionApi $state {$state.registrationAttempted=$true;try{$v=[OwnerProductionTaskUpdateBinding]::Update($folder,'JARVIS Remote Host',$before.definition);$state.callState='RETURNED';return $v}catch{$state.callState='THREW';throw}}
  $afterTask=Invoke-OwnerProductionApi $state {$folder.GetTask('JARVIS Remote Host')};[void]$handles.Add($afterTask);$after=Read-OwnerProductionTaskState $state $afterTask;[void]$handles.Add($after.exec);[void]$handles.Add($after.definition);$result.observedState=Get-OwnerProductionObservedState $state $after
  if($result.observedState -ceq 'KNOWN_TARGET'){$result.migrationVerified=$true;$result.failureCode=$null}else{$result.failureCode='ROTATION_CUTOVER_TASK_BOUNDARY_CHANGED'}
 }catch{
  $result.failureCode=Get-OwnerProductionFailureCode $_
  if($state.registrationAttempted){try{Assert-OwnerProductionAuthority $state;$task=Invoke-OwnerProductionApi $state {$folder.GetTask('JARVIS Remote Host')};[void]$handles.Add($task);$observed=Read-OwnerProductionTaskState $state $task;[void]$handles.Add($observed.exec);[void]$handles.Add($observed.definition);$result.observedState=Get-OwnerProductionObservedState $state $observed}catch{$result.observedState='UNKNOWN'}}
 }finally{$result.registrationAttempted=[bool]$state.registrationAttempted;$result.callState=$state.callState;Close-OwnerProductionHandles $handles}
 return $result
}

# New-profile guarded R05. The old Task2B functions above are byte-preserved.
# Every native authority seam refuses until the original private registry is wired.
$script:OwnerProductionHelperState.exerciseFileIdentityReady=$false
$script:OwnerProductionHelperState.exerciseAdmissions=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()
$script:OwnerProductionHelperState.exerciseAttempts=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()
$script:OwnerProductionHelperState.exerciseContexts=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()
$script:OwnerProductionExerciseOperations=@('EXERCISE_STAGE','CONFIRMATION','VALIDATOR_START','VALIDATOR_WRITE','VALIDATOR_CLOSE','CANDIDATE_CREATE','CANDIDATE_WRITE','CANDIDATE_FLUSH','CANDIDATE_CLOSE','CANDIDATE_ACL','FORWARD_REPLACE','FORWARD_TASK_STOP','FORWARD_TASK_START','PLANNED_REPLACE','PLANNED_TASK_STOP','PLANNED_TASK_START','RECOVERY_REPLACE','RECOVERY_TASK_STOP','RECOVERY_TASK_START','CANDIDATE_CLEANUP','RESULT_UI','LOGIN_FORWARD_01','LOGIN_FORWARD_02','LOGIN_FORWARD_03','LOGIN_FORWARD_04','LOGIN_FORWARD_05','LOGIN_FORWARD_06','LOGIN_FORWARD_07','LOGIN_FORWARD_08','LOGIN_FORWARD_09','LOGIN_FORWARD_10','LOGIN_FORWARD_11','LOGIN_FORWARD_12','LOGIN_FORWARD_13','LOGIN_FORWARD_14','LOGIN_FORWARD_15','LOGIN_FORWARD_16','LOGIN_FORWARD_17','LOGIN_FORWARD_18','LOGIN_FORWARD_19','LOGIN_FORWARD_20','LOGIN_FORWARD_21','LOGIN_FORWARD_22','LOGIN_FORWARD_23','LOGIN_FORWARD_24','LOGIN_FORWARD_25','LOGIN_FORWARD_26','LOGIN_FORWARD_27','LOGIN_FORWARD_28','LOGIN_FORWARD_29','LOGIN_FORWARD_30','LOGIN_PLANNED_01','LOGIN_PLANNED_02','LOGIN_PLANNED_03','LOGIN_PLANNED_04','LOGIN_PLANNED_05','LOGIN_PLANNED_06','LOGIN_PLANNED_07','LOGIN_PLANNED_08','LOGIN_PLANNED_09','LOGIN_PLANNED_10','LOGIN_PLANNED_11','LOGIN_PLANNED_12','LOGIN_PLANNED_13','LOGIN_PLANNED_14','LOGIN_PLANNED_15','LOGIN_PLANNED_16','LOGIN_PLANNED_17','LOGIN_PLANNED_18','LOGIN_PLANNED_19','LOGIN_PLANNED_20','LOGIN_PLANNED_21','LOGIN_PLANNED_22','LOGIN_PLANNED_23','LOGIN_PLANNED_24','LOGIN_PLANNED_25','LOGIN_PLANNED_26','LOGIN_PLANNED_27','LOGIN_PLANNED_28','LOGIN_PLANNED_29','LOGIN_PLANNED_30','LOGIN_RECOVERY_01','LOGIN_RECOVERY_02','LOGIN_RECOVERY_03','LOGIN_RECOVERY_04','LOGIN_RECOVERY_05','LOGIN_RECOVERY_06','LOGIN_RECOVERY_07','LOGIN_RECOVERY_08','LOGIN_RECOVERY_09','LOGIN_RECOVERY_10','LOGIN_RECOVERY_11','LOGIN_RECOVERY_12','LOGIN_RECOVERY_13','LOGIN_RECOVERY_14','LOGIN_RECOVERY_15','LOGIN_RECOVERY_16','LOGIN_RECOVERY_17','LOGIN_RECOVERY_18','LOGIN_RECOVERY_19','LOGIN_RECOVERY_20','LOGIN_RECOVERY_21','LOGIN_RECOVERY_22','LOGIN_RECOVERY_23','LOGIN_RECOVERY_24','LOGIN_RECOVERY_25','LOGIN_RECOVERY_26','LOGIN_RECOVERY_27','LOGIN_RECOVERY_28','LOGIN_RECOVERY_29','LOGIN_RECOVERY_30')
function Resolve-OwnerProductionExerciseContext($Admission){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
function Assert-OwnerProductionExerciseWitnesses($ContextIdentity,$Phase){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
function New-OwnerProductionExerciseWriteahead($ContextIdentity,$Operation){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
function Set-OwnerProductionExerciseEffectOutcome($Receipt,$Outcome){throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
function Invoke-OwnerProductionExerciseCheckpoint($ContextIdentity,$Event){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
function New-OwnerProductionExerciseResult {
 $rotation=[pscustomobject][ordered]@{schemaVersion=1;issue=1218;complete=$false;confirmationVerified=$false;sessionInvalidationWarningVerified=$false;configurationValidated=$false;credentialGenerated=$false;atomicReplacementVerified=$false;protectedBackupVerified=$false;newLoginVerified=$false;rollbackAttempted=$false;rollbackVerified=$false;oldLoginVerified=$false;cleanupFailed=$false;failureCode='ROTATION_CONTEXT_UNAVAILABLE';failedStage='context'}
 $restoration=[pscustomobject][ordered]@{attempted=$false;complete=$false;atomicRestorationVerified=$false;oldLoginVerified=$false;runtimeVerified=$false;preservationVerified=$false;finalOriginalConfigurationVerified=$false;encryptedCandidateRetained=$false;recoveryAttempted=$false;recoveryVerified=$false;failureCode=$null}
 return [pscustomobject][ordered]@{schemaVersion=2;issue=1218;operation='rotation-restoration-exercise';complete=$false;failureCode='ROTATION_CONTEXT_UNAVAILABLE';failedStage='context';rotation=$rotation;restoration=$restoration}
}
function Assert-OwnerProductionExerciseContextShape($Context){
 $fields=@('profile','sourceRevision','sourceClosureSha256','originalGrantSha256','attemptId','ownerSid','sessionId','processId','contextIdentity','attemptIdentity','proofEvidenceIdentity','originalClockIdentity','journalIdentity','recoveryWitnessIdentity','preservationSessionIdentity','sourceIdentity','expectedTaskIdentity','environmentIdentity','configuration','controllerRoot','nodePath')
 Assert-OwnerProductionShape $Context $fields
 if($Context.profile -cne 'jarvis-owner-production-cutover-v1' -or $Context.sourceRevision -isnot [string] -or $Context.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $Context.ownerSid -isnot [string] -or $Context.ownerSid -cnotmatch '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$' -or $Context.attemptId -isnot [string] -or $Context.attemptId -cnotmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or $Context.sessionId -isnot [int] -or $Context.sessionId -le 0 -or $Context.processId -isnot [int] -or $Context.processId -ne $PID){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
 foreach($key in @('sourceClosureSha256','originalGrantSha256')){if($Context.$key -isnot [string] -or $Context.$key -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}}
 foreach($key in @('contextIdentity','attemptIdentity','proofEvidenceIdentity','originalClockIdentity','journalIdentity','recoveryWitnessIdentity','preservationSessionIdentity','sourceIdentity','expectedTaskIdentity','environmentIdentity')){$v=$Context.$key;if($null -eq $v -or $v -is [string] -or $v -is [array] -or $v -is [Collections.IDictionary] -or $v.GetType().IsValueType){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}}
 foreach($key in @('controllerRoot','nodePath')){if($Context.$key -isnot [string] -or $Context.$key -cnotmatch '^[A-Za-z]:\\[^:\r\n\x00]+$'){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}}
 Assert-OwnerProductionShape $Context.configuration @('configuration','configPath','configSnapshot','stateRoot','releaseRoot','runtimeRevision','manifest','build','host','dbPath','dbIdentity','sidecars','targetEnvironmentVerified')
 if($Context.configuration.configuration -isnot [pscustomobject] -or $Context.configuration.runtimeRevision -isnot [string] -or $Context.configuration.runtimeRevision -cnotmatch '^[a-f0-9]{40}$'){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
 foreach($key in @('configPath','stateRoot','releaseRoot','dbPath')){if($Context.configuration.$key -isnot [string] -or $Context.configuration.$key -cnotmatch '^[A-Za-z]:\\[^:\r\n\x00]+$'){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}}
 if(-not $Context.configuration.stateRoot.EndsWith('\JARVIS\production',[StringComparison]::OrdinalIgnoreCase) -or $Context.configuration.configPath -ine ($Context.configuration.stateRoot+'\config.dpapi')){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
}
function Get-OwnerProductionExerciseContextFingerprint($Context){
 $v=[ordered]@{};foreach($key in @('profile','sourceRevision','sourceClosureSha256','originalGrantSha256','attemptId','ownerSid','sessionId','processId','controllerRoot','nodePath')){$v[$key]=$Context.$key};return Get-OwnerProductionDigest ($v|ConvertTo-Json -Compress)
}
function Get-OwnerProductionExerciseBindingFingerprint($Binding){
 $v=[ordered]@{};foreach($key in @('configPath','stateRoot','releaseRoot','runtimeRevision','dbPath')){$v[$key]=$Binding.$key};foreach($key in @('configSnapshot','manifest','build','host')){$v[$key]=[ordered]@{sha256=$Binding.$key.sha256;identityKey=$Binding.$key.identityKey;aclSha256=$Binding.$key.aclSha256}};$v.dbIdentity=$Binding.dbIdentity.key;return Get-OwnerProductionDigest ($v|ConvertTo-Json -Depth 6 -Compress)
}
function Get-OwnerProductionExerciseShapeSignature($Value){$keys=if($Value -is [Collections.IDictionary]){@($Value.Keys)}else{@($Value.PSObject.Properties.Name)};return [string]::Join([char]0,[string[]]$keys)}
function Get-OwnerProductionExerciseGuardValues($Context){
 $b=$Context.configuration
 return ,@($Context.profile,$Context.sourceRevision,$Context.sourceClosureSha256,$Context.originalGrantSha256,$Context.attemptId,$Context.ownerSid,$Context.sessionId,$Context.processId,$Context.controllerRoot,$Context.nodePath,$b.configPath,$b.stateRoot,$b.releaseRoot,$b.runtimeRevision,$b.dbPath,$b.configSnapshot.sha256,$b.configSnapshot.identityKey,$b.configSnapshot.aclSha256,$b.manifest.sha256,$b.manifest.identityKey,$b.manifest.aclSha256,$b.build.sha256,$b.build.identityKey,$b.build.aclSha256,$b.host.sha256,$b.host.identityKey,$b.host.aclSha256,$b.dbIdentity.key)
}
function Assert-OwnerProductionExerciseRawClock($State){
 if($State.terminal){throw 'ROTATION_CUTOVER_SCOPE_EXPIRED'}
 try{
  $clock=Get-OwnerProductionClockState $State.context.originalClockIdentity;Assert-OwnerProductionShape $clock @('remainingForwardSeconds','remainingHardSeconds','hardEndUtc')
  if(-not (Test-OwnerProductionFiniteNumber $clock.remainingForwardSeconds) -or -not (Test-OwnerProductionFiniteNumber $clock.remainingHardSeconds) -or $clock.hardEndUtc -isnot [string]){throw 'CLOCK_INVALID'}
  $f=[double]$clock.remainingForwardSeconds;$h=[double]$clock.remainingHardSeconds;$end=[datetime]::MinValue
  if($f -lt 0 -or $h -le 0 -or $h -gt 900 -or [Math]::Abs($f-[Math]::Max(0.0,$h-120.0)) -gt 0.000001 -or -not [datetime]::TryParseExact($clock.hardEndUtc,'yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal,[ref]$end)){throw 'CLOCK_INVALID'}
  if($State.clockInitialized -and ($clock.hardEndUtc -cne $State.hardEndUtc -or $f -gt $State.forward -or $h -gt $State.hard)){throw 'CLOCK_INVALID'}
  $State.clockInitialized=$true;$State.hardEndUtc=$clock.hardEndUtc;$State.forward=$f;$State.hard=$h
 }catch{$State.terminal=$true;throw 'ROTATION_CUTOVER_SCOPE_EXPIRED'}
}
function Assert-OwnerProductionExerciseGuard($State){
 $recognized=$null;if($null -eq $State -or -not $script:OwnerProductionHelperState.exerciseContexts.TryGetValue($State.context.contextIdentity,[ref]$recognized) -or -not [object]::ReferenceEquals($State,$recognized)){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
 Assert-OwnerProductionExerciseRawClock $State
 if($State.phase -ceq 'FORWARD' -and $State.forward -le 0){throw 'ROTATION_CUTOVER_FORWARD_EXPIRED'}
 try{
  $again=Resolve-OwnerProductionExerciseContext $State.admission
  Assert-OwnerProductionExerciseRawClock $State
  if(-not [object]::ReferenceEquals($again,$State.context) -or (Get-OwnerProductionExerciseShapeSignature $again) -cne $State.contextShape -or (Get-OwnerProductionExerciseShapeSignature $again.configuration) -cne $State.bindingShape){throw 'CONTEXT_CHANGED'}
  # Initial strict types/patterns remain bound by exact typed-value equality;
  # repeat JSON serialization/hashing is unnecessary for immutable DATA.
  $values=Get-OwnerProductionExerciseGuardValues $again;for($i=0;$i -lt $State.guardValues.Length;$i++){if(-not [object]::Equals($values[$i],$State.guardValues[$i])){throw 'CONTEXT_CHANGED'}}
  foreach($key in $State.identities.Keys){if(-not [object]::ReferenceEquals($again.$key,$State.identities[$key])){throw 'CONTEXT_CHANGED'}}
  $ack=@(Assert-OwnerProductionExerciseWitnesses $State.context.contextIdentity $State.phase)
  if($ack.Count -ne 0){throw 'WITNESS_NOT_VOID'}
  Assert-OwnerProductionExerciseRawClock $State
 }catch{$State.terminal=$true;throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
 if($State.phase -ceq 'FORWARD' -and $State.forward -le 0){throw 'ROTATION_CUTOVER_FORWARD_EXPIRED'}
}
function Invoke-OwnerProductionExerciseBoundary($State,[string]$Boundary,[scriptblock]$Leaf,[string]$Operation=''){
 $memory=@{boundary=$Boundary;outcome='NOT_ENTERED'}
 Assert-OwnerProductionExerciseGuard $State
 $receipt=$null;$effectRecord=$null
 if($Operation){
  if($Operation -cnotin $script:OwnerProductionExerciseOperations -or $State.slots.ContainsKey($Operation)){throw 'ROTATION_CUTOVER_ATTEMPT_CONSUMED'}
  $effectRecord=@{operation=$Operation;receipt=$null;memory='NOT_ENTERED';durable='UNKNOWN'};$State.slots[$Operation]=$effectRecord
  try{
   $receipt=New-OwnerProductionExerciseWriteahead $State.context.contextIdentity $Operation
   if($null -eq $receipt -or $receipt -is [string] -or $receipt -is [array] -or $receipt -is [Collections.IDictionary] -or $receipt.GetType().IsValueType){throw 'RECEIPT_REQUIRED'};$effectRecord.receipt=$receipt
   Assert-OwnerProductionExerciseGuard $State
   $ack=@(Set-OwnerProductionExerciseEffectOutcome $receipt 'ENTERED');if($ack.Count -ne 0){throw 'JOURNAL_NOT_VOID'};$effectRecord.durable='ENTERED'
   Assert-OwnerProductionExerciseGuard $State
  }catch{if($_.Exception.Message -ceq 'ROTATION_CUTOVER_FORWARD_EXPIRED'){throw};$State.terminal=$true;throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
 }
 $failure=$null;$value=$null;$State.boundaryMemory[$Boundary]=$memory
 try{$value=&$Leaf;$memory.outcome='RETURNED';if($effectRecord){$effectRecord.memory='RETURNED'}}catch{$failure=$_;$memory.outcome='THREW_UNKNOWN';if($effectRecord){$effectRecord.memory='THREW_UNKNOWN'}}
 if($effectRecord){
  # Memory outcome is saved before any provider/postguard may throw. The raw
  # hard clock is checked BEFORE durable IO; hard0 leaves ENTERED unknown.
  Assert-OwnerProductionExerciseRawClock $State
  try{$ack=@(Set-OwnerProductionExerciseEffectOutcome $receipt $effectRecord.memory);if($ack.Count -ne 0){throw 'JOURNAL_NOT_VOID'};$effectRecord.durable=$effectRecord.memory}catch{$State.terminal=$true;throw 'ROTATION_CUTOVER_JOURNAL_REQUIRED'}
 }
 Assert-OwnerProductionExerciseGuard $State
 if($failure){if($failure.Exception.Message -cin @('ROTATION_CUTOVER_HTTP_REDIRECT','ROTATION_CUTOVER_HTTP_OVERSIZE')){throw $failure.Exception.Message};throw 'ROTATION_CUTOVER_EXERCISE_LEAF_FAILED'}
 return $value
}
function Stop-OwnerProductionExerciseIntegrity($State){$State.terminal=$true;throw 'ROTATION_CUTOVER_EXERCISE_CONFIGURATION_CHANGED'}
function Get-OwnerProductionExerciseMetadataLeaf([string]$Path){
 try{$a=[IO.File]::GetAttributes($Path)}catch [IO.FileNotFoundException]{return @{exists=$false}}catch [IO.DirectoryNotFoundException]{return @{exists=$false}}
 return @{exists=$true;directory=(($a -band [IO.FileAttributes]::Directory) -ne 0);reparse=(($a -band [IO.FileAttributes]::ReparsePoint) -ne 0)}
}
function Get-OwnerProductionExerciseAclLeaf([string]$Path){return Get-Acl -LiteralPath $Path -ErrorAction Stop}
function Set-OwnerProductionExerciseAclLeaf([string]$Path,$Acl){Set-Acl -LiteralPath $Path -AclObject $Acl -ErrorAction Stop}
function Open-OwnerProductionExerciseReadLeaf([string]$Path){return [IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)}
function Open-OwnerProductionExerciseWriteLeaf([string]$Path){return [IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,1,[IO.FileOptions]::WriteThrough)}
function Replace-OwnerProductionExerciseFileLeaf([string]$Replacement,[string]$Destination,[string]$Backup){[IO.File]::Replace($Replacement,$Destination,$Backup,$true)}
function Remove-OwnerProductionExerciseFileLeaf([string]$Path){[IO.File]::Delete($Path)}
function Get-OwnerProductionExerciseFileIdentityLeaf($Stream,[string]$Path){
 if(-not $script:OwnerProductionHelperState.exerciseFileIdentityReady){
  if('OwnerProductionExerciseFileIdentity' -as [type]){throw 'ROTATION_CUTOVER_SOURCE_REQUIRED'}
  Add-Type @'
using System;using System.IO;using System.Text;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public static class OwnerProductionExerciseFileIdentity {
 [StructLayout(LayoutKind.Sequential)]struct Info {public uint Attributes,CreationLow,CreationHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(SafeFileHandle f,out Info i);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint GetFinalPathNameByHandle(SafeFileHandle f,StringBuilder p,uint n,uint flags);
 public static object[] Read(SafeFileHandle f){Info i;if(!GetFileInformationByHandle(f,out i))throw new IOException();StringBuilder p=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(f,p,32768,0);if(n==0||n>=32768)throw new IOException();string path=p.ToString();if(path.StartsWith(@"\\?\"))path=path.Substring(4);return new object[]{i.Volume.ToString("x8")+":"+i.IndexHigh.ToString("x8")+i.IndexLow.ToString("x8"),(int)i.Links,path,(i.Attributes&0x400)!=0};}
}
'@|Out-Null
  $script:OwnerProductionHelperState.exerciseFileIdentityReady=$true
 }
 $v=[OwnerProductionExerciseFileIdentity]::Read($Stream.SafeFileHandle);return @{identityKey=$v[0];links=$v[1];finalPath=$v[2];reparse=$v[3]}
}
function Get-OwnerProductionExerciseDriveTypeLeaf([string]$Root){return ([IO.DriveInfo]::new($Root)).DriveType}
function Assert-OwnerProductionExercisePath($State,[string]$Path,[bool]$OwnerLocal=$false){
 if($Path -cnotmatch '^[A-Za-z]:\\[^:\r\n\x00]+$' -or $Path -match '(?:^|\\)\.\.?(?:\\|$)' -or $Path -match '[. ](?:\\|$)'){Stop-OwnerProductionExerciseIntegrity $State}
 if($OwnerLocal -and $Path -ine $State.ownerProfile -and -not $Path.StartsWith($State.ownerProfile+'\',[StringComparison]::OrdinalIgnoreCase)){Stop-OwnerProductionExerciseIntegrity $State}
 $drive=Invoke-OwnerProductionExerciseBoundary $State 'authority-observations' {Get-OwnerProductionExerciseDriveTypeLeaf $Path.Substring(0,3)};if($drive -ne [IO.DriveType]::Fixed){Stop-OwnerProductionExerciseIntegrity $State}
 $paths=[Collections.Generic.List[string]]::new();$part=$Path;while($part.Length -gt 3){$paths.Add($part);$part=$part.Substring(0,$part.LastIndexOf([char]92));if($part.Length -eq 2){$part+='\'}};$paths.Add($part)
 $depth=0;$found=$false
 foreach($current in $paths){
  $m=Invoke-OwnerProductionExerciseBoundary $State 'authority-observations' {Get-OwnerProductionExerciseMetadataLeaf $current}
  if($m.exists -isnot [bool]){Stop-OwnerProductionExerciseIntegrity $State};if(-not $m.exists){if($found){Stop-OwnerProductionExerciseIntegrity $State};continue};$found=$true
  if($m.directory -isnot [bool] -or $m.reparse -isnot [bool] -or $m.reparse -or ($current -ine $Path -and -not $m.directory)){Stop-OwnerProductionExerciseIntegrity $State}
  $acl=Invoke-OwnerProductionExerciseBoundary $State 'authority-observations' {Get-OwnerProductionExerciseAclLeaf $current}
  $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;if($owner -cnotin @($State.context.ownerSid,'S-1-5-18','S-1-5-32-544')){Stop-OwnerProductionExerciseIntegrity $State}
  $write=if($depth -le 1 -or $current -ieq $State.ownerProfile){[Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'}else{[Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.IdentityReference -isnot [Security.Principal.SecurityIdentifier]){Stop-OwnerProductionExerciseIntegrity $State};if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($rule.FileSystemRights -band $write) -ne 0 -and $rule.IdentityReference.Value -cnotin @($State.context.ownerSid,'S-1-5-18','S-1-5-32-544','S-1-3-0')){Stop-OwnerProductionExerciseIntegrity $State}}
  if($OwnerLocal -and $current -ieq $State.ownerProfile){break};$depth++
 }
 if(-not $found){Stop-OwnerProductionExerciseIntegrity $State}
}
function Read-OwnerProductionExerciseSnapshot($State,[string]$Path,[int]$Limit=1048576,[string]$Boundary='runtime-config-db'){
 Assert-OwnerProductionExercisePath $State $Path ($Path.StartsWith($State.ownerProfile+'\',[StringComparison]::OrdinalIgnoreCase));$stream=$null;$ownedRead=@{value=$null};$memory=[IO.MemoryStream]::new()
 try{
  $stream=Invoke-OwnerProductionExerciseBoundary $State $Boundary {$ownedRead.value=Open-OwnerProductionExerciseReadLeaf $Path;return $ownedRead.value}
  $id=Invoke-OwnerProductionExerciseBoundary $State $Boundary {Get-OwnerProductionExerciseFileIdentityLeaf $stream $Path}
  if($id.links -isnot [int] -or $id.links -ne 1 -or $id.finalPath -ine $Path -or $id.identityKey -isnot [string] -or -not $id.identityKey -or $id.reparse -ne $false){Stop-OwnerProductionExerciseIntegrity $State}
  $buffer=New-Object byte[] 8192
  do{$n=Invoke-OwnerProductionExerciseBoundary $State $Boundary {$stream.Read($buffer,0,$buffer.Length)};if($memory.Length+$n -gt $Limit){Stop-OwnerProductionExerciseIntegrity $State};if($n -gt 0){$memory.Write($buffer,0,$n)}}while($n -gt 0)
  $acl=Invoke-OwnerProductionExerciseBoundary $State $Boundary {Get-OwnerProductionExerciseAclLeaf $Path};$bytes=$memory.ToArray();$hash=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  return @{bytes=$bytes;sha256=$digest;identityKey=$id.identityKey;aclSha256=(Get-OwnerProductionDigest $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Group,Access'));acl=$acl}
 }finally{if($ownedRead.value){$ownedRead.value.Dispose()};$memory.Dispose()}
}
function ConvertFrom-OwnerProductionExerciseCipherLeaf([byte[]]$Bytes){
 $secure=$null;$credential=$null;$plain=$null
 try{$encrypted=[Text.Encoding]::ASCII.GetString($Bytes).Trim();$secure=ConvertTo-SecureString $encrypted -ErrorAction Stop;$credential=[Management.Automation.PSCredential]::new('config',$secure);$plain=$credential.GetNetworkCredential().Password;return ($plain|Microsoft.PowerShell.Utility\ConvertFrom-Json -ErrorAction Stop)}finally{$plain=$null;$credential=$null;if($secure){$secure.Dispose()};$encrypted=$null}
}
function ConvertTo-OwnerProductionExerciseCipherLeaf([string]$Json){$secure=ConvertTo-SecureString $Json -AsPlainText -Force;try{return ConvertFrom-SecureString $secure -ErrorAction Stop}finally{$secure.Dispose()}}
function New-OwnerProductionExerciseCodeLeaf {$bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes);return [Convert]::ToBase64String($bytes)}finally{$rng.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}}
function Get-OwnerProductionExerciseProjection($Configuration){$copy=($Configuration|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 -Compress)|Microsoft.PowerShell.Utility\ConvertFrom-Json;$copy.environment.JARVIS_OWNER_SECRET='';return Get-OwnerProductionDigest ($copy|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 -Compress)}
function Assert-OwnerProductionExerciseConfiguration($State,$Configuration,[string]$Code){
 if($Configuration -isnot [pscustomobject] -or $Configuration.environment -isnot [pscustomobject] -or $Configuration.version -ne 1 -or $Configuration.commit -cne $State.context.configuration.runtimeRevision -or $Configuration.releaseRoot -ine $State.context.configuration.releaseRoot -or $Configuration.environment.JARVIS_DB_PATH -ine $State.context.configuration.dbPath -or $Configuration.environment.JARVIS_OWNER_SECRET -isnot [string] -or $Configuration.environment.JARVIS_OWNER_SECRET.Length -lt 24 -or $Configuration.environment.JARVIS_OWNER_SECRET -match '[\r\n\x00]' -or $Configuration.environment.JARVIS_OWNER_SECRET -cne $Code -or (Get-OwnerProductionExerciseProjection $Configuration) -cne $State.projection){Stop-OwnerProductionExerciseIntegrity $State}
}


function Get-OwnerProductionExerciseWindowsDirectoryLeaf {return [Environment]::GetFolderPath('Windows')}
function Get-OwnerProductionExerciseOwnerProfileLeaf {return [Environment]::GetFolderPath('UserProfile')}
function Get-OwnerProductionExerciseLocalAppDataLeaf {return [Environment]::GetFolderPath('LocalApplicationData')}
function New-OwnerProductionExerciseValidatorLeaf($Context){
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Context.nodePath;$info.Arguments='"'+$Context.controllerRoot+'\scripts\validate-jarvis-production-config.mjs" "'+$Context.configuration.releaseRoot+'" "'+$Context.configuration.stateRoot+'"';$info.WorkingDirectory=$Context.controllerRoot;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 # An unstarted DATA constructor carries no ambient startup controls. Only
 # the SAME recognized original context may compose verified platform values;
 # no caller environment, flag or fallback can provide them.
 $info.EnvironmentVariables.Clear();$state=$null
 $hasIdentity=if($Context -is [Collections.IDictionary]){$Context.Contains('contextIdentity')}else{$Context.PSObject.Properties.Name -ccontains 'contextIdentity'}
 if($hasIdentity -and $null -ne $Context.contextIdentity -and $script:OwnerProductionHelperState.exerciseContexts.TryGetValue($Context.contextIdentity,[ref]$state) -and [object]::ReferenceEquals($state.context,$Context)){
  $windows=Invoke-OwnerProductionExerciseBoundary $state 'candidate-validator' {Get-OwnerProductionExerciseWindowsDirectoryLeaf}
  $profile=Invoke-OwnerProductionExerciseBoundary $state 'candidate-validator' {Get-OwnerProductionExerciseOwnerProfileLeaf}
  $local=Invoke-OwnerProductionExerciseBoundary $state 'candidate-validator' {Get-OwnerProductionExerciseLocalAppDataLeaf}
  foreach($path in @($windows,$profile,$local)){if($path -isnot [string] -or $path -cnotmatch '^[A-Za-z]:\\[^:\r\n\x00]+$' -or $path.Contains('/') -or $path.EndsWith('\')){Stop-OwnerProductionExerciseIntegrity $state}}
  if(-not [string]::Equals($profile,$state.ownerProfile,[StringComparison]::OrdinalIgnoreCase) -or -not $local.StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase)){Stop-OwnerProductionExerciseIntegrity $state}
  $info.EnvironmentVariables['SystemRoot']=$windows;$info.EnvironmentVariables['USERPROFILE']=$profile;$info.EnvironmentVariables['LOCALAPPDATA']=$local;$info.EnvironmentVariables['PATH']=$Context.nodePath.Substring(0,$Context.nodePath.LastIndexOf([char]92))+';'+$windows+'\System32\WindowsPowerShell\v1.0'
 }
 $process=[Diagnostics.Process]::new();$process.StartInfo=$info;return $process
}
function Read-OwnerProductionExerciseChildText($State,$Reader,$Task,[char[]]$Buffer,[int]$Limit){
 $text=[Text.StringBuilder]::new()
 while($true){$ready=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$ms=[int][Math]::Min(2000,[Math]::Max(1,[Math]::Floor($(if($State.phase -ceq 'FORWARD'){$State.forward}else{$State.hard})*1000)));$Task.Wait($ms)};if(-not $ready){throw 'ROTATION_CUTOVER_EXERCISE_VALIDATOR_FAILED'};$n=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$Task.Result};if($text.Length+$n -gt $Limit){throw 'ROTATION_CUTOVER_EXERCISE_VALIDATOR_FAILED'};if($n -eq 0){break};[void]$text.Append($Buffer,0,$n);$Task=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$Reader.ReadAsync($Buffer,0,$Buffer.Length)}}
 return $text.ToString()
}
function Invoke-OwnerProductionExerciseValidation($State,[string]$Json){
 $process=$null;$owned=@{startEntered=$false;started=$false;exited=$false;process=$null}
 try{
  $process=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$owned.process=New-OwnerProductionExerciseValidatorLeaf $State.context;return $owned.process}
  $null=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$owned.startEntered=$true;if(-not $process.Start()){$owned.startEntered=$false;throw 'VALIDATOR_START_FAILED'};$owned.started=$true} 'VALIDATOR_START'
  $outBuffer=New-Object char[] 4097;$errBuffer=New-Object char[] 1025
  $out=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$process.StandardOutput.ReadAsync($outBuffer,0,$outBuffer.Length)};$err=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$process.StandardError.ReadAsync($errBuffer,0,$errBuffer.Length)}
  $null=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {
   $null=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$process.StandardInput.AutoFlush=$true}
   $write=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$process.StandardInput.WriteAsync($Json)}
   $ready=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$ms=[int][Math]::Min(10000,[Math]::Max(1,[Math]::Floor($State.forward*1000)));$write.Wait($ms)}
   if(-not $ready){throw 'ROTATION_CUTOVER_EXERCISE_VALIDATOR_FAILED'}
  } 'VALIDATOR_WRITE'
  $null=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$process.StandardInput.Close()} 'VALIDATOR_CLOSE'
  $wait=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$ms=[int][Math]::Min(10000,[Math]::Max(1,[Math]::Floor($State.forward*1000)));$owned.exited=$process.WaitForExit($ms);return $owned.exited};if(-not $wait){throw 'ROTATION_CUTOVER_EXERCISE_VALIDATOR_FAILED'};$owned.exited=$true
  $stdout=Read-OwnerProductionExerciseChildText $State $process.StandardOutput $out $outBuffer 4096;$stderr=Read-OwnerProductionExerciseChildText $State $process.StandardError $err $errBuffer 1024
  $exitCode=Invoke-OwnerProductionExerciseBoundary $State 'candidate-validator' {$process.ExitCode}
  if($exitCode -ne 0 -or $stdout.Trim() -cne 'Production configuration structure: PASS' -or $stderr.Length -ne 0){throw 'ROTATION_CUTOVER_EXERCISE_VALIDATOR_FAILED'}
 }finally{if($owned.process){if($owned.startEntered -and -not $owned.exited){try{$owned.process.Kill()}catch{};try{$owned.exited=$owned.process.WaitForExit(2000)}catch{};if(-not $owned.exited){$State.ownedResourceCleanupFailed=$true}};$owned.process.Dispose()};$Json=$null;$stdout=$null;$stderr=$null}
}
function Show-OwnerProductionExerciseConfirmationLeaf($State){
 Add-Type -AssemblyName System.Windows.Forms
 $form=[Windows.Forms.Form]::new();$form.Name='OwnerRotationConfirmation';$form.Text='Confirm Owner credential rotation';$form.Width=540;$form.Height=210;$form.StartPosition='CenterScreen'
 $warning=[Windows.Forms.Label]::new();$warning.Name='OwnerRotationWarning';$warning.Text='Change the Production Owner login code? Existing Owner sessions will end. Worker identities and Broker data must remain unchanged.';$warning.SetBounds(15,15,490,70);$form.Controls.Add($warning)
 $yes=[Windows.Forms.Button]::new();$yes.Name='OwnerRotationConfirm';$yes.Text='Change code';$yes.SetBounds(250,105,110,30);$form.Controls.Add($yes)
 $no=[Windows.Forms.Button]::new();$no.Name='OwnerRotationCancel';$no.Text='Cancel';$no.SetBounds(380,105,110,30);$no.DialogResult=[Windows.Forms.DialogResult]::Cancel;$form.Controls.Add($no);$form.AcceptButton=$no;$form.CancelButton=$no
 $display=@{confirmed=$false;warning=$false};$timer=[Windows.Forms.Timer]::new();$timer.Interval=100
 $form.Add_Shown({try{Assert-OwnerProductionExerciseGuard $State;$display.warning=$warning.Visible -and $warning.Text.Contains('Existing Owner sessions will end.');$no.Focus()|Out-Null}catch{$form.Close()}}.GetNewClosure())
 $yes.Add_Click({try{Assert-OwnerProductionExerciseGuard $State;if($display.warning){$display.confirmed=$true;$form.Close()}}catch{$form.Close()}}.GetNewClosure())
 # Controlled automation is admitted only by the ORIGINAL native grant witness,
 # including its automation approval; neither caller DATA nor UI booleans mint it.
 $timer.Add_Tick({try{Assert-OwnerProductionExerciseGuard $State;if($display.warning){$yes.PerformClick()}}catch{$form.Close()}}.GetNewClosure())
 try{$timer.Start();[void]$form.ShowDialog();return [pscustomobject]@{confirmed=$display.confirmed;warning=$display.warning}}finally{$timer.Stop();$timer.Dispose();$form.Dispose()}
}
function Show-OwnerProductionExerciseResultLeaf($State,$Result){
 Add-Type -AssemblyName System.Windows.Forms
 $form=[Windows.Forms.Form]::new();$form.Name='OwnerRotationExerciseResult';$form.Text='Owner rotation and planned restoration';$form.Width=480;$form.Height=170
 $label=[Windows.Forms.Label]::new();$label.Text=if($Result.restoration.finalOriginalConfigurationVerified){'The original configuration is active. Acceptance is reported separately.'}else{'Acceptance did not complete. Preserve encrypted recovery files locally.'};$label.SetBounds(15,15,430,65);$form.Controls.Add($label)
 $timer=[Windows.Forms.Timer]::new();$timer.Interval=100;$timer.Add_Tick({try{Assert-OwnerProductionExerciseGuard $State}catch{}finally{$form.Close()}}.GetNewClosure())
 try{$timer.Start();[void]$form.ShowDialog()}finally{$timer.Stop();$timer.Dispose();$form.Dispose()}
}
function Get-OwnerProductionExerciseTaskStateLeaf {return [string](Get-ScheduledTask -TaskName 'JARVIS Remote Host' -TaskPath '\' -ErrorAction Stop).State}
function Get-OwnerProductionExerciseLastRunLeaf {return (Get-ScheduledTaskInfo -TaskName 'JARVIS Remote Host' -TaskPath '\' -ErrorAction Stop).LastRunTime}
function Stop-OwnerProductionExerciseTaskLeaf {Stop-ScheduledTask -TaskName 'JARVIS Remote Host' -TaskPath '\' -ErrorAction Stop|Out-Null}
function Start-OwnerProductionExerciseTaskLeaf {Start-ScheduledTask -TaskName 'JARVIS Remote Host' -TaskPath '\' -ErrorAction Stop|Out-Null}
function Wait-OwnerProductionExerciseLeaf([int]$Milliseconds){Start-Sleep -Milliseconds $Milliseconds}
function New-OwnerProductionExerciseRequestLeaf([string]$Uri){return [Net.HttpWebRequest]::Create($Uri)}
function Set-OwnerProductionExerciseStreamBudget($State,$Stream,[string]$Direction){
 # Called inside the immediately guarded actual IO leaf. Only remaining
 # original phase budget may tighten this request's existing 3-second cap.
 $seconds=if($State.phase -ceq 'FORWARD'){$State.forward}else{$State.hard};$ms=[int][Math]::Min(3000,[Math]::Floor($seconds*1000));if($ms -lt 1){throw 'ROTATION_CUTOVER_SCOPE_EXPIRED'}
 if($Stream.CanTimeout){if($Direction -ceq 'READ'){$Stream.ReadTimeout=$ms}elseif($Direction -ceq 'WRITE'){$Stream.WriteTimeout=$ms}else{throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}}elseif($ms -lt 3000){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}
}
function Invoke-OwnerProductionExerciseHttp($State,[string]$Kind,[string]$Code=''){
 if($Kind -cnotin @('LOGIN','HEALTH')){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}
 $uri=if($Kind -ceq 'LOGIN'){'http://127.0.0.1:3000/api/owner-login'}else{'http://127.0.0.1:8787/health'};$boundary=if($Kind -ceq 'LOGIN'){'login-post'}else{'runtime-health'}
 $request=$null;$send=$null;$response=$null;$read=$null;$ownedHttp=@{request=$null;send=$null;response=$null;read=$null};$memory=[IO.MemoryStream]::new();$finished=$false
 try{
  $request=Invoke-OwnerProductionExerciseBoundary $State $boundary {$ownedHttp.request=New-OwnerProductionExerciseRequestLeaf $uri;return $ownedHttp.request}
  # Request-specific controls; never global proxy/credential/trust changes. The
  # caller cannot supply an endpoint, redirect target, cookie, method or body.
  $request.Proxy=$null;$request.AllowAutoRedirect=$false;$request.UseDefaultCredentials=$false;$request.Credentials=$null;$request.PreAuthenticate=$false;$request.KeepAlive=$false;$request.Accept='application/json';$request.CookieContainer=[Net.CookieContainer]::new()
  Assert-OwnerProductionExerciseGuard $State;$budget=if($State.phase -ceq 'FORWARD'){$State.forward}else{$State.hard};$timeout=[int][Math]::Min(3000,[Math]::Floor($budget*1000));if($timeout -lt 1){throw 'ROTATION_CUTOVER_SCOPE_EXPIRED'};$request.Timeout=$timeout;$request.ReadWriteTimeout=$timeout
  if($Kind -ceq 'LOGIN'){
   $request.Method='POST';$request.ContentType='application/x-www-form-urlencoded';$bytes=[Text.Encoding]::UTF8.GetBytes('passcode='+[Uri]::EscapeDataString($Code));$request.ContentLength=$bytes.Length
   $send=Invoke-OwnerProductionExerciseBoundary $State $boundary {$ownedHttp.send=$request.GetRequestStream();return $ownedHttp.send}
   $null=Invoke-OwnerProductionExerciseBoundary $State $boundary {Set-OwnerProductionExerciseStreamBudget $State $send 'WRITE';$send.Write($bytes,0,$bytes.Length)}
   $null=Invoke-OwnerProductionExerciseBoundary $State $boundary {Set-OwnerProductionExerciseStreamBudget $State $send 'WRITE';$send.Flush()};$null=Invoke-OwnerProductionExerciseBoundary $State $boundary {$send.Dispose()};$send=$null;$ownedHttp.send=$null
  }else{$request.Method='GET'}
  $response=Invoke-OwnerProductionExerciseBoundary $State $boundary {if($request.Timeout -gt [Math]::Floor($(if($State.phase -ceq 'FORWARD'){$State.forward}else{$State.hard})*1000)){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'};try{$ownedHttp.response=$request.GetResponse();return $ownedHttp.response}catch [Net.WebException]{if($_.Exception.Response){$_.Exception.Response.Close()};throw}}
  $status=[int]$response.StatusCode
  if($status -ge 300 -and $status -le 399){throw 'ROTATION_CUTOVER_HTTP_REDIRECT'}
  if($status -ne 200 -or $response.ResponseUri.AbsoluteUri -cne $uri){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}
  if($response.ContentLength -gt 8192){throw 'ROTATION_CUTOVER_HTTP_OVERSIZE'}
  $read=Invoke-OwnerProductionExerciseBoundary $State $boundary {$ownedHttp.read=$response.GetResponseStream();return $ownedHttp.read};$buffer=New-Object byte[] 8193
  do{$n=Invoke-OwnerProductionExerciseBoundary $State $boundary {Set-OwnerProductionExerciseStreamBudget $State $read 'READ';$read.Read($buffer,0,$buffer.Length)};if($memory.Length+$n -gt 8192){throw 'ROTATION_CUTOVER_HTTP_OVERSIZE'};if($n -gt 0){$memory.Write($buffer,0,$n)}}while($n -gt 0)
  $body=[Text.UTF8Encoding]::new($false,$true).GetString($memory.ToArray());Assert-OwnerProductionExerciseGuard $State;$finished=$true
  return [pscustomobject]@{StatusCode=$status;Content=$body}
 }finally{
  # Cancel/close only these owned transport handles. No late retry/readback.
  if($ownedHttp.request -and -not $finished){try{$ownedHttp.request.Abort()}catch{}}
  if($ownedHttp.read){$ownedHttp.read.Dispose()};if($ownedHttp.response){$ownedHttp.response.Close()};if($ownedHttp.send){$ownedHttp.send.Dispose()};$memory.Dispose();$bytes=$null;$Code=$null;$body=$null
 }
}
function Restart-OwnerProductionExerciseTask($State,[string]$OperationPhase){
 $previous=Invoke-OwnerProductionExerciseBoundary $State 'restart-last-run' {Get-OwnerProductionExerciseLastRunLeaf}
 if($previous -isnot [datetime]){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}
 $null=Invoke-OwnerProductionExerciseBoundary $State 'restart-stop' {Stop-OwnerProductionExerciseTaskLeaf} ($OperationPhase+'_TASK_STOP')
 $stopped=$false;for($i=0;$i -lt 9000;$i++){$status=Invoke-OwnerProductionExerciseBoundary $State 'restart-stopping-loop' {Get-OwnerProductionExerciseTaskStateLeaf};if($status -cne 'Running'){$stopped=$true;break};$null=Invoke-OwnerProductionExerciseBoundary $State 'restart-stopping-loop' {Wait-OwnerProductionExerciseLeaf 100}}
 if(-not $stopped){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}
 $null=Invoke-OwnerProductionExerciseBoundary $State 'restart-start' {Start-OwnerProductionExerciseTaskLeaf} ($OperationPhase+'_TASK_START')
 for($i=0;$i -lt 9000;$i++){$status=Invoke-OwnerProductionExerciseBoundary $State 'restart-running-loop' {Get-OwnerProductionExerciseTaskStateLeaf};$last=Invoke-OwnerProductionExerciseBoundary $State 'restart-running-loop' {Get-OwnerProductionExerciseLastRunLeaf};if($status -ceq 'Running' -and $last -is [datetime] -and $last -gt $previous){Assert-OwnerProductionExerciseGuard $State;return};$null=Invoke-OwnerProductionExerciseBoundary $State 'restart-running-loop' {Wait-OwnerProductionExerciseLeaf 100}}
 throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'
}
function Test-OwnerProductionExerciseLogin($State,[string]$Code,[string]$OperationPhase){
 for($i=1;$i -le 30;$i++){
  Assert-OwnerProductionExerciseGuard $State;$budget=if($State.phase -ceq 'FORWARD'){$State.forward}else{$State.hard};if($budget -lt 4){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}
  $null=Invoke-OwnerProductionExerciseBoundary $State 'login-sleep-and-task' {Wait-OwnerProductionExerciseLeaf 1000}
  Assert-OwnerProductionExerciseGuard $State;$budget=if($State.phase -ceq 'FORWARD'){$State.forward}else{$State.hard};if($budget -lt 3){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}
  $running=Invoke-OwnerProductionExerciseBoundary $State 'login-sleep-and-task' {Get-OwnerProductionExerciseTaskStateLeaf};if($running -cne 'Running'){continue}
  $response=$null
  try{$response=Invoke-OwnerProductionExerciseBoundary $State 'login-post' {Invoke-OwnerProductionExerciseHttp $State 'LOGIN' $Code} ('LOGIN_'+$OperationPhase+'_'+$i.ToString('D2'));if($response.StatusCode -eq 200 -and $response.Content -is [string] -and $response.Content.Length -le 8192 -and ($response.Content|Microsoft.PowerShell.Utility\ConvertFrom-Json).ok -eq $true){Assert-OwnerProductionExerciseGuard $State;return}}catch{if($_.Exception.Message -cin @('ROTATION_CUTOVER_HTTP_REDIRECT','ROTATION_CUTOVER_HTTP_OVERSIZE')){throw};Assert-OwnerProductionExerciseGuard $State}finally{$response=$null}
 }
 throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'
}
function Test-OwnerProductionExerciseHealth($State){
 Assert-OwnerProductionExerciseGuard $State;$budget=if($State.phase -ceq 'FORWARD'){$State.forward}else{$State.hard};if($budget -lt 4){throw 'ROTATION_CUTOVER_EXERCISE_RUNTIME_FAILED'}
 $response=Invoke-OwnerProductionExerciseBoundary $State 'runtime-health' {Invoke-OwnerProductionExerciseHttp $State 'HEALTH'}
 try{if($response.StatusCode -ne 200 -or $response.Content -isnot [string] -or $response.Content.Length -gt 8192){throw 'HEALTH_FAILED'};$body=$response.Content|Microsoft.PowerShell.Utility\ConvertFrom-Json;if($body.ok -ne $true -or $body.service -cne 'jarvis-broker' -or $body.runtimeRevision -cne $State.context.configuration.runtimeRevision){throw 'HEALTH_FAILED'};Assert-OwnerProductionExerciseGuard $State}finally{$response=$null;$body=$null}
}
function Open-OwnerProductionExerciseDatabaseLeaf([string]$Path){return [IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))}
function Assert-OwnerProductionExerciseRuntimeData($State){
 $binding=$State.context.configuration
 foreach($pair in @(@(($binding.releaseRoot+'\jarvis-release.json'),'manifest',65536),@(($binding.releaseRoot+'\.next\BUILD_ID'),'build',65536),@(($binding.releaseRoot+'\scripts\jarvis-remote-host.mjs'),'host',1048576))){$s=Read-OwnerProductionExerciseSnapshot $State $pair[0] $pair[2];$expected=$binding.($pair[1]);if($s.sha256 -cne $expected.sha256 -or $s.aclSha256 -cne $expected.aclSha256 -or $s.identityKey -cne $expected.identityKey){Stop-OwnerProductionExerciseIntegrity $State}}
 Assert-OwnerProductionExercisePath $State $binding.dbPath;$db=$null;$ownedDb=@{value=$null}
 try{$db=Invoke-OwnerProductionExerciseBoundary $State 'runtime-config-db' {$ownedDb.value=Open-OwnerProductionExerciseDatabaseLeaf $binding.dbPath;return $ownedDb.value};$id=Invoke-OwnerProductionExerciseBoundary $State 'runtime-config-db' {Get-OwnerProductionExerciseFileIdentityLeaf $db $binding.dbPath};if($id.identityKey -cne $binding.dbIdentity.key -or $id.links -ne 1 -or $id.finalPath -ine $binding.dbPath -or $id.reparse -ne $false){Stop-OwnerProductionExerciseIntegrity $State}}finally{if($ownedDb.value){$ownedDb.value.Dispose()}}
 foreach($suffix in @('.pc-tasks.json','.pc-observations.json')){$path=$binding.dbPath+$suffix;$m=Invoke-OwnerProductionExerciseBoundary $State 'runtime-config-db' {Get-OwnerProductionExerciseMetadataLeaf $path};$expected=$binding.sidecars[$suffix];if($m.exists -isnot [bool] -or $m.exists -ne ($null -ne $expected)){Stop-OwnerProductionExerciseIntegrity $State};if($expected){$s=Read-OwnerProductionExerciseSnapshot $State $path 8388608;if($s.identityKey -cne $expected.identityKey -or $s.aclSha256 -cne $expected.aclSha256){Stop-OwnerProductionExerciseIntegrity $State}}}
}
function Invoke-OwnerProductionExercisePreservation($State,[string]$Event){
 if($Event -cnotin @('before-rotation','before-commit','after-rollback','before-planned-restore','after-planned-restore') -or $State.checkpoints.Contains($Event)){throw 'ROTATION_CUTOVER_EXERCISE_PRESERVATION_FAILED'}
 if($Event -cne 'before-rotation' -and -not $State.checkpoints.Contains('before-rotation')){throw 'ROTATION_CUTOVER_EXERCISE_PRESERVATION_FAILED'}
 if($Event -ceq 'before-planned-restore' -and -not $State.checkpoints.Contains('before-commit')){throw 'ROTATION_CUTOVER_EXERCISE_PRESERVATION_FAILED'}
 $comparison=Invoke-OwnerProductionExerciseBoundary $State 'exercise-protocol' {Invoke-OwnerProductionExerciseCheckpoint $State.context.contextIdentity $Event}
 if($comparison.status -cne 'PASS' -or $comparison.pcSidecars.status -cne 'PASS' -or @($comparison.reasonCodes).Count -ne 0){throw 'ROTATION_CUTOVER_EXERCISE_PRESERVATION_FAILED'}
 foreach($key in @('databaseBindingMatched','cohortAuthorityVerified','baselineCohortPreserved','fleetMetadataPreserved','identitiesPreserved','keysPreserved','workerLifecycleHistoryPreserved','auditRetainedHistoryPreserved','taskPayloadsPreserved','nonceProtectionPreserved')){if($comparison.$key -isnot [bool] -or -not $comparison.$key){throw 'ROTATION_CUTOVER_EXERCISE_PRESERVATION_FAILED'}}
 [void]$State.checkpoints.Add($Event);$comparison=$null;Assert-OwnerProductionExerciseGuard $State
}
function Read-OwnerProductionExerciseCurrent($State,[string]$ExpectedHash,[string]$Code,[string]$Boundary){
 $s=Read-OwnerProductionExerciseSnapshot $State $State.context.configuration.configPath 1048576 $Boundary
 if($s.sha256 -cne $ExpectedHash -or $s.aclSha256 -cne $State.original.aclSha256 -or $s.identityKey -cnotin @($State.original.identityKey,$State.candidateIdentity,$State.currentIdentity)){Stop-OwnerProductionExerciseIntegrity $State}
 $configuration=Invoke-OwnerProductionExerciseBoundary $State $Boundary {ConvertFrom-OwnerProductionExerciseCipherLeaf $s.bytes};Assert-OwnerProductionExerciseConfiguration $State $configuration $Code;$configuration=$null;$State.currentIdentity=$s.identityKey;return $s
}
function Restore-OwnerProductionExerciseOriginal($State,[bool]$Planned){
 $operationPhase=if($State.phase -ceq 'RECOVERY'){'RECOVERY'}else{'PLANNED'};$boundary=if($Planned){'planned-restore'}else{'rollback-replace'}
 $current=Read-OwnerProductionExerciseSnapshot $State $State.context.configuration.configPath 1048576 $boundary
 $backupMetadata=Invoke-OwnerProductionExerciseBoundary $State $boundary {Get-OwnerProductionExerciseMetadataLeaf $State.backupPath};$failedMetadata=Invoke-OwnerProductionExerciseBoundary $State $boundary {Get-OwnerProductionExerciseMetadataLeaf $State.failedPath}
 if($current.sha256 -ceq $State.candidateHash){
  if(-not $backupMetadata.exists -or $failedMetadata.exists){Stop-OwnerProductionExerciseIntegrity $State}
  $backup=Read-OwnerProductionExerciseSnapshot $State $State.backupPath 1048576 $boundary;if($backup.sha256 -cne $State.original.sha256 -or $backup.aclSha256 -cne $State.original.aclSha256 -or $backup.identityKey -cnotin @($State.original.identityKey,$State.backupIdentity)){Stop-OwnerProductionExerciseIntegrity $State}
  $null=Read-OwnerProductionExerciseCurrent $State $State.candidateHash $State.newCode $boundary
  $null=Invoke-OwnerProductionExerciseBoundary $State $boundary {$State.restoreEntered=$true;Replace-OwnerProductionExerciseFileLeaf $State.backupPath $State.context.configuration.configPath $State.failedPath} ($operationPhase+'_REPLACE')
 }elseif($current.sha256 -ceq $State.original.sha256){
  # Reconcile only a journal-entered owned replace, never arbitrary drift.
  if(-not $State.forwardReplaceEntered -or $backupMetadata.exists -or (-not $State.restoreEntered -and $failedMetadata.exists)){Stop-OwnerProductionExerciseIntegrity $State}
 }else{Stop-OwnerProductionExerciseIntegrity $State}
 $restored=Read-OwnerProductionExerciseCurrent $State $State.original.sha256 $State.oldCode $boundary
 if($State.restoreEntered){$retained=Read-OwnerProductionExerciseSnapshot $State $State.failedPath 1048576 $boundary;if($retained.sha256 -cne $State.candidateHash -or $retained.aclSha256 -cne $State.original.aclSha256 -or $retained.identityKey -cnotin @($State.candidateIdentity,$State.replacedIdentity)){Stop-OwnerProductionExerciseIntegrity $State}}
 Restart-OwnerProductionExerciseTask $State $operationPhase;Test-OwnerProductionExerciseLogin $State $State.oldCode $operationPhase;Test-OwnerProductionExerciseHealth $State
 # Owned readback + successful old login/runtime establish a working original
 # route before any later database/checkpoint/UI/report may fail. This private
 # evidence only prevents redundant effects; it never grants completion.
 $State.workingRestoration=@{configurationSha256=$restored.sha256;aclSha256=$restored.aclSha256;identityKey=$restored.identityKey;oldLoginVerified=$true;runtimeVerified=$true}
 $null=Invoke-OwnerProductionExerciseBoundary $State 'rollback-runtime' {Assert-OwnerProductionExerciseRuntimeData $State}
 $event=if($Planned){'after-planned-restore'}else{'after-rollback'};Invoke-OwnerProductionExercisePreservation $State $event
 $null=Read-OwnerProductionExerciseCurrent $State $State.original.sha256 $State.oldCode $boundary;Assert-OwnerProductionExerciseGuard $State
}
function Invoke-OwnerProductionGuardedExercise {
 param([object]$Admission)
 $result=New-OwnerProductionExerciseResult;$State=$null;$stage='context'
 try{
  $used=$null;if($null -ne $Admission -and $script:OwnerProductionHelperState.exerciseAdmissions.TryGetValue($Admission,[ref]$used)){return $result}
  $context=Resolve-OwnerProductionExerciseContext $Admission;Assert-OwnerProductionExerciseContextShape $context
  $migration=$null;if(-not $script:OwnerProductionHelperState.attempts.TryGetValue($context.attemptIdentity,[ref]$migration) -or -not $migration.consumed -or -not [object]::ReferenceEquals($migration.admission,$Admission)){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}
  foreach($key in @('attemptIdentity','proofEvidenceIdentity','originalClockIdentity','journalIdentity','recoveryWitnessIdentity','preservationSessionIdentity')){if(-not [object]::ReferenceEquals($context.$key,$migration.identities[$key])){throw 'ROTATION_CUTOVER_EXERCISE_CONTEXT_REQUIRED'}}
  $previous=$null;if($script:OwnerProductionHelperState.exerciseAttempts.TryGetValue($context.attemptIdentity,[ref]$previous)){throw 'ROTATION_CUTOVER_ATTEMPT_CONSUMED'}
  $identities=@{};foreach($key in @('contextIdentity','attemptIdentity','proofEvidenceIdentity','originalClockIdentity','journalIdentity','recoveryWitnessIdentity','preservationSessionIdentity','sourceIdentity','expectedTaskIdentity','environmentIdentity','configuration')){$identities[$key]=$context.$key}
  $profile=$context.configuration.stateRoot.Substring(0,$context.configuration.stateRoot.Length-'\JARVIS\production'.Length)
  $State=@{context=$context;admission=$Admission;fingerprint=(Get-OwnerProductionExerciseContextFingerprint $context);bindingFingerprint=(Get-OwnerProductionExerciseBindingFingerprint $context.configuration);guardValues=(Get-OwnerProductionExerciseGuardValues $context);contextShape=(Get-OwnerProductionExerciseShapeSignature $context);bindingShape=(Get-OwnerProductionExerciseShapeSignature $context.configuration);identities=$identities;phase='FORWARD';terminal=$false;clockInitialized=$false;hardEndUtc=$null;forward=0.0;hard=0.0;slots=@{};boundaryMemory=@{};checkpoints=[Collections.Generic.List[string]]::new();ownerProfile=$profile;original=$context.configuration.configSnapshot;projection=$null;oldCode=$null;newCode=$null;candidateHash=$null;candidateIdentity=$null;currentIdentity=$context.configuration.configSnapshot.identityKey;backupIdentity=$null;replacedIdentity=$null;candidatePath=($context.configuration.stateRoot+'\config.dpapi.'+$context.attemptId+'.candidate');backupPath=($context.configuration.stateRoot+'\config.dpapi.'+$context.attemptId+'.backup');failedPath=($context.configuration.stateRoot+'\config.dpapi.'+$context.attemptId+'.failed');candidateCreated=$false;ownedResourceCleanupFailed=$false;candidateStream=$null;forwardReplaceEntered=$false;restoreEntered=$false;workingRestoration=$null}
  $originalObservation=$null;if($script:OwnerProductionHelperState.clocks.TryGetValue($context.originalClockIdentity,[ref]$originalObservation) -and $originalObservation.initialized){$State.clockInitialized=$true;$State.hardEndUtc=$originalObservation.hardEndUtc;$State.forward=$originalObservation.forward;$State.hard=$originalObservation.hard}
  # Separate C3 stage is consumed before ambiguous reservation, on the SAME
  # migration attempt/context/journal. No Task2B rebind/unconsume/second update.
  $script:OwnerProductionHelperState.exerciseAdmissions.Add($Admission,$State);$script:OwnerProductionHelperState.exerciseAttempts.Add($context.attemptIdentity,$State);$script:OwnerProductionHelperState.exerciseContexts.Add($context.contextIdentity,$State)
  # Raw identity lookup only: never call Task2B's forward-only observer during
  # C3 recovery. Bind all original scalar provenance before any C3 journal IO.
  $originalAdmission=Invoke-OwnerProductionExerciseBoundary $State 'authority-observations' {Resolve-OwnerProductionNativeAdmission $Admission}
  if((Get-OwnerProductionAdmissionFingerprint $originalAdmission) -cne $migration.fingerprint){Stop-OwnerProductionExerciseIntegrity $State}
  foreach($key in @('profile','sourceRevision','sourceClosureSha256','originalGrantSha256','attemptId','ownerSid','sessionId','processId')){if(-not [object]::Equals($context.$key,$originalAdmission.$key)){Stop-OwnerProductionExerciseIntegrity $State}}
  $null=Invoke-OwnerProductionExerciseBoundary $State 'exercise-entry' {$null} 'EXERCISE_STAGE'
  $State.projection=Invoke-OwnerProductionExerciseBoundary $State 'context-allocation' {Get-OwnerProductionExerciseProjection $context.configuration.configuration}
  $stage='confirmation';$confirmation=Invoke-OwnerProductionExerciseBoundary $State 'confirmation-ui' {Show-OwnerProductionExerciseConfirmationLeaf $State} 'CONFIRMATION'
  Assert-OwnerProductionShape $confirmation @('confirmed','warning');if($confirmation.confirmed -isnot [bool] -or $confirmation.warning -isnot [bool]){throw 'ROTATION_CANCELLED'};$result.rotation.confirmationVerified=$confirmation.confirmed;$result.rotation.sessionInvalidationWarningVerified=$confirmation.warning
  if(-not $confirmation.confirmed -or -not $confirmation.warning){$result.rotation.failureCode='ROTATION_CANCELLED';throw 'ROTATION_CANCELLED'}
  $stage='configuration';$current=Read-OwnerProductionExerciseSnapshot $State $context.configuration.configPath
  if($current.sha256 -cne $State.original.sha256 -or $current.aclSha256 -cne $State.original.aclSha256 -or $current.identityKey -cne $State.original.identityKey){Stop-OwnerProductionExerciseIntegrity $State}
  $configuration=Invoke-OwnerProductionExerciseBoundary $State 'context-allocation' {ConvertFrom-OwnerProductionExerciseCipherLeaf $current.bytes};$State.oldCode=$configuration.environment.JARVIS_OWNER_SECRET;Assert-OwnerProductionExerciseConfiguration $State $configuration $State.oldCode;$State.originalAcl=$current.acl
  $stage='before-rotation';Assert-OwnerProductionExerciseRuntimeData $State;Test-OwnerProductionExerciseHealth $State;Invoke-OwnerProductionExercisePreservation $State 'before-rotation'
  $null=Invoke-OwnerProductionExerciseBoundary $State 'attempt-record' {$null}
  $stage='candidate';$State.newCode=Invoke-OwnerProductionExerciseBoundary $State 'credential-candidate' {New-OwnerProductionExerciseCodeLeaf};if($State.newCode -isnot [string] -or $State.newCode.Length -lt 24 -or $State.newCode -match '[\r\n\x00]'){throw 'CANDIDATE_REJECTED'};$result.rotation.credentialGenerated=$true
  $candidate=($configuration|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 -Compress)|Microsoft.PowerShell.Utility\ConvertFrom-Json;$candidate.environment.JARVIS_OWNER_SECRET=$State.newCode;Assert-OwnerProductionExerciseConfiguration $State $candidate $State.newCode;$json=$candidate|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 -Compress
  Invoke-OwnerProductionExerciseValidation $State $json;$result.rotation.configurationValidated=$true
  $cipher=Invoke-OwnerProductionExerciseBoundary $State 'credential-candidate' {ConvertTo-OwnerProductionExerciseCipherLeaf $json};if($cipher -isnot [string] -or $cipher.Length -gt 1048576){throw 'CANDIDATE_REJECTED'};$bytes=[Text.Encoding]::ASCII.GetBytes($cipher)
  foreach($path in @($State.candidatePath,$State.backupPath,$State.failedPath)){Assert-OwnerProductionExercisePath $State $path $true;$m=Invoke-OwnerProductionExerciseBoundary $State 'credential-candidate' {Get-OwnerProductionExerciseMetadataLeaf $path};if($m.exists){throw 'CANDIDATE_REJECTED'}}
  $null=Invoke-OwnerProductionExerciseBoundary $State 'credential-candidate' {$State.candidateStream=Open-OwnerProductionExerciseWriteLeaf $State.candidatePath;$State.candidateCreated=$true} 'CANDIDATE_CREATE'
  $null=Invoke-OwnerProductionExerciseBoundary $State 'credential-candidate' {$State.candidateStream.Write($bytes,0,$bytes.Length)} 'CANDIDATE_WRITE'
  $null=Invoke-OwnerProductionExerciseBoundary $State 'credential-candidate' {$State.candidateStream.Flush($true)} 'CANDIDATE_FLUSH'
  $null=Invoke-OwnerProductionExerciseBoundary $State 'credential-candidate' {$State.candidateStream.Dispose();$State.candidateStream=$null} 'CANDIDATE_CLOSE'
  $null=Invoke-OwnerProductionExerciseBoundary $State 'candidate-acl-hashes' {Set-OwnerProductionExerciseAclLeaf $State.candidatePath $State.originalAcl} 'CANDIDATE_ACL'
  $snapshot=Read-OwnerProductionExerciseSnapshot $State $State.candidatePath 1048576 'candidate-acl-hashes';$hash=[Security.Cryptography.SHA256]::Create();try{$expected=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($snapshot.sha256 -cne $expected -or $snapshot.aclSha256 -cne $State.original.aclSha256){throw 'CANDIDATE_REJECTED'};$State.candidateHash=$snapshot.sha256;$State.candidateIdentity=$snapshot.identityKey
  $stage='replace';$null=Read-OwnerProductionExerciseCurrent $State $State.original.sha256 $State.oldCode 'forward-replace'
  $null=Invoke-OwnerProductionExerciseBoundary $State 'forward-replace' {$State.forwardReplaceEntered=$true;Replace-OwnerProductionExerciseFileLeaf $State.candidatePath $context.configuration.configPath $State.backupPath} 'FORWARD_REPLACE'
  $active=Read-OwnerProductionExerciseCurrent $State $State.candidateHash $State.newCode 'forward-replace';$State.replacedIdentity=$active.identityKey;$result.rotation.atomicReplacementVerified=$true
  $backup=Read-OwnerProductionExerciseSnapshot $State $State.backupPath 1048576 'forward-replace';if($backup.sha256 -cne $State.original.sha256 -or $backup.aclSha256 -cne $State.original.aclSha256 -or $backup.identityKey -cnotin @($State.original.identityKey,$State.candidateIdentity)){throw 'BACKUP_REJECTED'};$State.backupIdentity=$backup.identityKey;$result.rotation.protectedBackupVerified=$true
  $stage='restart';Restart-OwnerProductionExerciseTask $State 'FORWARD';$stage='new-login';Test-OwnerProductionExerciseLogin $State $State.newCode 'FORWARD';$result.rotation.newLoginVerified=$true;Test-OwnerProductionExerciseHealth $State
  $stage='before-commit';$null=Invoke-OwnerProductionExerciseBoundary $State 'forward-checkpoints' {Assert-OwnerProductionExerciseRuntimeData $State};Invoke-OwnerProductionExercisePreservation $State 'before-commit';Assert-OwnerProductionExerciseGuard $State;$result.rotation.complete=$true;$result.rotation.failureCode=$null;$result.rotation.failedStage=$null
  $stage='planned-restoration';Invoke-OwnerProductionExercisePreservation $State 'before-planned-restore';$result.restoration.attempted=$true
  Restore-OwnerProductionExerciseOriginal $State $true
  $result.restoration.atomicRestorationVerified=$true;$result.restoration.oldLoginVerified=$true;$result.restoration.runtimeVerified=$true;$result.restoration.preservationVerified=$true;$result.restoration.finalOriginalConfigurationVerified=$true;$result.restoration.encryptedCandidateRetained=$true
  $stage='result';$null=Invoke-OwnerProductionExerciseBoundary $State 'result-ui' {Show-OwnerProductionExerciseResultLeaf $State $result} 'RESULT_UI';Assert-OwnerProductionExerciseGuard $State
  $result.restoration.complete=$true;$result.complete=$true;$result.failureCode=$null;$result.failedStage=$null
 }catch{
  if($State){$State.failureLine=$_.InvocationInfo.ScriptLineNumber;$State.failureType=$_.Exception.GetType().Name;$State.failureCategory=if($_.Exception.Message -cmatch '^[A-Z0-9_]+$'){$_.Exception.Message}else{'CLOSED_INTERNAL_FAILURE'}}
  if(-not $result.rotation.complete){if($result.rotation.failureCode -cne 'ROTATION_CANCELLED'){$result.rotation.failureCode=if($stage -ceq 'context'){'ROTATION_CONTEXT_UNAVAILABLE'}else{'ROTATION_REJECTED'}};$result.rotation.failedStage=if($stage -cin @('context','confirmation','configuration','before-rotation','candidate','replace','restart','new-login','before-commit')){$stage}else{'protocol'};$result.failureCode='ROTATION_EXERCISE_INCOMPLETE';$result.failedStage='rotation'}else{$result.failureCode=if($stage -ceq 'result'){'ROTATION_REJECTED'}else{'ROTATION_EXERCISE_INCOMPLETE'};$result.failedStage=if($stage -ceq 'result'){'result'}else{'planned-restoration'};if($stage -cne 'result'){$result.restoration.failureCode='ROTATION_PLANNED_RESTORE_FAILED'}}
  if($State -and $State.workingRestoration -and $result.rotation.complete){$result.restoration.atomicRestorationVerified=$true;$result.restoration.oldLoginVerified=$true;$result.restoration.runtimeVerified=$true}
  if($State -and $State.forwardReplaceEntered -and -not $State.terminal -and -not $State.workingRestoration){
   $State.phase='RECOVERY'
   if($result.rotation.complete){$result.restoration.recoveryAttempted=$true}else{$result.rotation.rollbackAttempted=$true;$result.rotation.failureCode='ROTATION_RECOVERY_FAILED';$result.rotation.failedStage='rollback'}
   try{Restore-OwnerProductionExerciseOriginal $State ([bool]$result.rotation.complete);if($result.rotation.complete){$result.restoration.recoveryVerified=$true;$result.restoration.atomicRestorationVerified=$true;$result.restoration.oldLoginVerified=$true;$result.restoration.runtimeVerified=$true;$result.restoration.preservationVerified=$true;$result.restoration.finalOriginalConfigurationVerified=$true;$result.restoration.encryptedCandidateRetained=$true}else{$result.rotation.rollbackVerified=$true;$result.rotation.oldLoginVerified=$true;$result.rotation.failureCode='ROTATION_FAILED_RECOVERED'}}catch{}
  }
 }finally{
  if($State){
   if($State.ownedResourceCleanupFailed){$result.complete=$false;$result.restoration.complete=$false;if(-not $result.rotation.complete){$result.rotation.cleanupFailed=$true;$result.rotation.failureCode='ROTATION_CLEANUP_FAILED';$result.rotation.failedStage='cleanup';$result.failureCode='ROTATION_EXERCISE_INCOMPLETE';$result.failedStage='rotation'}}
   if($State.candidateStream){try{$State.candidateStream.Dispose()}catch{};$State.candidateStream=$null}
   if($State.candidateCreated -and -not $State.terminal -and -not ($State.workingRestoration -and -not $result.complete)){
    try{$State.phase='RECOVERY';$m=Invoke-OwnerProductionExerciseBoundary $State 'candidate-cleanup' {Get-OwnerProductionExerciseMetadataLeaf $State.candidatePath};if($m.exists){if(-not $State.candidateHash){throw 'PARTIAL_CIPHER_RETAINED'};$candidateSnapshot=Read-OwnerProductionExerciseSnapshot $State $State.candidatePath 1048576 'candidate-cleanup';if($candidateSnapshot.sha256 -cne $State.candidateHash -or $candidateSnapshot.aclSha256 -cne $State.original.aclSha256 -or $candidateSnapshot.identityKey -cne $State.candidateIdentity){throw 'CLEANUP_UNOWNED'};$null=Invoke-OwnerProductionExerciseBoundary $State 'candidate-cleanup' {Remove-OwnerProductionExerciseFileLeaf $State.candidatePath} 'CANDIDATE_CLEANUP'}}catch{$result.complete=$false;$result.restoration.complete=$false;$result.failureCode='ROTATION_EXERCISE_INCOMPLETE';if($result.rotation.complete){$result.restoration.failureCode='ROTATION_PLANNED_RESTORE_FAILED';$result.failedStage='planned-restoration'}else{$result.rotation.cleanupFailed=$true;$result.rotation.failureCode='ROTATION_CLEANUP_FAILED';$result.rotation.failedStage='cleanup';$result.failedStage='rotation'}}
   }
   $State.oldCode=$null;$State.newCode=$null
  }
  $configuration=$null;$candidate=$null;$json=$null;$cipher=$null;$bytes=$null
 }
 return $result
}

if($MyInvocation.InvocationName -ne '.'){@{schemaVersion=1;operation='production-fixed-task-action-migration';mode='PLAN_ONLY';complete=$false;nativeCalls=0}|ConvertTo-Json -Compress}
