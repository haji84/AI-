Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-fixed-acl-repair.ps1'
if(-not(Test-Path -LiteralPath $source)){throw 'fixed-repair-helper-missing'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'fixed-repair-parse'}
foreach($name in @('Get-FixedTargets','New-FixedDescriptor','Initialize-FixedNative','Get-FixedRecord','Assert-FixedRecord','Invoke-FixedTransition','Restore-FixedRecords','Get-FixedHash','Write-FixedTransaction','Read-FixedTransaction','Import-FixedFunctions','Test-FixedReconciliation','Invoke-FixedHostTransaction','Assert-FixedTree','Get-FixedState','Get-FixedBytes','Initialize-FixedProcessNative','Bind-FixedProcessTree','Test-FixedStopRequired','Close-FixedHandles','Open-FixedHandles','Assert-FixedKnownTargets','Persist-FixedHostBaseline','Stop-FixedHost','Write-FixedTargets','Start-FixedHost','Verify-FixedHost','Recover-FixedHost','Invoke-FixedRestore','Assert-FixedRuntime','Assert-FixedGuards')){
 $def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if($null -eq $def){throw 'fixed-function-missing'}
 Invoke-Expression $def.Extent.Text
}
# The same owned-process guard must accept the network-waiting three-port
# baseline, require 8792 with the private address, and refuse unknown state.
# This is an isolated process/port fixture: no production task or ACL writes.
& {
 $runtimeSource=Join-Path $PSScriptRoot '..\\scripts\\goriq-pc-runtime-refresh-windows.ps1'
 $runtimeTokens=$null;$runtimeErrors=$null
 $runtimeAst=[Management.Automation.Language.Parser]::ParseFile($runtimeSource,[ref]$runtimeTokens,[ref]$runtimeErrors)
 if($runtimeErrors.Count){throw 'listener-runtime-parse'}
 $ownedDef=$runtimeAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-OwnedTree'},$true)
 if($null -eq $ownedDef){throw 'listener-owned-tree-missing'}
 Invoke-Expression $ownedDef.Extent.Text
 $installationRoot='fixture-installation';$launcherPath='fixture-launcher';$compat='fixture-compat'
 $ports=@(3000,8787,8790,8792)
 $identity=[pscustomobject]@{User=[pscustomobject]@{Value='S-1-5-21-9001'}}
 $script:listenerTestState=[pscustomobject]@{privateAddressAssigned=$false}
 $script:listenerTestPorts=@(3000,8787,8790)
 $script:listenerTestPhases=@();$script:listenerReadCount=0
 $script:listenerTestStates=@();$script:inspectionCount=0;$script:inspectionError=$false
 function Get-CimInstance {
   param([string]$ClassName,[int]$OperationTimeoutSec)
   [pscustomobject]@{Name='node.exe';ProcessId=700;ParentProcessId=0;CommandLine='node fixture-release jarvis-remote-host.mjs'}
 }
 function Invoke-CimMethod {
   param($InputObject,[string]$MethodName,[int]$OperationTimeoutSec)
   [pscustomobject]@{ReturnValue=0;Sid='S-1-5-21-9001'}
 }
 function Get-LiveListeners {
   $script:listenerReadCount++
   $current=$script:listenerTestPorts
   if($script:listenerTestPhases.Count -ge $script:listenerReadCount){
     $current=$script:listenerTestPhases[$script:listenerReadCount-1]
   }
   foreach($port in $current){
     if($port -is [int]){[pscustomobject]@{LocalPort=$port;OwningProcess=700;LocalAddress='127.0.0.1'}}
     elseif($null -ne $port -and $null -ne $port.PSObject.Properties['LocalPort']){$port}
     else{throw 'listener-fixture-invalid-port-shape'}
   }
 }
 function Inspect-State {
   param([string]$operation)
   $script:inspectionCount++
   if($script:inspectionError){throw 'inspector-unavailable'}
   if($script:listenerTestStates.Count -ge $script:inspectionCount){
     return $script:listenerTestStates[$script:inspectionCount-1]
   }
   $script:listenerTestState
 }
 try {
   Write-Output 'Listener fixture: first healthy baseline'
   if(@(Get-OwnedTree 'fixture-release').Count -ne 1){throw 'listener-three-port-rejected'}
   $script:listenerTestState=[pscustomobject]@{privateAddressAssigned=$true}
   $rejected=$false
   try{$null=Get-OwnedTree 'fixture-release'}catch{
     if($_.Exception.Message -cne 'listeners'){throw};$rejected=$true
   }
   if(-not $rejected){throw 'listener-missing-private-port-accepted'}
   $script:listenerTestPorts=@(3000,8787,8790,8792)
   if(@(Get-OwnedTree 'fixture-release').Count -ne 1){throw 'listener-four-port-rejected'}
   $script:listenerTestState=[pscustomobject]@{privateAddressAssigned=$false}
   $rejected=$false
   try{$null=Get-OwnedTree 'fixture-release'}catch{
     if($_.Exception.Message -cne 'listeners'){throw};$rejected=$true
   }
   if(-not $rejected){throw 'listener-unexpected-private-port-accepted'}
   $script:listenerTestPorts=@(3000,8787,8790)
   foreach($bad in @($null,[pscustomobject]@{},[pscustomobject]@{privateAddressAssigned='False'})){
     $script:listenerTestState=$bad;$rejected=$false
     try{$null=Get-OwnedTree 'fixture-release'}catch{
       if($_.Exception.Message -cne 'private-address-query'){throw};$rejected=$true
     }
     if(-not $rejected){throw 'listener-unknown-private-state-accepted'}
   }
   Write-Output 'Listener fixture: inspector exception and outsider ownership'
   $script:inspectionError=$true
   $rejected=$false
   try{$null=Get-OwnedTree 'fixture-release'}catch{
     if($_.Exception.Message -cne 'private-address-query'){throw};$rejected=$true
   }
   $script:inspectionError=$false
   if(-not $rejected){throw 'listener-inspector-exception-accepted'}
   # Even with the correct listener count, an outsider-owned entry is rejected.
   foreach($badPort in @(3000,8792)){
     $script:listenerTestState=[pscustomobject]@{privateAddressAssigned=($badPort -eq 8792)}
     $script:listenerTestPorts=if($badPort -eq 8792){@(3000,8787,8790,8792)}else{@(3000,8787,8790)}
     $script:listenerTestPorts=@($script:listenerTestPorts | ForEach-Object {
       if($_ -eq $badPort){[pscustomobject]@{LocalPort=$_;OwningProcess=701;LocalAddress='127.0.0.1'}}else{$_}
     })
     $rejected=$false
     try{$null=Get-OwnedTree 'fixture-release'}catch{
       if($_.Exception.Message -cne 'listeners'){throw};$rejected=$true
     }
     if(-not $rejected){throw 'listener-outsider-owner-accepted'}
   }
   $script:listenerTestPorts=@(3000,8787,8790)
   $script:listenerTestState=[pscustomobject]@{privateAddressAssigned=$false}
   # Explicit expected ports and rollback-mode calls retain their old behavior.
   $script:inspectionError=$true;$script:inspectionCount=0
   if(@(Get-OwnedTree 'fixture-release' $true @(3000,8787,8790)).Count -ne 1 -or
     $script:inspectionCount -ne 0){throw 'listener-explicit-ports-regressed'}
   if(@(Get-OwnedTree 'fixture-release' $false).Count -ne 1 -or
     $script:inspectionCount -ne 0){throw 'listener-recovery-mode-regressed'}
   $script:inspectionError=$false
   Write-Output 'Listener fixture: IP transition cases'
   # Deliberately alter OS address state during the two-sample preflight.
   foreach($transition in @(@($false,$true),@($true,$false))){
     $script:listenerTestStates=@()
     foreach($state in $transition){
       $script:listenerTestStates+=,[pscustomobject]@{privateAddressAssigned=[bool]$state}
     }
     $script:inspectionCount=0;$rejected=$false
     try{$null=Get-OwnedTree 'fixture-release'}catch{
       if($_.Exception.Message -cne 'private-address-query'){throw};$rejected=$true
     }
     if(-not $rejected -or $script:inspectionCount -ne 2){throw 'listener-ip-transition-accepted'}
   }
   $script:listenerTestStates=@()
   Write-Output 'Listener fixture: port transition cases'
   # A listener appearing or disappearing during the IP inspector also rejects.
   foreach($reverse in @($false,$true)){
     $script:listenerTestState=[pscustomobject]@{privateAddressAssigned=$reverse}
     $firstPorts=if($reverse){@(3000,8787,8790,8792)}else{@(3000,8787,8790)}
     $nextPorts=if($reverse){@(3000,8787,8790)}else{@(3000,8787,8790,8792)}
     $script:listenerTestPhases=@()
     $script:listenerTestPhases+=,$firstPorts
     $script:listenerTestPhases+=,$nextPorts
     $script:listenerReadCount=0;$rejected=$false
     try{$null=Get-OwnedTree 'fixture-release'}catch{
       if($_.Exception.Message -cne 'listeners'){throw};$rejected=$true
     }
     if(-not $rejected -or $script:listenerReadCount -ne 2){throw 'listener-port-transition-accepted'}
   }
   $script:listenerTestPhases=@()
   $script:listenerTestPorts=@(3000,8787,8790)
   $script:listenerTestState=[pscustomobject]@{privateAddressAssigned=$false}
   Write-Output 'Listener fixture: ownership transition case'
   # Rebinding an owned port to a new PID between listener samples must reject.
   $script:listenerTestPhases=@()
   $script:listenerTestPhases+=,@(3000,8787,8790)
   $script:listenerTestPhases+=,@(3000,[pscustomobject]@{LocalPort=8787;OwningProcess=701;LocalAddress='127.0.0.1'},8790)
   $script:listenerReadCount=0;$rejected=$false
   try{$null=Get-OwnedTree 'fixture-release'}catch{
     if($_.Exception.Message -cne 'listeners'){throw};$rejected=$true
   }
   if(-not $rejected){throw 'listener-owner-transition-accepted'}
   Write-Output 'Private-address-conditioned listener ownership/stable-state/foreign-owner/recovery fixtures PASS'
 }finally{
   $script:listenerTestState=$null;$script:listenerTestPorts=$null
   $script:listenerTestPhases=@();$script:listenerTestStates=@()
   $script:inspectionError=$false
 }
}
$targets=@(Get-FixedTargets 'fixture')
if($targets.Count -ne 5 -or $targets[2].path -notmatch 'a49c458d69a28c0266be8fcad5b26253e5ed8d75$'){throw 'fixed-target-scope'}
$root='fixture';$SourceRevision='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';$releaseRoot='existing'
$script:inspectStateImplementation={param($operation) $releaseRoot}
if((Get-FixedState 'inspect') -cne (Join-Path $root ('releases\'+$SourceRevision)) -or $releaseRoot -cne 'existing'){throw 'host-state-root-not-isolated'}
$byteFile=[IO.Path]::GetTempFileName()
try{[IO.File]::WriteAllBytes($byteFile,[byte[]]@(0,1,128,255));if([Convert]::ToBase64String((Get-FixedBytes $byteFile)) -cne 'AAGA/w=='){throw 'host-cipher-byte-read'}}finally{[IO.File]::Delete($byteFile)}
$script:steps=New-Object 'Collections.Generic.List[string]'
$result=Invoke-FixedHostTransaction -Persist {$script:steps.Add('persist')} -Stop {$script:steps.Add('stop')} -Write {$script:steps.Add('write')} -Start {$script:steps.Add('start')} -Verify {$script:steps.Add('verify')} -Recover {$script:steps.Add('recover')}
if(-not $result.verified -or ($script:steps -join ',') -cne 'persist,stop,write,start,verify'){throw 'host-transaction-order'}
$script:steps.Clear()
$result=Invoke-FixedHostTransaction -Persist {$script:steps.Add('persist')} -Stop {$script:steps.Add('stop');throw 'unknown-stop'} -Write {$script:steps.Add('write')} -Start {$script:steps.Add('start')} -Verify {$script:steps.Add('verify')} -Recover {$script:steps.Add('recover');throw 'unknown-recovery'}
if($result.verified -or $result.restored -or ($script:steps -join ',') -cne 'persist,stop,recover'){throw 'host-unknown-stop-retried'}
$script:steps.Clear();$rejected=$false
try{$null=Invoke-FixedHostTransaction -Persist {throw 'backup-failed'} -Stop {$script:steps.Add('stop')} -Write {} -Start {} -Verify {} -Recover {$script:steps.Add('recover')}}catch{$rejected=$true}
if(-not $rejected -or $script:steps.Count){throw 'host-stopped-before-backup'}
$tree=@([pscustomobject]@{ProcessId=7;CreationDate='known';CommandLine='known'})
Assert-FixedTree $tree $tree
$rejected=$false
try{Assert-FixedTree $tree @([pscustomobject]@{ProcessId=7;CreationDate='replacement';CommandLine='known'})}catch{$rejected=$true}
if(-not $rejected){throw 'host-replaced-pid-accepted'}
# Drive the actual restore try/catch: a failure before Start cannot retry recovery.
$restoreTry=$ast.Find({param($n) $n -is [Management.Automation.Language.TryStatementAst] -and $n.Body.Extent.Text -match '^\{\s*if\(-not \$hostStopped'},$true)
$savedRecover=(Get-Item Function:Recover-FixedHost).ScriptBlock
$script:recoveryCount=0;$script:hostStopped=$true;$script:restartAttempted=$false;$script:recoveryAttempted=$false;$stopRequired=$false
function Assert-StoppedInstallation {}
Set-Item Function:Recover-FixedHost -Value {$script:recoveryCount++;$script:recoveryAttempted=$true;throw 'failed-before-start'}
try{try{& ([scriptblock]::Create($restoreTry.Extent.Text))}catch{}}finally{Set-Item Function:Recover-FixedHost -Value $savedRecover}
if($script:recoveryCount -ne 1){throw 'restore-recovery-retried'}
if($env:OS -ne 'Windows_NT'){Write-Output 'Fixed repair syntax/scope PASS; Windows native required';return}
Initialize-FixedNative
Initialize-FixedProcessNative
$backupSource=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-acl-boundary-repair.ps1'
Import-FixedFunctions (Get-Content -LiteralPath $backupSource -Raw) @('Write-BoundaryBackup')
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$user=$identity.User.Value;$reader='S-1-1-0'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('goriq-fixed-fixture-'+[guid]::NewGuid().ToString('N'))
$handles=@();$guard=$null;$dependencyGuard=$null;$link=$null;$location=Get-Location;$nativeLocation=[Environment]::CurrentDirectory
try {
 $null=New-Item -ItemType Directory -Path $fixture
 $acl=New-Object Security.AccessControl.DirectorySecurity
 $acl.SetOwner($identity.User);$acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @($user,'S-1-5-18')){
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
 }
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($reader)),'ReadAndExecute,Synchronize','ContainerInherit,ObjectInherit','None','Allow')))
 # A non-token SID Deny and audit must survive raw-mask conversion.
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-21-1-2-3-1001')),'WriteData','ContainerInherit,ObjectInherit','None','Deny')))
 $acl.AddAuditRule((New-Object Security.AccessControl.FileSystemAuditRule($identity.User,'ReadData','ContainerInherit,ObjectInherit','None','Success')))
 Set-Acl -LiteralPath $fixture -AclObject $acl
 $targets=@(Get-FixedTargets $fixture)
 foreach($entry in $targets){
  if($entry.directory){$null=New-Item -ItemType Directory -Path $entry.path}else{[IO.File]::WriteAllText($entry.path,'public fixture bytes')}
  # Elevated Windows can default new-object Owner to Administrators; emulate confirmed ZBook owner.
  $owned=Get-Acl -LiteralPath $entry.path -Audit;$owned.SetOwner($identity.User)
  Set-Acl -LiteralPath $entry.path -AclObject $owned
  if((Get-Acl -LiteralPath $entry.path).GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $user){throw 'fixture-owner-mismatch'}
 }
 $deps=Join-Path $targets[2].path 'node_modules';$outside=Join-Path $fixture 'outside'
 foreach($p in @($deps,$outside)){$null=New-Item -ItemType Directory -Path $p}
 $file=Join-Path $deps 'package.bin';$alias=Join-Path $outside 'alias.bin';$link=Join-Path $deps 'link'
 [IO.File]::WriteAllText($file,'public fixture bytes')
 $null=New-Item -ItemType HardLink -Path $alias -Target $file
 $null=New-Item -ItemType SymbolicLink -Path $link -Target $outside
 $untouched=@($fixture,$deps,$outside,$file,$alias,$link);$before=@{}
 foreach($p in $untouched){$before[$p]=(Get-Acl -LiteralPath $p -Audit).Sddl}
 $cwdBefore=@{}
 foreach($entry in $targets){$cwdBefore[$entry.path]=(Get-Acl -LiteralPath $entry.path -Audit).Sddl}
 [Environment]::CurrentDirectory=$targets[2].path
 if([Environment]::CurrentDirectory -cne $targets[2].path){throw 'native-cwd-not-set'}
 $cwdRejected=$false
 try{$cwdHandle=[GoriqFixedAclNative]::Open($targets[2].path,$true,$true);$cwdHandle.Dispose()}catch{
  if($_.Exception.InnerException.Message -cne 'HANDLE_REJECTED_32'){throw};$cwdRejected=$true
 }
 if(-not $cwdRejected){throw 'native-cwd-sharing-assumption-changed'}
 foreach($entry in $targets){if((Get-Acl -LiteralPath $entry.path -Audit).Sddl -cne $cwdBefore[$entry.path]){throw 'cwd-refusal-mutated-acl'}}
 foreach($entry in @($targets | Where-Object {-not $_.directory})){
  if((Get-FixedHash $entry.path) -cne (Get-FixedHash $file)){throw 'cwd-refusal-mutated-content'}
 }
 if(Test-Path -LiteralPath (Join-Path $fixture 'active.json')){throw 'cwd-refusal-created-intent'}
 Write-Output 'Real native CWD: MAXIMUM_ALLOWED sharing refusal before ACL/content/intent mutation PASS; runtime compatibility remains UNSATISFIED'
 [Environment]::CurrentDirectory=$nativeLocation
 # Successful transaction case explicitly requires native CWD outside its targets.
 $dependencyGuard=[GoriqFixedAclNative]::Open($deps,$false,$true)
 $records=@();$wanted=@()
 foreach($entry in $targets){
  $handle=[GoriqFixedAclNative]::Open($entry.path,$true,$entry.directory);$handles+=,$handle
  $record=Get-FixedRecord $entry $handle
  $records+=,$record
  $wanted+=,(New-FixedDescriptor $record.descriptor $user $reader $entry.directory)
 }
 # Production-equivalent descendant pins must prevent each directory rename.
 foreach($entry in @($targets | Where-Object {$_.directory})){
  $rejected=$false
  try{[IO.Directory]::Move($entry.path,($entry.path+'.moved'))}catch{$rejected=$true}
  if(-not $rejected){throw 'fixed-directory-pin-insufficient'}
 }
 # Pinned target cannot be renamed while a transaction owns its handle.
 $rejected=$false
 try{[IO.File]::Move($targets[3].path,($targets[3].path+'.moved'))}catch{$rejected=$true}
 if(-not $rejected){throw 'pinned-target-renamed'}
 for($prefix=1;$prefix -le 5;$prefix++){
  for($i=0;$i -lt $prefix;$i++){Invoke-FixedTransition $targets[$i] $handles[$i] $records[$i] $wanted[$i]}
  for($i=0;$i -lt $prefix;$i++){
   $after=Get-FixedRecord $targets[$i] $handles[$i]
   if($after.descriptor -cne $wanted[$i] -or $after.hash -cne $records[$i].hash){throw 'fixed-narrow-delta'}
  }
  foreach($p in $untouched){if((Get-Acl -LiteralPath $p -Audit).Sddl -cne $before[$p]){throw 'fixed-propagated'}}
  Restore-FixedRecords $targets $handles $records $wanted
  for($i=0;$i -lt 5;$i++){Assert-FixedRecord $records[$i] (Get-FixedRecord $targets[$i] $handles[$i])}
  foreach($p in $untouched){if((Get-Acl -LiteralPath $p -Audit).Sddl -cne $before[$p]){throw 'fixed-restore-propagated'}}
 }
 # Real ACL drift injected between restore preflight and the second read must stop.
 [GoriqFixedAclNative]::Apply($handles[0],$wanted[0])
 $driftRaw=New-Object Security.AccessControl.RawSecurityDescriptor($wanted[0])
 foreach($ace in $driftRaw.DiscretionaryAcl){if($ace.SecurityIdentifier.Value -ceq $user){$ace.AccessMask=$ace.AccessMask -band (-bnot 0x10000)}}
 $script:driftDescriptor=$driftRaw.GetSddlForm('All');$script:driftReads=0
 $script:originalRecordFunction=(Get-Item Function:Get-FixedRecord).ScriptBlock
 Set-Item Function:Get-FixedRecord -Value {
  param($entry,$handle)
  $script:driftReads++
  if($script:driftReads -eq 6){[GoriqFixedAclNative]::Apply($handle,$script:driftDescriptor)}
  & $script:originalRecordFunction $entry $handle
 }
 $rejected=$false
 try{Restore-FixedRecords $targets $handles $records $wanted}catch{
  if($_.Exception.Message -ne 'RECONCILIATION_REQUIRED'){throw};$rejected=$true
 }finally{Set-Item Function:Get-FixedRecord -Value $script:originalRecordFunction}
 if(-not $rejected){throw 'unknown-restore-drift-overwritten'}
 if((Get-FixedRecord $targets[0] $handles[0]).descriptor -cne $script:driftDescriptor){throw 'unknown-restore-drift-mutated'}
 # Test fixture reset only, never a production reconciliation override.
 [GoriqFixedAclNative]::Apply($handles[0],$records[0].descriptor)
 # Baseline drift is rejected before the writer runs.
 $bad=$records[3].PSObject.Copy();$bad.hash='wrong'
 $rejected=$false
 try{Invoke-FixedTransition $targets[3] $handles[3] $bad $wanted[3]}catch{$rejected=$true}
 if(-not $rejected){throw 'fixed-baseline-drift-accepted'}
 Assert-FixedRecord $records[3] (Get-FixedRecord $targets[3] $handles[3])
 # An expired gate blocks the actual native writer, including rollback.
 Set-Item Function:Assert-FixedExpiry -Value {throw 'APPROVAL_REJECTED'}
 $rejected=$false
 try{Invoke-FixedTransition $targets[0] $handles[0] $records[0] $wanted[0] -EnforceExpiry}catch{
  if($_.Exception.Message -ne 'APPROVAL_REJECTED'){throw};$rejected=$true
 }
 if(-not $rejected){throw 'fixed-expired-write-accepted'}
 Assert-FixedRecord $records[0] (Get-FixedRecord $targets[0] $handles[0])
 [GoriqFixedAclNative]::Apply($handles[0],$wanted[0])
 $rejected=$false
 try{Restore-FixedRecords $targets $handles $records $wanted -EnforceExpiry}catch{
  if($_.Exception.Message -ne 'APPROVAL_REJECTED'){throw};$rejected=$true
 }
 if(-not $rejected -or (Get-FixedRecord $targets[0] $handles[0]).descriptor -cne $wanted[0]){throw 'fixed-expired-restore-mutated'}
 [GoriqFixedAclNative]::Apply($handles[0],$records[0].descriptor)
 Remove-Item Function:Assert-FixedExpiry
 # DPAPI intent persists across reads and prevents transaction overwrite after crash.
 $backup=Join-Path $fixture 'before.dpapi';$marker=Join-Path $fixture 'active.json'
 $id=[guid]::NewGuid().ToString('N')
 $transaction=[pscustomobject]@{version=1;issue=1787;records=$records;wanted=$wanted;notes=('x'*100000)}
 Write-FixedTransaction $backup $marker $transaction $id
 $decoded=Read-FixedTransaction $backup $marker $id
 if($decoded.records.Count -ne 5 -or $decoded.wanted.Count -ne 5 -or $decoded.notes.Length -ne 100000){throw 'fixed-dpapi-roundtrip'}
 $originalBackup=Get-FixedHash $backup;$originalMarker=Get-FixedHash $marker
 $rejected=$false
 try{Write-FixedTransaction $backup $marker $transaction $id}catch{$rejected=$true}
 if(-not $rejected -or (Get-FixedHash $backup) -cne $originalBackup -or (Get-FixedHash $marker) -cne $originalMarker){throw 'fixed-pending-transaction-overwritten'}
 $freshBackup=Join-Path $fixture 'fresh-before.dpapi'
 $rejected=$false
 try{Write-FixedTransaction $freshBackup $marker $transaction ([guid]::NewGuid().ToString('N'))}catch{$rejected=$true}
 if(-not $rejected -or (Get-FixedHash $marker) -cne $originalMarker){throw 'fixed-active-marker-overwritten'}
 # Failure after durable intent flush leaves a reconciliation record, no target writes.
 $flushBackup=Join-Path $fixture 'flush-before.dpapi';$flushMarker=Join-Path $fixture 'flush-active.json'
 $savedRead=(Get-Item Function:Read-FixedTransaction).ScriptBlock
 Set-Item Function:Read-FixedTransaction -Value {throw 'injected-readback-failure'}
 $rejected=$false
 try{Write-FixedTransaction $flushBackup $flushMarker $transaction ([guid]::NewGuid().ToString('N'))}catch{$rejected=$true}
 finally{Set-Item Function:Read-FixedTransaction -Value $savedRead}
 if(-not $rejected -or -not(Test-Path -LiteralPath $flushMarker)){throw 'fixed-post-flush-intent-lost'}
 if(-not(Test-FixedReconciliation $flushMarker $false $false 'FIXED_REPAIR_FAILED')){throw 'fixed-pending-intent-status-hidden'}
 if(-not(Test-FixedReconciliation $flushMarker $false $false 'APPROVAL_REJECTED')){throw 'fixed-expired-intent-status-hidden'}
 if(Test-FixedReconciliation (Join-Path $fixture 'absent.json') $false $false 'ARTIFACT_REJECTED'){throw 'fixed-clean-status-wrong'}
 $rejected=$false
 try{$null=Read-FixedTransaction $backup $marker ([guid]::NewGuid().ToString('N'))}catch{$rejected=$true}
 if(-not $rejected){throw 'fixed-wrong-backup-accepted'}
 $cipher=[IO.File]::ReadAllBytes($backup);$cipher[0]=$cipher[0] -bxor 1;[IO.File]::WriteAllBytes($backup,$cipher)
 $rejected=$false
 try{$null=Read-FixedTransaction $backup $marker $id}catch{$rejected=$true}
 if(-not $rejected){throw 'fixed-tampered-backup-accepted'}
 [IO.File]::WriteAllText($marker,'{')
 $rejected=$false
 try{$null=Read-FixedTransaction $backup $marker $id}catch{$rejected=$true}
 if(-not $rejected){throw 'fixed-truncated-intent-accepted'}
 for($i=0;$i -lt 5;$i++){Assert-FixedRecord $records[$i] (Get-FixedRecord $targets[$i] $handles[$i])}
 Write-Output 'Fixed DPAPI large baseline/intent crash persistence/overwrite/tamper refusal and expired mutation/restore refusal PASS'
 # Unsupported callback ACE must never be normalized into an ordinary allow.
 $raw=New-Object Security.AccessControl.RawSecurityDescriptor($records[0].descriptor)
 $callback=New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]::Inherited,[Security.AccessControl.AceQualifier]::AccessAllowed,1,$identity.User,$true,[byte[]]@(1,2,3,4))
 $raw.DiscretionaryAcl.InsertAce(0,$callback)
 $rejected=$false
 try{$null=New-FixedDescriptor ($raw.GetSddlForm('All')) $user $reader $true}catch{$rejected=$true}
 if(-not $rejected){throw 'fixed-callback-accepted'}
 foreach($path in @($link,$alias)){
  $rejected=$false
  try{$unsafe=[GoriqFixedAclNative]::Open($path,$true,[bool](Get-Item -LiteralPath $path -Force).PSIsContainer);$unsafe.Dispose()}catch{$rejected=$true}
  if(-not $rejected){throw 'fixed-link-accepted'}
 }
 # Guard ancestor is immutable while handles are retained.
 $guard=[GoriqFixedAclNative]::Open($outside,$false,$true)
 $rejected=$false
 try{[IO.Directory]::Move($outside,($outside+'.moved'))}catch{$rejected=$true}
 if(-not $rejected){throw 'fixed-ancestor-renamed'}
 # Execute the transaction controller with real disposable native-CWD processes.
 foreach($handle in $handles){$handle.Dispose()};$handles=@()
 $script:hostHandles=@();$script:hostProcess=$null;$script:hostRecord=$null
 function New-DisposableHost([string]$cwd) {
  $code="[Environment]::CurrentDirectory='"+$cwd.Replace("'","''")+"';[Console]::Out.WriteLine('READY');[Console]::Out.Flush();[Console]::In.ReadLine()|Out-Null"
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=Join-Path $PSHOME 'powershell.exe'
  $info.Arguments='-NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
  $info.WorkingDirectory=$cwd;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $process=[Diagnostics.Process]::Start($info)
  if($process.StandardOutput.ReadLine() -cne 'READY'){$process.Dispose();throw 'disposable-host-not-ready'}
  return $process
 }
 function Start-DisposableHost {
  if($null -ne $script:hostProcess -and -not $script:hostProcess.HasExited){throw 'disposable-duplicate-host'}
  if($null -ne $script:hostProcess){$script:hostProcess.Dispose()}
  $script:hostProcess=New-DisposableHost $targets[2].path
  $script:hostRecord=Get-CimInstance Win32_Process -Filter ('ProcessId='+$script:hostProcess.Id)
 }
 function Stop-DisposableHost {
  $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+$script:hostRecord.ProcessId)
  Assert-FixedTree @($script:hostRecord) @($live)
  $owner=Invoke-CimMethod -InputObject $live -MethodName GetOwnerSid
  if($owner.ReturnValue -ne 0 -or $owner.Sid -cne $user){throw 'disposable-owner-mismatch'}
  [GoriqFixedProcessNative]::Clear()
  [GoriqFixedProcessNative]::Bind([int]$live.ProcessId,$live.CreationDate.ToUniversalTime().Ticks,$user)
  $result=[GoriqFixedProcessNative]::Terminate([int]$live.ProcessId)
  if($result -ne 0 -or -not $script:hostProcess.WaitForExit(5000)){throw 'disposable-stop-unverified'}
 }
 function Open-DisposableHandles([bool]$writable) {
  foreach($h in $script:hostHandles){$h.Dispose()};$script:hostHandles=@()
  foreach($entry in $targets){$script:hostHandles+=,[GoriqFixedAclNative]::Open($entry.path,$writable,$entry.directory)}
 }
 $unrelated=New-DisposableHost $outside
 try{
  foreach($prefixFailure in @(0,3)){
   Start-DisposableHost
   $savedRecord=$script:hostRecord
   $script:hostRecord=[pscustomobject]@{ProcessId=$savedRecord.ProcessId;CreationDate=$savedRecord.CreationDate.AddSeconds(-1);CommandLine=$savedRecord.CommandLine}
   $rejected=$false
   try{Stop-DisposableHost}catch{if($_.Exception.Message -ne 'PROCESS_CHANGED'){throw};$rejected=$true}
   finally{$script:hostRecord=$savedRecord}
   if(-not $rejected -or $script:hostProcess.HasExited -or $unrelated.HasExited){throw 'disposable-stale-process-stopped'}
   [GoriqFixedProcessNative]::Clear()
   foreach($bad in @(@{ticks=$savedRecord.CreationDate.ToUniversalTime().Ticks-10000000;sid=$user},@{ticks=$savedRecord.CreationDate.ToUniversalTime().Ticks;sid='S-1-5-18'})){
    $rejected=$false
    try{[GoriqFixedProcessNative]::Bind([int]$savedRecord.ProcessId,$bad.ticks,$bad.sid)}catch{$rejected=$true}
    if(-not $rejected -or $script:hostProcess.HasExited){throw 'disposable-native-identity-accepted'}
   }
   # With only the live child holding native CWD, the write open must refuse.
   $rejected=$false
   try{$h=[GoriqFixedAclNative]::Open($targets[2].path,$true,$true);$h.Dispose()}catch{
    if($_.Exception.InnerException.Message -cne 'HANDLE_REJECTED_32'){throw};$rejected=$true
   }
   if(-not $rejected){throw 'live-child-cwd-not-fenced'}
   $script:childMarker=Join-Path $fixture ('child-'+$prefixFailure+'.json')
   $childBackup=Join-Path $fixture ('child-'+$prefixFailure+'.dpapi')
   $childId=[guid]::NewGuid().ToString('N')
   $result=Invoke-FixedHostTransaction -Persist {
    Open-DisposableHandles $false
    for($i=0;$i -lt 5;$i++){Assert-FixedRecord $records[$i] (Get-FixedRecord $targets[$i] $script:hostHandles[$i])}
    Write-FixedTransaction $childBackup $script:childMarker ([pscustomobject]@{version=2;records=$records;wanted=$wanted}) $childId
   } -Stop {
    if(-not(Test-Path -LiteralPath $script:childMarker)){throw 'child-stopped-before-intent'}
    Stop-DisposableHost
   } -Write {
    if(-not $script:hostProcess.HasExited){throw 'child-writer-before-stop'}
    Open-DisposableHandles $true
    for($i=0;$i -lt 5;$i++){
     Invoke-FixedTransition $targets[$i] $script:hostHandles[$i] $records[$i] $wanted[$i]
     if($prefixFailure -gt 0 -and $i+1 -eq $prefixFailure){throw 'injected-child-partial-failure'}
    }
   } -Start {
    Open-DisposableHandles $false
    Start-DisposableHost
   } -Verify {
    if($script:hostProcess.HasExited -or $unrelated.HasExited){throw 'child-recovery-or-unrelated-loss'}
    for($i=0;$i -lt 5;$i++){
     $expected=$records[$i].PSObject.Copy();$expected.descriptor=$wanted[$i]
     Assert-FixedRecord $expected (Get-FixedRecord $targets[$i] $script:hostHandles[$i])
    }
    Remove-Item -LiteralPath $script:childMarker
   } -Recover {
    if(-not $script:hostProcess.HasExited){Stop-DisposableHost}
    Open-DisposableHandles $true
    Restore-FixedRecords $targets $script:hostHandles $records $wanted
    Open-DisposableHandles $false
    Start-DisposableHost
    if($script:hostProcess.HasExited -or $unrelated.HasExited){throw 'child-original-service-not-recovered'}
    for($i=0;$i -lt 5;$i++){Assert-FixedRecord $records[$i] (Get-FixedRecord $targets[$i] $script:hostHandles[$i])}
    Remove-Item -LiteralPath $script:childMarker
   }
   if($prefixFailure -eq 0 -and -not $result.verified){throw 'child-normal-transaction-failed'}
   if($prefixFailure -gt 0 -and ($result.verified -or -not $result.restored)){throw 'child-partial-recovery-failed'}
   if(Test-Path -LiteralPath $script:childMarker){throw 'child-completed-intent-remains'}
   Stop-DisposableHost
   Open-DisposableHandles $true
   Restore-FixedRecords $targets $script:hostHandles $records $wanted
   foreach($h in $script:hostHandles){$h.Dispose()};$script:hostHandles=@()
   foreach($p in $untouched){if((Get-Acl -LiteralPath $p -Audit).Sddl -cne $before[$p]){throw 'child-transaction-propagated'}}
  }
  # Exercise the production wrappers, with only scheduler/network/state discovery
  # substituted. Filesystem ACLs, DPAPI, CIM identity and pinned termination are real.
  $runtimeSource=Join-Path $PSScriptRoot '..\scripts\goriq-pc-runtime-refresh-windows.ps1'
  Import-FixedFunctions (Get-Content -LiteralPath $runtimeSource -Raw) @('Get-LiveListeners','Assert-StoppedInstallation','Assert-State-Preserved','Stop-OwnedTree','Wait-Health')
  $script:fixtureTaskState='Running';$script:failNextStart=$false;$script:fixtureStops=0;$script:fixtureStarts=0
  function Get-ScheduledTask {param($TaskName) [pscustomobject]@{State=$script:fixtureTaskState}}
  function Export-ScheduledTask {param($TaskName) 'fixture-task-xml'}
  function Stop-ScheduledTask {param($TaskName) $script:fixtureStops++;$script:fixtureTaskState='Ready'}
  function Start-ScheduledTask {
   param($TaskName)
   $script:fixtureStarts++
   if($script:failNextStart){$script:failNextStart=$false;throw 'injected-start-failure'}
   Start-DisposableHost;$script:fixtureTaskState='Running'
  }
  function Get-NetTCPConnection {param($State) if($script:fixtureTaskState -eq 'Running'){foreach($p in @(1,2)){[pscustomobject]@{LocalPort=$p;OwningProcess=$script:hostProcess.Id}}}}
  function Get-OwnedTree {
   param($root,$requireHealthy=$true,$requiredPorts=@())
   if($null -eq $script:hostProcess -or $script:hostProcess.HasExited){return @()}
   return @(Get-CimInstance Win32_Process -Filter ('ProcessId='+$script:hostProcess.Id))
  }
  $script:current=[pscustomobject]@{commit='public-old-revision'}
  function Invoke-RestMethod {param($Uri,$TimeoutSec) [pscustomobject]@{ok=$true;runtimeRevision=$script:current.commit;status='ok'}}
  $script:stateBefore=[pscustomobject]@{schemaCompatible=$true;quiescent=$true;privateAddressAssigned=$true;
   schemaDigest='schema';identityDigest='identity';fleetDigest='fleet';tasksDigest='tasks';pcTasksDigest='pc';compassDigest='compass'}
  function Inspect-State {param($operation) $script:stateBefore}
  function Assert-FixedExpiry {}
  $script:ports=@(1,2);$script:taskName='fixture';$script:taskXml='fixture-task-xml';$script:installationRoot=$fixture
  $script:config=$targets[3].path;$script:launcher=$targets[4].path
  $script:configHash=Get-FixedHash $script:config;$script:launcherHash=Get-FixedHash $script:launcher
  $script:oldRoot=$targets[2].path;$script:releaseRoot=$script:oldRoot
  $script:HostStopApproved=$true;$script:guardEntries=@();$script:guardRecords=@();$script:guards=@()
  $savedLocalAppData=$env:LOCALAPPDATA;$env:LOCALAPPDATA=$fixture
  try{
   foreach($failStartup in @($false,$true)){
    Start-DisposableHost;$script:tree=@(Get-OwnedTree $script:oldRoot)
    $script:fixtureTaskState='Running';$script:hostStopped=$false;$script:hostStopAttempted=$false
    $script:restartAttempted=$false;$script:recoveryAttempted=$false;$script:serviceRecoveryVerified=$false;$script:restored=$false;$script:changed=$false
    $script:marker=Join-Path $fixture ('wrapper-'+$failStartup+'.json')
    Open-FixedHandles $false
    if(-not(Test-FixedStopRequired)){throw 'production-probe-missed-native-cwd'}
    $script:failNextStart=$failStartup
    $result=Invoke-FixedHostTransaction -Persist {Persist-FixedHostBaseline} -Stop {Stop-FixedHost} -Write {Write-FixedTargets} -Start {Start-FixedHost} -Verify {Verify-FixedHost} -Recover {Recover-FixedHost}
    if(-not $script:hostStopAttempted -or -not $script:serviceRecoveryVerified -or $unrelated.HasExited){throw ('production-wrapper-scope-or-recovery: '+$result.failure.Message)}
    if(-not $failStartup -and -not $result.verified){throw 'production-wrapper-normal-failed'}
    if($failStartup -and ($result.verified -or -not $result.restored)){throw 'production-wrapper-failed-start-not-restored'}
    if(Test-Path -LiteralPath $script:marker){throw 'production-wrapper-intent-not-cleared'}
    Stop-DisposableHost;$script:fixtureTaskState='Ready';$script:hostStopped=$true
    Open-FixedHandles $true
    Restore-FixedRecords $targets $handles $records $wanted
    Close-FixedHandles
   }
   # Partial stop whose result is unknown must not restart or write; intent stays.
   Start-DisposableHost;$script:tree=@(Get-OwnedTree $script:oldRoot)
   $script:fixtureTaskState='Running';$script:hostStopped=$false;$script:restartAttempted=$false
   $script:hostStopAttempted=$false;$script:marker=Join-Path $fixture 'wrapper-unknown-stop.json'
   Open-FixedHandles $false
   $savedStop=(Get-Item Function:Stop-OwnedTree).ScriptBlock
   Set-Item Function:Stop-OwnedTree -Value {throw 'injected-unknown-stop'}
   try{
    $result=Invoke-FixedHostTransaction -Persist {Persist-FixedHostBaseline} -Stop {Stop-FixedHost} -Write {Write-FixedTargets} -Start {Start-FixedHost} -Verify {Verify-FixedHost} -Recover {Recover-FixedHost}
   }finally{Set-Item Function:Stop-OwnedTree -Value $savedStop}
   if($result.verified -or $result.restored -or $script:hostProcess.HasExited -or -not(Test-Path -LiteralPath $script:marker)){throw 'production-unknown-stop-retried'}
   for($i=0;$i -lt 5;$i++){Assert-FixedRecord $records[$i] (Get-FixedRecord $targets[$i] $handles[$i])}
   if(-not(Test-FixedReconciliation $script:marker $false $false 'FIXED_REPAIR_FAILED')){throw 'production-host-intent-hidden'}
   Stop-DisposableHost;Close-FixedHandles
   # Drive v2 backup validation and the actual restore entry point in all states.
   $script:candidate=[pscustomobject]@{sidValue=$reader}
   foreach($restoreCase in @('ready','running-native-cwd','running-compatible','failed-recovery')){
    $script:fixtureTaskState='Running';$script:hostStopped=$false;$script:restartAttempted=$false;$script:recoveryAttempted=$false
    $script:serviceRecoveryVerified=$false;$script:hostStopAttempted=$false;$script:restored=$false
    $script:marker=Join-Path $fixture ('restore-'+$restoreCase+'.json')
    Start-DisposableHost;$script:tree=@(Get-OwnedTree $script:oldRoot)
    Open-FixedHandles $false;Persist-FixedHostBaseline
    $script:BackupId=$script:backupIdResult
    Stop-DisposableHost;$script:fixtureTaskState='Ready';$script:hostStopped=$true
    Open-FixedHandles $true
    for($i=0;$i -lt 3;$i++){Invoke-FixedTransition $targets[$i] $handles[$i] $records[$i] $wanted[$i]}
    Open-FixedHandles $false
    if($restoreCase -eq 'running-native-cwd'){
     Start-DisposableHost;$script:fixtureTaskState='Running';$script:hostStopped=$false
    }elseif($restoreCase -eq 'running-compatible'){
     $script:hostProcess.Dispose();$script:hostProcess=New-DisposableHost $outside
     $script:hostRecord=Get-CimInstance Win32_Process -Filter ('ProcessId='+$script:hostProcess.Id)
     $script:fixtureTaskState='Running';$script:hostStopped=$false
    }
    $script:tree=@(Get-OwnedTree $script:oldRoot)
    $script:fixtureStops=0;$script:fixtureStarts=0;$script:recoveryCount=0
    $savedGuards=(Get-Item Function:Assert-FixedGuards).ScriptBlock
    if($restoreCase -eq 'failed-recovery'){
     Set-Item Function:Assert-FixedGuards -Value {if($script:recoveryAttempted){$script:recoveryCount++;throw 'injected-before-recovery-start'}}
    }
    $restoreFailed=$false
    try{Invoke-FixedRestore}catch{$restoreFailed=$true}finally{Set-Item Function:Assert-FixedGuards -Value $savedGuards}
    if($restoreCase -eq 'failed-recovery'){
     if(-not $restoreFailed -or $script:recoveryCount -ne 1 -or $script:fixtureStarts -ne 0 -or $script:fixtureStops -ne 0 -or
      -not(Test-Path -LiteralPath $script:marker)){throw 'restore-failure-retried-or-intent-lost'}
     for($i=0;$i -lt 5;$i++){
      $expected=$records[$i].PSObject.Copy();if($i -lt 3){$expected.descriptor=$wanted[$i]}
      Assert-FixedRecord $expected (Get-FixedRecord $targets[$i] $handles[$i])
     }
    }else{
     if($restoreFailed -or -not $script:restored -or (Test-Path -LiteralPath $script:marker) -or $unrelated.HasExited){throw ('restore-case-failed-'+$restoreCase)}
     $expectedStops=if($restoreCase -eq 'running-native-cwd'){1}else{0}
     $expectedStarts=if($restoreCase -eq 'running-compatible'){0}else{1}
     if($script:fixtureStops -ne $expectedStops -or $script:fixtureStarts -ne $expectedStarts){throw 'restore-scheduler-scope'}
     if($script:fixtureTaskState -ne 'Running' -or $script:hostProcess.HasExited){throw 'restore-runtime-not-running'}
     if($expectedStarts -eq 1 -and -not $script:serviceRecoveryVerified){throw 'restore-health-not-verified'}
     for($i=0;$i -lt 5;$i++){Assert-FixedRecord $records[$i] (Get-FixedRecord $targets[$i] $handles[$i])}
     Assert-FixedRuntime;Assert-FixedGuards
    }
    if(-not $script:hostProcess.HasExited){Stop-DisposableHost}
    $script:fixtureTaskState='Ready';$script:hostStopped=$true
    Open-FixedHandles $true;Restore-FixedRecords $targets $handles $records $wanted;Close-FixedHandles
   }
   Write-Output 'Actual v2 restore: Ready partial ACL, Running native CWD, compatible Running no stop, failed recovery exactly once/intent retained PASS (disposable fixtures)'
   Write-Output 'Production stop/repair/start/recovery wrappers with real pinned process/ACL/DPAPI: normal, failed-start recovery, unknown-stop no retry PASS (scheduler/network/state mocked; not physical Broker E2E)'
  }finally{$env:LOCALAPPDATA=$savedLocalAppData;Close-FixedHandles;[GoriqFixedProcessNative]::Clear()}
  Write-Output 'Disposable Windows native-CWD child: persist/scoped stop/five-object repair/restart and partial-failure original recovery PASS; unrelated process and child ACLs preserved (not physical ZBook E2E)'
 }finally{
  foreach($h in $script:hostHandles){$h.Dispose()}
  [GoriqFixedProcessNative]::Clear()
  if($null -ne $script:hostProcess){if(-not $script:hostProcess.HasExited){$script:hostProcess.StandardInput.WriteLine('exit');if(-not $script:hostProcess.WaitForExit(5000)){Stop-DisposableHost}};$script:hostProcess.Dispose()}
  if($null -ne $unrelated){if(-not $unrelated.HasExited){$unrelated.StandardInput.WriteLine('exit');if(-not $unrelated.WaitForExit(5000)){$unrelated.Kill();$unrelated.WaitForExit()}};$unrelated.Dispose()}
 }
 Write-Output 'Fixed five-object no-propagation, all partial restoration, Deny/audit/content under compatible native CWD, pinned replacement and drift/link/callback refusal PASS'
}finally{
 Set-Location $location
 [Environment]::CurrentDirectory=$nativeLocation
 foreach($handle in $handles){$handle.Dispose()}
 if($null -ne $guard){$guard.Dispose()}
 if($null -ne $dependencyGuard){$dependencyGuard.Dispose()}
 if($null -ne $link -and (Test-Path -LiteralPath $link)){[IO.Directory]::Delete($link)}
 if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Recurse -Force}
}
