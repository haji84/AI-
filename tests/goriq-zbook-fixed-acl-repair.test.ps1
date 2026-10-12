Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-fixed-acl-repair.ps1'
if(-not(Test-Path -LiteralPath $source)){throw 'fixed-repair-helper-missing'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'fixed-repair-parse'}
foreach($name in @('Get-FixedTargets','New-FixedDescriptor','Initialize-FixedNative','Get-FixedRecord','Assert-FixedRecord','Invoke-FixedTransition','Restore-FixedRecords','Get-FixedHash','Write-FixedTransaction','Read-FixedTransaction','Import-FixedFunctions')){
 $def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if($null -eq $def){throw 'fixed-function-missing'}
 Invoke-Expression $def.Extent.Text
}
$targets=@(Get-FixedTargets 'fixture')
if($targets.Count -ne 5 -or $targets[2].path -notmatch 'a49c458d69a28c0266be8fcad5b26253e5ed8d75$'){throw 'fixed-target-scope'}
if($env:OS -ne 'Windows_NT'){Write-Output 'Fixed repair syntax/scope PASS; Windows native required';return}
Initialize-FixedNative
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
