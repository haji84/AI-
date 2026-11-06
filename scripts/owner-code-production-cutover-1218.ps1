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
if($MyInvocation.InvocationName -ne '.'){@{schemaVersion=1;operation='production-fixed-task-action-migration';mode='PLAN_ONLY';complete=$false;nativeCalls=0}|ConvertTo-Json -Compress}
