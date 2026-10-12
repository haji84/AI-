param([ValidateSet('plan','apply','restore')][string]$Phase='plan',[switch]$OwnerApproved,
 [Parameter(Mandatory=$true)][string]$SourceRevision,
 [Parameter(Mandatory=$true)][string]$ExpectedRepairSha256,[string]$BackupId)
# #1787/#1662: owner approval 2026-10-12T14:39:12Z, issue comment6126491312.
# Exact five existing objects; no recursive propagation, process stop or ancestor ACL write.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$stage='approval';$changed=$false;$restored=$false;$records=@();$wanted=@();$handles=@();$guards=@()
$backupIdResult=$null;$markerCreated=$false;$transaction=$null;$sourceStreams=@();$sourceTexts=@{};$marker=$null
$sections=[Security.AccessControl.AccessControlSections]::All
function Get-FixedTargets([string]$root) {
 @([pscustomobject]@{path=(Join-Path $root 'production');directory=$true},
   [pscustomobject]@{path=(Join-Path $root 'releases');directory=$true},
   [pscustomobject]@{path=(Join-Path $root 'releases\a49c458d69a28c0266be8fcad5b26253e5ed8d75');directory=$true},
   [pscustomobject]@{path=(Join-Path $root 'production\config.dpapi');directory=$false},
   [pscustomobject]@{path=(Join-Path $root 'production\launch-current.ps1');directory=$false})
}
function Import-FixedFunctions([string]$sourceText,[string[]]$names) {
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseInput($sourceText,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'SOURCE_REJECTED'}
 foreach($name in $names){
  $def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if($null -eq $def){throw 'SOURCE_REJECTED'}
  Invoke-Expression ($def.Extent.Text.Replace(('function '+$name),('function script:'+$name)))
 }
}
function New-FixedDescriptor([string]$descriptor,[string]$user,[string]$reader,[bool]$directory) {
 $raw=New-Object Security.AccessControl.RawSecurityDescriptor($descriptor)
 if($raw.Owner.Value -cne $user -or ([int]$raw.ControlFlags -band 0x1000) -ne 0 -or
  $null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -eq 0){throw 'DACL_REJECTED'}
 $removed=0;$approved=@{}
 for($i=$raw.DiscretionaryAcl.Count-1;$i -ge 0;$i--){
  $ace=$raw.DiscretionaryAcl[$i]
  if($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or
   $ace.AceQualifier -notin @([Security.AccessControl.AceQualifier]::AccessAllowed,[Security.AccessControl.AceQualifier]::AccessDenied)){
   throw 'DACL_REJECTED'
  }
  if($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed){
   $sid=$ace.SecurityIdentifier.Value
   if($sid -ceq $reader){
    $flags=if($directory){0x13}else{0x10}
    if($ace.AccessMask -ne 0x1200A9 -or [int]$ace.AceFlags -ne $flags){throw 'DACL_REJECTED'}
    $raw.DiscretionaryAcl.RemoveAce($i);$removed++;continue
   }
   if($sid -notin @($user,'S-1-5-18') -or $ace.AccessMask -le 0){throw 'DACL_REJECTED'}
   if(([int]$ace.AceFlags -band 8) -eq 0){$approved[$sid]=$true}
  }
  $ace.AceFlags=[Security.AccessControl.AceFlags]([int]$ace.AceFlags -band (-bnot 0x10))
 }
 if($removed -ne 1 -or -not $approved.ContainsKey($user) -or -not $approved.ContainsKey('S-1-5-18')){throw 'DACL_REJECTED'}
 if($null -ne $raw.SystemAcl){foreach($ace in $raw.SystemAcl){
  if($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or
   $ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::SystemAudit){throw 'DACL_REJECTED'}
 }}
 $raw.SetFlags([Security.AccessControl.ControlFlags]([int]$raw.ControlFlags -bor 0x1000))
 return $raw.GetSddlForm([Security.AccessControl.AccessControlSections]::All)
}
function Initialize-FixedNative {
 if('GoriqFixedAclNative' -as [type]){return}
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class GoriqFixedAclNative {
 [StructLayout(LayoutKind.Sequential)] struct Info {
  public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;
  public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint revision,out IntPtr descriptor,out uint length);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,out bool present,out IntPtr dacl,out bool defaulted);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorControl(IntPtr descriptor,out ushort control,out uint revision);
 [DllImport("advapi32.dll")] static extern uint SetSecurityInfo(SafeFileHandle handle,uint type,uint information,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 public static SafeFileHandle Open(string path,bool writable,bool directory) {
  // MAXIMUM_ALLOWED suppresses SetSecurityInfo child propagation. File handles
  // deny replacement; directory handles retain identity and detect pathname drift.
  var h=CreateFileW(path,writable?0x02000000u:0x120081u,(writable&&directory)?7u:3u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
  try {
   if(h.IsInvalid)throw new Exception("HANDLE_REJECTED_"+Marshal.GetLastWin32Error());
   string id=Identity(h);
   if(id.EndsWith(":True",StringComparison.Ordinal)!=directory)throw new Exception("HANDLE_REJECTED");
   return h;
  } catch {h.Dispose();throw;}
 }
 public static string Identity(SafeFileHandle h) {
  Info i;
  if(h.IsInvalid || !GetFileInformationByHandle(h,out i))throw new Exception("HANDLE_REJECTED");
  if((i.Attributes&0x400)!=0)throw new Exception("REPARSE_REJECTED");
  if((i.Attributes&0x10)==0 && i.Links!=1)throw new Exception("HARDLINK_REJECTED");
  return String.Format("{0}:{1}:{2}:{3}",i.Volume,i.IndexHigh,i.IndexLow,(i.Attributes&0x10)!=0);
 }
 public static string PathIdentity(string path) {
  using(var h=CreateFileW(path,0x80,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)){return Identity(h);}
 }
 public static void Apply(SafeFileHandle handle,string text) {
  Identity(handle);
  IntPtr descriptor=IntPtr.Zero,dacl;uint length,revision;bool present,defaulted;ushort control;
  try {
   if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(text,1,out descriptor,out length) ||
    !GetSecurityDescriptorDacl(descriptor,out present,out dacl,out defaulted) || !present ||
    dacl==IntPtr.Zero || Marshal.ReadInt16(dacl,4)<=0 ||
    !GetSecurityDescriptorControl(descriptor,out control,out revision))throw new Exception("DACL_REJECTED");
   uint flags=4u|((control&0x1000)!=0?0x80000000u:0x20000000u);
   if(SetSecurityInfo(handle,1,flags,IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero)!=0)throw new Exception("WRITE_REJECTED");
  }finally{if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
 }
}
'@
}
function Get-FixedHash([string]$path) {
 $share=[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
 $stream=New-Object IO.FileStream($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,$share)
 $sha=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}
 finally{$sha.Dispose();$stream.Dispose()}
}
function Get-FixedRecord($entry,$handle) {
 $native=[GoriqFixedAclNative]::Identity($handle)
 if([GoriqFixedAclNative]::PathIdentity($entry.path) -cne $native){throw 'BASELINE_CHANGED'}
 $item=Get-Item -LiteralPath $entry.path -Force
 if([bool]$item.PSIsContainer -ne [bool]$entry.directory){throw 'BASELINE_CHANGED'}
 $descriptor=(Get-Acl -LiteralPath $entry.path -Audit).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
 $hash=if($entry.directory){$null}else{Get-FixedHash $entry.path}
 if([GoriqFixedAclNative]::PathIdentity($entry.path) -cne $native){throw 'BASELINE_CHANGED'}
 [pscustomobject]@{path=$entry.path;directory=[bool]$entry.directory;identity=$native;descriptor=$descriptor;hash=$hash}
}
function Assert-FixedRecord($before,$after) {
 foreach($key in @('path','directory','identity','descriptor','hash')){
  if($before.$key -cne $after.$key){throw 'BASELINE_CHANGED'}
 }
}
function Invoke-FixedTransition($entry,$handle,$baseline,[string]$descriptor,[switch]$EnforceExpiry) {
 Assert-FixedRecord $baseline (Get-FixedRecord $entry $handle)
 if($EnforceExpiry){Assert-FixedExpiry}
 [GoriqFixedAclNative]::Apply($handle,$descriptor)
 $expected=$baseline.PSObject.Copy();$expected.descriptor=$descriptor
 Assert-FixedRecord $expected (Get-FixedRecord $entry $handle)
}
function Restore-FixedRecords([object[]]$targets,[object[]]$handles,[object[]]$baseline,[string[]]$wanted,[switch]$EnforceExpiry) {
 if($targets.Count -ne 5 -or $handles.Count -ne 5 -or $baseline.Count -ne 5 -or $wanted.Count -ne 5){throw 'RESTORE_REJECTED'}
 # Preflight ALL objects before restoration; unknown effects never trigger blind writes.
 for($i=0;$i -lt 5;$i++){
  $live=Get-FixedRecord $targets[$i] $handles[$i]
  if($live.descriptor -cne $baseline[$i].descriptor -and $live.descriptor -cne $wanted[$i]){throw 'RECONCILIATION_REQUIRED'}
  $expected=$baseline[$i].PSObject.Copy();$expected.descriptor=$live.descriptor
  Assert-FixedRecord $expected $live
 }
 for($i=0;$i -lt 5;$i++){
  $live=Get-FixedRecord $targets[$i] $handles[$i]
  if($live.descriptor -cne $baseline[$i].descriptor -and $live.descriptor -cne $wanted[$i]){throw 'RECONCILIATION_REQUIRED'}
  $expected=$baseline[$i].PSObject.Copy();$expected.descriptor=$live.descriptor
  Assert-FixedRecord $expected $live
  if($live.descriptor -cne $baseline[$i].descriptor){Invoke-FixedTransition $targets[$i] $handles[$i] $live $baseline[$i].descriptor -EnforceExpiry:$EnforceExpiry}
 }
 for($i=0;$i -lt 5;$i++){Assert-FixedRecord $baseline[$i] (Get-FixedRecord $targets[$i] $handles[$i])}
}
function Write-FixedTransaction([string]$backupPath,[string]$marker,$transaction,[string]$id) {
 $plain=$transaction | ConvertTo-Json -Depth 8 -Compress
 Write-BoundaryBackup $backupPath $plain
 $intent=@{version=1;backupId=$id;backupHash=(Get-FixedHash $backupPath)} | ConvertTo-Json -Compress
 $stream=New-Object IO.FileStream($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes($intent);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 # Read back DPAPI and marker before the first mutation; malformed/truncated is blocked.
 $roundTrip=Read-FixedTransaction $backupPath $marker $id
 if(($roundTrip | ConvertTo-Json -Depth 8 -Compress) -cne $plain){throw 'BACKUP_REJECTED'}
}
function Read-FixedTransaction([string]$backupPath,[string]$marker,[string]$id) {
 if($id -notmatch '^[a-f0-9]{32}$'){throw 'BACKUP_REJECTED'}
 $markerHandle=$null;$backupHandle=$null
 try {
  $markerHandle=[GoriqFixedAclNative]::Open($marker,$false,$false)
  $backupHandle=[GoriqFixedAclNative]::Open($backupPath,$false,$false)
  $markerHash=Get-FixedHash $marker
  $intent=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if($intent.version -ne 1 -or $intent.backupId -cne $id -or $intent.backupHash -notmatch '^[A-F0-9]{64}$' -or
   (Get-FixedHash $backupPath) -cne $intent.backupHash){throw 'BACKUP_REJECTED'}
  Add-Type -AssemblyName System.Security
  $decoded=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($backupPath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $transaction=[Text.Encoding]::UTF8.GetString($decoded) | ConvertFrom-Json
  if((Get-FixedHash $marker) -cne $markerHash -or (Get-FixedHash $backupPath) -cne $intent.backupHash){throw 'BACKUP_REJECTED'}
  return $transaction
 }finally{
  if($null -ne $markerHandle){$markerHandle.Dispose()};if($null -ne $backupHandle){$backupHandle.Dispose()}
  $decoded=$null
 }
}
function Test-FixedReconciliation([string]$marker,[bool]$changed,[bool]$restored,[string]$reason) {
 if($reason -eq 'RECONCILIATION_REQUIRED' -or ($changed -and -not $restored)){return $true}
 if([string]::IsNullOrEmpty($marker)){return $null}
 try{return [bool](Test-Path -LiteralPath $marker -ErrorAction Stop)}catch{return $true}
}
function Assert-FixedGuards {
 for($i=0;$i -lt $guardEntries.Count;$i++){Assert-FixedRecord $guardRecords[$i] (Get-FixedRecord $guardEntries[$i] $guards[$i])}
}
function Assert-FixedRuntime {
 if((Get-FixedHash $config) -cne $configHash -or (Get-FixedHash $launcher) -cne $launcherHash -or
  (Export-ScheduledTask -TaskName 'JARVIS Remote Host') -cne $taskXml){throw 'RUNTIME_CHANGED'}
 if((Get-ScheduledTask -TaskName 'JARVIS Remote Host').State -ne 'Running'){throw 'RUNTIME_CHANGED'}
 $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
 if($health.ok -ne $true){throw 'RUNTIME_CHANGED'}
}
function Assert-FixedExpiry {
 if([datetimeoffset]::UtcNow -ge [datetimeoffset]::Parse('2026-10-13T11:12:13.845Z')){throw 'APPROVAL_REJECTED'}
}
try {
 Assert-FixedExpiry
 if([datetimeoffset]::UtcNow -lt [datetimeoffset]::Parse('2026-10-12T14:39:12Z') -or
  ($Phase -ne 'plan' -and -not $OwnerApproved)){throw 'APPROVAL_REJECTED'}
 if($env:OS -ne 'Windows_NT' -or $SourceRevision -notmatch '^[a-f0-9]{40}$' -or
  $ExpectedRepairSha256 -notmatch '^[a-f0-9]{64}$' -or
  (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedRepairSha256){throw 'ARTIFACT_REJECTED'}
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $principal=New-Object Security.Principal.WindowsPrincipal($identity)
 if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
 $stage='source';Write-Host ('FIXED_ACL_STAGE='+$stage)
 $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
 if((& git -C $repository rev-parse HEAD).Trim() -cne $SourceRevision -or $LASTEXITCODE -ne 0){throw 'SOURCE_REJECTED'}
 foreach($relative in @('scripts/goriq-zbook-fixed-acl-repair.ps1','scripts/goriq-zbook-acl-boundary-repair.ps1','scripts/goriq-zbook-owner-acl-repair.ps1')){
  # Cache bytes while denying concurrent write/delete; import that same verified snapshot.
  $sourcePath=Join-Path $repository $relative
  $sourceStream=New-Object IO.FileStream($sourcePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $sourceStreams+=,$sourceStream
  $memory=New-Object IO.MemoryStream
  try{$sourceStream.CopyTo($memory);$sourceTexts[$relative]=[Text.Encoding]::UTF8.GetString($memory.ToArray())}finally{$memory.Dispose()}
  $expectedBlob=(& git -C $repository rev-parse ($SourceRevision+':'+$relative)).Trim()
  if($LASTEXITCODE -ne 0){throw 'SOURCE_REJECTED'}
  $actualBlob=(& git -C $repository hash-object ('--path='+$relative) (Join-Path $repository $relative)).Trim()
  if($LASTEXITCODE -ne 0 -or $actualBlob -cne $expectedBlob){throw 'SOURCE_REJECTED'}
 }
 $main=Invoke-RestMethod -Uri 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main' -TimeoutSec 15
 $runs=Invoke-RestMethod -Uri ('https://api.github.com/repos/haji84/AI-/actions/runs?head_sha='+$SourceRevision+'&event=push&per_page=100') -TimeoutSec 15
 if($main.object.sha -cne $SourceRevision -or -not @($runs.workflow_runs | Where-Object {
  $_.name -eq 'CI' -and $_.event -eq 'push' -and $_.head_branch -eq 'main' -and $_.head_sha -eq $SourceRevision -and
  $_.status -eq 'completed' -and $_.conclusion -eq 'success'}).Count){throw 'MAIN_CI_REQUIRED'}
 Import-FixedFunctions $sourceTexts['scripts/goriq-zbook-acl-boundary-repair.ps1'] @('Assert-ProfileOwner','Assert-NativeProfile','Write-BoundaryBackup')
 Import-FixedFunctions $sourceTexts['scripts/goriq-zbook-owner-acl-repair.ps1'] @('Test-KnownReadOnlyRights','Get-RuleFacts','Assert-OwnedNative','Select-RepairCandidate')
 Initialize-FixedNative
 $stage='paths';Write-Host ('FIXED_ACL_STAGE='+$stage)
 $root=Join-Path $env:USERPROFILE 'JARVIS';$targets=@(Get-FixedTargets $root)
 $config=$targets[3].path;$launcher=$targets[4].path
 # Hold every ancestor directory (including volume root) without delete sharing.
 $ancestorPaths=@($env:LOCALAPPDATA,(Join-Path $targets[2].path 'node_modules'))
 foreach($entry in $targets){$ancestorPaths+=([IO.Path]::GetDirectoryName($entry.path))}
 $queue=@($ancestorPaths);$unique=@{}
 while($queue.Count){
  $path=$queue[0];$queue=@($queue | Select-Object -Skip 1)
  $path=[IO.Path]::GetFullPath($path)
  if($unique.ContainsKey($path)){continue};$unique[$path]=$true
  $parent=[IO.Directory]::GetParent($path)
  if($null -ne $parent){$queue+=($parent.FullName)}
 }
 $guardEntries=@();$guardRecords=@()
 foreach($entry in $targets){$unique.Remove([IO.Path]::GetFullPath($entry.path))}
 foreach($path in @($unique.Keys | Sort-Object)){
  $entry=[pscustomobject]@{path=$path;directory=$true}
  $guard=[GoriqFixedAclNative]::Open($path,$false,$true);$guards+=,$guard
  $guardEntries+=,$entry;$guardRecords+=,(Get-FixedRecord $entry $guard)
 }
 Assert-NativeProfile $env:USERPROFILE $identity
 Assert-OwnedNative $root $identity
 foreach($entry in $targets){Assert-OwnedNative $entry.path $identity}
 # Existing source reader is proven on the unchanged JARVIS ancestor.
 $candidate=Select-RepairCandidate @(Get-RuleFacts (Get-Acl -LiteralPath $root) $identity)
 if([long]$candidate.rule.FileSystemRights -ne 0x1200A9 -or [string]$candidate.rule.PropagationFlags -ne 'None'){throw 'DACL_REJECTED'}
 foreach($entry in $targets){
  $handle=[GoriqFixedAclNative]::Open($entry.path,$true,$entry.directory);$handles+=,$handle
  $records+=,(Get-FixedRecord $entry $handle)
 }
 $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host';$taskSid=[string]$task.Principal.UserId
 if($taskSid -notmatch '^S-1-'){$taskSid=([Security.Principal.NTAccount]$taskSid).Translate([Security.Principal.SecurityIdentifier]).Value}
 if($taskSid -cne $identity.User.Value -or $task.Principal.RunLevel -ne 'Limited' -or $task.Principal.LogonType -ne 'Password'){throw 'RUNTIME_CHANGED'}
 $taskXml=Export-ScheduledTask -TaskName 'JARVIS Remote Host';$configHash=Get-FixedHash $config;$launcherHash=Get-FixedHash $launcher
 Assert-FixedRuntime;Assert-FixedGuards
 $marker=Join-Path $env:LOCALAPPDATA 'goriq-fixed-acl-active.json'
 if($Phase -ne 'restore' -and (Test-Path -LiteralPath $marker)){throw 'RECONCILIATION_REQUIRED'}
 if($Phase -eq 'restore'){
  if($BackupId -notmatch '^[a-f0-9]{32}$' -or -not(Test-Path -LiteralPath $marker)){throw 'BACKUP_REJECTED'}
  $backupPath=Join-Path $env:LOCALAPPDATA ('goriq-fixed-acl-before-'+$BackupId+'.dpapi')
  $transaction=Read-FixedTransaction $backupPath $marker $BackupId
  if($transaction.version -ne 1 -or $transaction.issue -ne 1787 -or $transaction.sourceRevision -cne $SourceRevision -or
   $transaction.userSid -cne $identity.User.Value -or $transaction.records.Count -ne 5 -or $transaction.wanted.Count -ne 5){throw 'BACKUP_REJECTED'}
  for($i=0;$i -lt 5;$i++){
   if($transaction.records[$i].path -cne $targets[$i].path -or
    (New-FixedDescriptor $transaction.records[$i].descriptor $identity.User.Value $candidate.sidValue $targets[$i].directory) -cne $transaction.wanted[$i]){throw 'BACKUP_REJECTED'}
  }
  if($transaction.taskXml -cne $taskXml -or $transaction.configHash -cne $configHash -or $transaction.launcherHash -cne $launcherHash){throw 'RUNTIME_CHANGED'}
  if($transaction.guards.Count -ne $guardRecords.Count){throw 'BASELINE_CHANGED'}
  for($i=0;$i -lt $guardRecords.Count;$i++){Assert-FixedRecord $transaction.guards[$i] $guardRecords[$i]}
  $records=@($transaction.records);$wanted=@($transaction.wanted);$backupIdResult=$BackupId
  $stage='restore';Write-Host ('FIXED_ACL_STAGE='+$stage)
  $changed=$true;Restore-FixedRecords $targets $handles $records $wanted -EnforceExpiry
  Assert-FixedGuards;Assert-FixedRuntime;$restored=$true
  Remove-Item -LiteralPath $marker -Force
 }else{
  $stage='plan';Write-Host ('FIXED_ACL_STAGE='+$stage)
  for($i=0;$i -lt 5;$i++){$wanted+=,(New-FixedDescriptor $records[$i].descriptor $identity.User.Value $candidate.sidValue $targets[$i].directory)}
  if($Phase -eq 'apply'){
   $stage='backup';Write-Host ('FIXED_ACL_STAGE='+$stage)
   $backupIdResult=[guid]::NewGuid().ToString('N')
   $backupPath=Join-Path $env:LOCALAPPDATA ('goriq-fixed-acl-before-'+$backupIdResult+'.dpapi')
   $transaction=[pscustomobject]@{version=1;issue=1787;sourceRevision=$SourceRevision;userSid=$identity.User.Value;records=$records;wanted=$wanted;
    guards=$guardRecords;taskXml=$taskXml;configHash=$configHash;launcherHash=$launcherHash}
   Write-FixedTransaction $backupPath $marker $transaction $backupIdResult
   $markerCreated=$true
   Assert-FixedGuards;Assert-FixedRuntime;Assert-FixedExpiry
   $stage='write';Write-Host ('FIXED_ACL_STAGE='+$stage)
   for($i=0;$i -lt 5;$i++){
    Assert-FixedExpiry;Assert-FixedGuards;Assert-FixedRuntime
    $changed=$true
    Invoke-FixedTransition $targets[$i] $handles[$i] $records[$i] $wanted[$i] -EnforceExpiry
   }
   Assert-FixedGuards;Assert-FixedRuntime
   $stage='verify';Write-Host ('FIXED_ACL_STAGE='+$stage)
   for($i=0;$i -lt 5;$i++){
    $expected=$records[$i].PSObject.Copy();$expected.descriptor=$wanted[$i]
    Assert-FixedRecord $expected (Get-FixedRecord $targets[$i] $handles[$i])
   }
   Remove-Item -LiteralPath $marker -Force;$markerCreated=$false
  }
 }
 @{version=1;issue=1662;repairIssue=1787;nodeId='zbook';phase=$Phase;sourceRevision=$SourceRevision;
  readOnly=($Phase -eq 'plan');verified=$true;permissionChanged=$changed;targetCount=5;backupId=$backupIdResult;
  restored=$restored;runtimeUnchanged=$true;ancestorUnchanged=$true;recursiveWrite=$false;
  observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
}catch{
 $known=@('APPROVAL_REJECTED','ARTIFACT_REJECTED','ADMIN_REQUIRED','SOURCE_REJECTED','MAIN_CI_REQUIRED','OWNER_BOUNDARY_REJECTED',
  'ACL_CANDIDATE_REJECTED','DACL_REJECTED','BASELINE_CHANGED','REPARSE_REJECTED','HARDLINK_REJECTED','HANDLE_REJECTED',
  'WRITE_REJECTED','BACKUP_REJECTED','RESTORE_REJECTED','RUNTIME_CHANGED','RECONCILIATION_REQUIRED')
 $failure=$_.Exception
 while($null -ne $failure.InnerException){$failure=$failure.InnerException}
 $nativeErrorCode=$null
 if($failure.Message -match '^HANDLE_REJECTED_([0-9]+)$'){$nativeErrorCode=[int]$Matches[1];$failure=New-Object Exception('HANDLE_REJECTED')}
 $reason=if($failure.Message -in $known){$failure.Message}else{'FIXED_REPAIR_FAILED'}
 if($changed -and $Phase -eq 'apply'){
  try{Restore-FixedRecords $targets $handles $records $wanted -EnforceExpiry;Assert-FixedGuards;Assert-FixedRuntime;$restored=$true
   if($markerCreated){Remove-Item -LiteralPath $marker -Force;$markerCreated=$false}
  }catch{$restored=$false}
 }
 @{version=1;issue=1662;repairIssue=1787;nodeId='zbook';phase=$Phase;failedStage=$stage;failureReason=$reason;
  permissionChanged=$changed;restored=$restored;backupId=$backupIdResult;
  nativeErrorCode=$nativeErrorCode;intentPending=($null -ne $marker -and (Test-Path -LiteralPath $marker));
  reconciliationRequired=(Test-FixedReconciliation $marker $changed $restored $reason);
  observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
 exit 1
}finally{
 foreach($handle in $handles){$handle.Dispose()};foreach($guard in $guards){$guard.Dispose()}
 foreach($stream in $sourceStreams){$stream.Dispose()};$sourceTexts=$null
 $plain=$null;$decoded=$null;$records=$null;$wanted=$null;$transaction=$null;$candidate=$null;$bytes=$null
}
