param([ValidateSet('plan','apply','restore')][string]$Phase='plan',
 [Parameter(Mandatory=$true)][string]$SourceRevision,
 [Parameter(Mandatory=$true)][string]$ExpectedHelperSha256,[string]$RecoveryBackupId)
# Issue1858 only. Historical entrypoints/authorizations are never executed.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$OutputEncoding=New-Object Text.UTF8Encoding($false)
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$root='C:\Users\qq113\JARVIS';$installationRoot=$root
$production=Join-Path $root 'production';$oldRoot=Join-Path $root 'releases\a49c458d69a28c0266be8fcad5b26253e5ed8d75'
$releaseRoot=Join-Path $root ('releases\'+$SourceRevision)
$configPath=Join-Path $production 'config.dpapi';$launcherPath=Join-Path $production 'launch-current.ps1'
$compat='C:\Users\qq113\AppData\Local\JARVIS\production\launch-current.ps1'
$taskName='JARVIS Remote Host';$ports=@(3000,8787,8790,8792)
$node=(Get-Command node.exe).Source;$revision=$SourceRevision
$handles=@();$guards=@();$records=@();$wanted=@();$sourceStreams=@();$sourceTexts=@{}
$recovering=($Phase -eq 'restore');$mutated=$false;$stopAttempted=$false;$switched=$false;$startAttempted=$false;$restored=$false
$marker=$null;$backupId=$null;$failure='';$stage='source';$initialLocation=Get-Location
function Assert-CompletionWindow([bool]$recovery,[datetimeoffset]$now=[datetimeoffset]::UtcNow) {
 $end=if($recovery){'2026-10-23T14:59:59Z'}else{'2026-10-23T14:30:00Z'}
 if($now -lt [datetimeoffset]::Parse('2026-10-23T11:16:26Z') -or $now -ge [datetimeoffset]::Parse($end)){throw 'APPROVAL_EXPIRED'}
}
function Assert-FixedExpiry { Assert-CompletionWindow $script:recovering }
function Assert-CompletionProcessEdges([object[]]$tree) {
 $byId=@{}
 foreach($p in $tree){
  if($null -eq $p.CreationDate -or $byId.ContainsKey([int]$p.ProcessId)){throw 'PROCESS_REJECTED'}
  $byId[[int]$p.ProcessId]=$p
 }
 $roots=@($tree | Where-Object {-not $byId.ContainsKey([int]$_.ParentProcessId)})
 if($tree.Count -and $roots.Count -ne 1){throw 'PROCESS_REJECTED'}
 foreach($p in $tree){
  if($byId.ContainsKey([int]$p.ParentProcessId)){
   if($p.CreationDate.ToUniversalTime() -lt $byId[[int]$p.ParentProcessId].CreationDate.ToUniversalTime()){throw 'PROCESS_REJECTED'}
  }
 }
}
function Invoke-CompletionTransaction([scriptblock]$Persist,[scriptblock]$Apply,[scriptblock]$Verify,[scriptblock]$Recover) {
 [void](& $Persist)
 try{[void](& $Apply);[void](& $Verify);return @{verified=$true;restored=$false}}
 catch{
  $reason=$_.Exception;$restored=$false
  try{[void](& $Recover);$restored=$true}catch{}
  return @{verified=$false;restored=$restored;failure=$reason}
 }
}
function Import-CompletionFunctions([string]$text,[string[]]$names) {
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'SOURCE_REJECTED'}
 foreach($name in $names){
  $defs=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
  if($defs.Count -ne 1){throw 'SOURCE_REJECTED'}
  Invoke-Expression ($defs[0].Extent.Text.Replace(('function '+$name),('function script:'+$name)))
 }
}
function Assert-CompletionNative($handle,[string]$path) {
 if(-not ('GoriqCompletionNativePath' -as [type])){
  Add-Type -TypeDefinition @'
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class GoriqCompletionNativePath {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern uint GetFinalPathNameByHandle(SafeFileHandle handle,StringBuilder path,uint length,uint flags);
}
'@
 }
 $buffer=New-Object Text.StringBuilder 4096
 $length=[GoriqCompletionNativePath]::GetFinalPathNameByHandle($handle,$buffer,4096,0)
 if($length -eq 0 -or $length -ge 4096 -or $buffer.ToString() -ine ('\\?\'+[IO.Path]::GetFullPath($path))){throw 'NATIVE_PATH_REJECTED'}
}
function Assert-CompletionSource {
 if((& git -C $source rev-parse HEAD).Trim() -cne $SourceRevision -or $LASTEXITCODE -ne 0){throw 'SOURCE_REJECTED'}
 & git -C $source diff --quiet HEAD --
 if($LASTEXITCODE -ne 0){throw 'SOURCE_REJECTED'}
 & $node (Join-Path $source 'scripts\goriq-pc-approved-source.mjs')
 if($LASTEXITCODE -ne 0){throw 'MAIN_CI_REQUIRED'}
 '{"operation":"source"}' | & $node (Join-Path $source 'scripts\goriq-completion-native-state.ts')
 if($LASTEXITCODE -ne 0){throw 'TASK_SOURCE_REJECTED'}
}
function Inspect-State([string]$operation) {
 $inputValue=@{current=$current;operation=$operation;recovery=$recovering} | ConvertTo-Json -Depth 20 -Compress
 $receipt=$inputValue | & $node (Join-Path $source 'scripts\goriq-completion-native-state.ts') 2>$null
 if($LASTEXITCODE -ne 0){throw 'STATE_REJECTED'}
 return ($receipt | ConvertFrom-Json)
}
function Assert-CompletionState {
 Assert-FixedExpiry
 if((Export-ScheduledTask -TaskName $taskName) -cne $taskXml){throw 'TASK_CHANGED'}
 Assert-FixedGuards
 $state=Inspect-State 'inspect'
 if($state.schemaCompatible -ne $true -or $state.quiescent -ne $true -or $state.identityCount -ne 40 -or $state.androidCount -ne 38){throw 'STATE_REJECTED'}
 Assert-State-Preserved $before $state
}
function Stop-CompletionHost([string]$expectedRoot) {
 Assert-CompletionState
 $live=@(Get-OwnedTree $expectedRoot $false)
 if($live.Count){
  Assert-FixedTree $live @(Get-OwnedTree $expectedRoot $false)
  Assert-CompletionProcessEdges $live
  foreach($p in $live){if($p.ExecutablePath -ine $node -or $p.CreationDate -eq $null){throw 'PROCESS_REJECTED'}}
  Bind-FixedProcessTree $live
  Assert-FixedExpiry;$script:stopAttempted=$true
  Stop-OwnedTree $live
 }
 Assert-StoppedInstallation
}
function Write-CompletionBytes($stream,[byte[]]$bytes) {
 $stream.Position=0;$stream.Write($bytes,0,$bytes.Length);$stream.SetLength($bytes.Length);$stream.Flush($true)
}
function Get-CompletionByteHash([byte[]]$bytes) {
 $hash=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','')}finally{$hash.Dispose()}
}
function Read-CompletionIntent([int]$index,[bool]$recovery) {
 if($backupId -notmatch '^[a-f0-9]{32}$' -or $index -notin @(3,4)){throw 'BACKUP_REJECTED'}
 $path=Join-Path $env:LOCALAPPDATA ('goriq-1858-pointer-'+$backupId+'-'+$index+'-'+$recovery+'.dpapi')
 if(-not (Test-Path -LiteralPath $path)){return $null}
 $h=[GoriqFixedAclNative]::Open($path,$false,$false)
 try{
  Assert-CompletionNative $h $path
  Add-Type -AssemblyName System.Security
  $decoded=[Security.Cryptography.ProtectedData]::Unprotect((Get-FixedBytes $path),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $intent=[Text.Encoding]::UTF8.GetString($decoded) | ConvertFrom-Json
  if($intent.issue -ne 1858 -or $intent.sourceRevision -cne $SourceRevision -or $intent.backupId -cne $backupId -or $intent.index -ne $index -or
   $intent.identity -cne $records[$index].identity -or $intent.hash -cnotmatch '^[A-F0-9]{64}$' -or
   $intent.descriptor -cne $wanted[$index]){throw 'BACKUP_REJECTED'}
  return $intent
 }finally{$h.Dispose();$decoded=$null}
}
function Save-CompletionIntent([int]$index,[byte[]]$bytes,$live) {
 $intent=[ordered]@{issue=1858;sourceRevision=$SourceRevision;backupId=$backupId;index=$index;identity=$live.identity;descriptor=$live.descriptor;hash=(Get-CompletionByteHash $bytes)}
 $existing=Read-CompletionIntent $index $recovering
 if($null -eq $existing){
  Assert-FixedExpiry
  $path=Join-Path $env:LOCALAPPDATA ('goriq-1858-pointer-'+$backupId+'-'+$index+'-'+$recovering+'.dpapi')
  Write-BoundaryBackup $path ($intent | ConvertTo-Json -Compress)
  $existing=Read-CompletionIntent $index $recovering
 }
 foreach($key in $intent.Keys){if($existing.$key -cne $intent[$key]){throw 'BACKUP_REJECTED'}}
}
function Assert-CompletionRecoveryRecords($baseline,[object[]]$liveRecords,[object[]]$intents) {
 if($baseline.records.Count -ne 5 -or $baseline.wanted.Count -ne 5 -or $liveRecords.Count -ne 5){throw 'BACKUP_REJECTED'}
 for($i=0;$i -lt 5;$i++){
  $old=$baseline.records[$i];$live=$liveRecords[$i]
  if($live.path -cne $old.path -or $live.directory -ne $old.directory -or $live.identity -cne $old.identity -or
   $live.descriptor -cnotin @($old.descriptor,$baseline.wanted[$i])){throw 'RECOVERY_TARGET_CHANGED'}
  $allowed=@($old.hash)
  if($i -ge 3){$allowed+=@($intents | Where-Object {$null -ne $_ -and $_.index -eq $i -and $_.identity -ceq $old.identity -and $_.descriptor -ceq $baseline.wanted[$i]} | ForEach-Object {$_.hash})}
  # A torn/unknown write is retained for explicit reconciliation, never guessed.
  if($allowed -cnotcontains $live.hash){throw 'RECOVERY_BYTES_UNKNOWN'}
 }
}
function Write-CompletionPointer([int]$index,[byte[]]$bytes) {
 Assert-CompletionState;Assert-StoppedInstallation
 $entry=$targets[$index]
 # Keep the original object: its owner, group, DACL and nonempty SACL never
 # undergo recreation/merge. Deny concurrent writers and delete/rename.
 # The durable transaction already contains original bytes before this call.
 $stream=New-Object IO.FileStream($entry.path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read,1,[IO.FileOptions]::WriteThrough)
 try{
  Assert-CompletionNative $stream.SafeFileHandle $entry.path
  $live=Get-FixedRecord $entry $stream.SafeFileHandle
  Assert-FixedRecord $script:pointerRecords[$index-3] $live
  Save-CompletionIntent $index $bytes $live
  Assert-FixedExpiry
  try{Write-CompletionBytes $stream $bytes}
  finally{
   # Even a partial write or a post-write exception has a known held identity.
   # Capture only that object, before releasing the no-write/no-delete lock.
   $after=Get-FixedRecord $entry $stream.SafeFileHandle
   if($after.identity -cne $live.identity -or $after.descriptor -cne $live.descriptor){throw 'POINTER_REJECTED'}
   $script:pointerRecords[$index-3]=$after
  }
  if(-not (Same-Bytes $bytes (Get-FixedBytes $entry.path))){throw 'POINTER_REJECTED'}
 }finally{$stream.Dispose()}
}
function Invoke-CompletionBuild {
 Assert-FixedExpiry
 $exe='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
 $build=Join-Path $source 'scripts\goriq-completion-native-build.ps1'
 $process=Start-Process -FilePath $exe -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$build+'"') -WorkingDirectory $releaseRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $releaseRoot 'build.stdout.log') -RedirectStandardError (Join-Path $releaseRoot 'build.stderr.log')
 $created=$process.StartTime.ToUniversalTime();$deadline=[datetimeoffset]::UtcNow.AddMinutes(15)
 while(-not $process.WaitForExit(1000)){
  if([datetimeoffset]::UtcNow -ge $deadline){
   # Only the child this operation created and its proved descendants are eligible.
   $all=@(Get-CimInstance Win32_Process -OperationTimeoutSec 15 -ErrorAction Stop)
   $parent=@($all | Where-Object {[int]$_.ProcessId -eq $process.Id})
   if($parent.Count -ne 1 -or $parent[0].CreationDate.ToUniversalTime().Ticks/10 -ne $created.Ticks/10 -or $parent[0].ExecutablePath -ine $exe){throw 'BUILD_PROCESS_CHANGED'}
   $ids=@($process.Id)
   do{$added=@($all | Where-Object {$ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId});$ids+=@($added | ForEach-Object {[int]$_.ProcessId})}while($added.Count)
   $buildTree=@($all | Where-Object {$ids -contains [int]$_.ProcessId})
   Assert-CompletionProcessEdges $buildTree
   foreach($p in $buildTree){
    $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop
    if($owner.ReturnValue -ne 0 -or $owner.Sid -cne $identity.User.Value -or $p.CreationDate.ToUniversalTime() -lt $created){throw 'BUILD_PROCESS_CHANGED'}
   }
   Bind-FixedProcessTree $buildTree
   foreach($p in @($buildTree | Sort-Object ProcessId -Descending)){Assert-FixedExpiry;$null=[GoriqFixedProcessNative]::Terminate([int]$p.ProcessId)}
   throw 'BUILD_TIMEOUT'
  }
 }
 $process.Refresh()
 if($process.ExitCode -ne 0){throw 'BUILD_FAILED'}
}
function Open-CompletionGuards {
 $script:guardEntries=@();$script:guardRecords=@();$unique=@{}
 foreach($path in @($root,$env:LOCALAPPDATA,(Join-Path $oldRoot 'node_modules'),$source)){
  $p=[IO.Path]::GetFullPath($path)
  while($p){if(-not $unique.ContainsKey($p)){$unique[$p]=$true};$p=[IO.Path]::GetDirectoryName($p.TrimEnd('\'))}
 }
 foreach($entry in $targets){$unique.Remove($entry.path)}
 foreach($path in @($unique.Keys | Sort-Object)){
  $entry=[pscustomobject]@{path=$path;directory=$true};$h=[GoriqFixedAclNative]::Open($path,$false,$true)
  $script:guards+=,$h;Assert-CompletionNative $h $path
  $script:guardEntries+=,$entry;$script:guardRecords+=,(Get-FixedRecord $entry $h)
 }
 $h=[GoriqFixedAclNative]::Open($compat,$false,$false);$script:guards+=,$h
 Assert-CompletionNative $h $compat
 $script:guardEntries+=,[pscustomobject]@{path=$compat;directory=$false}
 $script:guardRecords+=,(Get-FixedRecord $guardEntries[-1] $h)
 if((Get-FixedHash $compat) -ine '27f8afb66ac4dc5a241cade217c9e6c19b16dc316f84d6d3d08257db90c72a36'){throw 'BRIDGE_CHANGED'}
}
function Resume-CompletionRecovery {
 $script:stage='durable-recovery';Assert-FixedExpiry
 if($RecoveryBackupId -cnotmatch '^[a-f0-9]{32}$'){throw 'BACKUP_REJECTED'}
 $script:backupId=$RecoveryBackupId
 $script:marker=Join-Path $env:LOCALAPPDATA 'goriq-1858-native-active.json'
 $backupPath=Join-Path $env:LOCALAPPDATA ('goriq-1858-native-before-'+$RecoveryBackupId+'.dpapi')
 foreach($path in @($marker,$backupPath)){
  $h=[GoriqFixedAclNative]::Open($path,$false,$false)
  try{Assert-CompletionNative $h $path}finally{$h.Dispose()}
 }
 $tx=Read-FixedTransaction $backupPath $marker $RecoveryBackupId
 if($tx.version -ne 1 -or $tx.issue -ne 1858 -or $tx.sourceRevision -cne $SourceRevision -or $tx.ownerSid -cne $identity.User.Value -or
  $tx.helperSha256 -ine $ExpectedHelperSha256){throw 'BACKUP_REJECTED'}
 $script:targets=@(Get-FixedTargets $root);Open-CompletionGuards
 if($tx.guards.Count -ne $guardRecords.Count){throw 'BACKUP_REJECTED'}
 for($i=0;$i -lt $guardRecords.Count;$i++){Assert-FixedRecord $tx.guards[$i] $guardRecords[$i]}
 $candidate=Select-RepairCandidate @(Get-RuleFacts (Get-Acl -LiteralPath $root) $identity)
 if($tx.records.Count -ne 5 -or $tx.wanted.Count -ne 5){throw 'BACKUP_REJECTED'}
 for($i=0;$i -lt 5;$i++){
  if($tx.records[$i].path -cne $targets[$i].path -or $tx.records[$i].directory -ne $targets[$i].directory -or
   (New-FixedDescriptor $tx.records[$i].descriptor $identity.User.Value $candidate.sidValue $targets[$i].directory) -cne $tx.wanted[$i]){throw 'BACKUP_REJECTED'}
 }
 $script:records=@($tx.records);$script:wanted=@($tx.wanted);$script:taskXml=$tx.taskXml;$script:before=$tx.state
 $script:configBytes=[Convert]::FromBase64String($tx.configCipher);$script:launcherBytes=[Convert]::FromBase64String($tx.launcherCipher)
 if((Get-CompletionByteHash $configBytes) -cne $records[3].hash -or (Get-CompletionByteHash $launcherBytes) -cne $records[4].hash){throw 'BACKUP_REJECTED'}
 $secure=ConvertTo-SecureString ([Text.Encoding]::UTF8.GetString($configBytes).Trim([char]0xFEFF).Trim())
 $script:current=(New-Object Management.Automation.PSCredential('config',$secure)).GetNetworkCredential().Password | ConvertFrom-Json
 $secure=$null
 $liveRecords=@()
 foreach($entry in $targets){
  $h=[GoriqFixedAclNative]::Open($entry.path,$false,$entry.directory);$script:handles+=,$h
  Assert-CompletionNative $h $entry.path;$liveRecords+=,(Get-FixedRecord $entry $h)
 }
 $intents=@();foreach($i in @(3,4)){foreach($recovery in @($false,$true)){$intents+=,(Read-CompletionIntent $i $recovery)}}
 Assert-CompletionRecoveryRecords $tx $liveRecords $intents
 $script:pointerRecords=@($liveRecords[3],$liveRecords[4]);$script:switched=($liveRecords[3].hash -cne $records[3].hash -or $liveRecords[4].hash -cne $records[4].hash)
 Assert-CompletionState
 # Only a positively identified old/new host may be stopped. Any orphan,
 # unknown listener or mixed generation is rejected by the existing guards.
 $hosts=@(Get-CimInstance Win32_Process -OperationTimeoutSec 15 | Where-Object {$_.Name -ieq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($installationRoot) -and $_.CommandLine.Contains('jarvis-remote-host.mjs')})
 if($hosts.Count -gt 1){throw 'PROCESS_REJECTED'}
 if($hosts.Count){
  $expected=if($hosts[0].CommandLine.Contains($releaseRoot)){$releaseRoot}elseif($hosts[0].CommandLine.Contains($oldRoot)){$oldRoot}else{throw 'PROCESS_REJECTED'}
  Stop-CompletionHost $expected
 }else{Assert-StoppedInstallation}
 $script:stopAttempted=$true;$script:mutated=$true
 Restore-Completion
 $script:restored=$true
}
function Restore-Completion {
 $script:recovering=$true;Assert-FixedExpiry;Assert-CompletionState
 if(-not $mutated -and -not $stopAttempted){
  for($i=0;$i -lt 5;$i++){Assert-FixedRecord $records[$i] (Get-FixedRecord $targets[$i] $handles[$i])}
  $null=Get-OwnedTree $oldRoot
  Remove-Item -LiteralPath $marker -Force
  return
 }
 Close-FixedHandles
 if($stopAttempted){
  if($startAttempted){Stop-CompletionHost $(if($switched){$releaseRoot}else{$oldRoot})}
  Assert-StoppedInstallation
 }
 if($switched){
  Write-CompletionPointer 3 $configBytes;Write-CompletionPointer 4 $launcherBytes
 }
 Open-FixedHandles $true
 # Only records captured under this transaction's no-write/no-delete lock.
 $restoreRecords=@($records | ForEach-Object {$_.PSObject.Copy()})
 for($i=3;$i -lt 5;$i++){
  if($switched){
   $live=Get-FixedRecord $targets[$i] $handles[$i]
   Assert-FixedRecord $pointerRecords[$i-3] $live
   if($live.hash -cne $records[$i].hash){throw 'RESTORE_REJECTED'}
   $restoreRecords[$i].identity=$live.identity
  }
 }
 Restore-FixedRecords $targets $handles $restoreRecords $wanted -EnforceExpiry
 Close-FixedHandles
 Assert-CompletionState
 if($stopAttempted){
  Assert-FixedExpiry;Start-ScheduledTask -TaskName $taskName
  $releaseRoot=$oldRoot
  $health=Wait-Health $current.commit
  if(-not $health.serviceRecoveryVerified){throw 'RECOVERY_UNVERIFIED'}
 }else{$null=Get-OwnedTree $oldRoot}
 Assert-CompletionState
 Remove-Item -LiteralPath $marker -Force
}
try {
 Assert-FixedExpiry
 if($SourceRevision -notmatch '^[a-f0-9]{40}$' -or $ExpectedHelperSha256 -notmatch '^[a-fA-F0-9]{64}$' -or
  (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash -ine $ExpectedHelperSha256){throw 'SOURCE_REJECTED'}
 if($identity.User.Value -cne 'S-1-5-21-3241814747-1938433149-1705921193-1004' -or $env:USERPROFILE -ine 'C:\Users\qq113' -or
  -not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'OWNER_ADMIN_REQUIRED'}
 $env:GORIQ_PC_APPROVED_REVISION=$SourceRevision;$env:GITHUB_REPOSITORY='haji84/AI-';$env:GITHUB_REF='refs/heads/main';$env:GITHUB_SHA=$SourceRevision
 Set-Location $source
 # Pin every tracked source/config dependency, including transitive TS imports,
 # before source verification or privileged calls. No hidden index omissions.
 $listed=@(& git -C $source -c core.quotepath=false ls-files -v)
 if($LASTEXITCODE -ne 0 -or $listed.Count -eq 0 -or @($listed | Where-Object {$_ -cnotmatch '^H '}).Count){throw 'SOURCE_REJECTED'}
 foreach($line in $listed){
  $path=[IO.Path]::GetFullPath((Join-Path $source $line.Substring(2)))
  if(-not $path.StartsWith($source.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'SOURCE_REJECTED'}
  $s=New-Object IO.FileStream($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $sourceStreams+=,$s;Assert-CompletionNative $s.SafeFileHandle $path
 }
 if($Phase -ne 'restore'){Assert-CompletionSource}else{
  if((& git -C $source rev-parse HEAD).Trim() -cne $SourceRevision -or $LASTEXITCODE -ne 0){throw 'SOURCE_REJECTED'}
  & git -C $source diff --quiet HEAD --
  if($LASTEXITCODE -ne 0){throw 'SOURCE_REJECTED'}
 }
 foreach($relative in @('scripts/goriq-zbook-fixed-acl-repair.ps1','scripts/goriq-zbook-owner-acl-repair.ps1','scripts/goriq-zbook-acl-boundary-repair.ps1','scripts/goriq-pc-runtime-refresh-windows.ps1')){
  $s=New-Object IO.FileStream((Join-Path $source $relative),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $sourceStreams+=,$s;$reader=New-Object IO.StreamReader($s,[Text.Encoding]::UTF8,$true,4096,$true)
  try{$sourceTexts[$relative]=$reader.ReadToEnd()}finally{$reader.Dispose()}
  if((& git -C $source hash-object ('--path='+$relative) (Join-Path $source $relative)).Trim() -cne (& git -C $source rev-parse ($SourceRevision+':'+$relative)).Trim()){throw 'SOURCE_REJECTED'}
 }
 $fixed=$sourceTexts['scripts/goriq-zbook-fixed-acl-repair.ps1']
 Import-CompletionFunctions $fixed @('Import-FixedFunctions','Get-FixedTargets','New-FixedDescriptor','Initialize-FixedNative','Initialize-FixedProcessNative','Bind-FixedProcessTree','Get-FixedBytes','Get-FixedHash','Get-FixedRecord','Assert-FixedRecord','Invoke-FixedTransition','Restore-FixedRecords','Write-FixedTransaction','Read-FixedTransaction','Assert-FixedTree','Close-FixedHandles','Open-FixedHandles','Assert-FixedGuards')
 Import-FixedFunctions $sourceTexts['scripts/goriq-zbook-owner-acl-repair.ps1'] @('Test-KnownReadOnlyRights','Get-RuleFacts','Select-RepairCandidate','Assert-OwnedNative')
 Import-FixedFunctions $sourceTexts['scripts/goriq-zbook-acl-boundary-repair.ps1'] @('Write-BoundaryBackup','Assert-ProfileOwner','Assert-NativeProfile')
 Import-FixedFunctions $sourceTexts['scripts/goriq-pc-runtime-refresh-windows.ps1'] @('Get-LiveListeners','Assert-StoppedInstallation','Assert-State-Preserved','Get-OwnedTree','Stop-OwnedTree','Same-Bytes','Restore-ReleaseDirectoryOwner','New-OwnedReleaseDirectory','Wait-Health','Assert-NativeFile','Test-NativeAllowSid')
 Initialize-FixedNative
 if($Phase -eq 'restore'){
  Resume-CompletionRecovery
  @{issue=1858;phase='restore';verified=$true;restored=$true;sourceRevision=$SourceRevision;backupId=$backupId;at=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  exit 0
 }
 $stage='native-preflight';$targets=@(Get-FixedTargets $root)
 Open-CompletionGuards
 Assert-NativeProfile $env:USERPROFILE $identity;Assert-OwnedNative $root $identity
 $candidate=Select-RepairCandidate @(Get-RuleFacts (Get-Acl -LiteralPath $root) $identity)
 if([long]$candidate.rule.FileSystemRights -ne 0x1200A9 -or [string]$candidate.rule.PropagationFlags -ne 'None'){throw 'DACL_REJECTED'}
 foreach($entry in $targets){
  Assert-OwnedNative $entry.path $identity
  $h=[GoriqFixedAclNative]::Open($entry.path,$false,$entry.directory);$handles+=,$h;Assert-CompletionNative $h $entry.path
  $record=Get-FixedRecord $entry $h;$records+=,$record
  $wanted+=,(New-FixedDescriptor $record.descriptor $identity.User.Value $candidate.sidValue $entry.directory)
 }
 $task=Get-ScheduledTask -TaskName $taskName;$taskXml=Export-ScheduledTask -TaskName $taskName
 $taskSid=([Security.Principal.NTAccount]$task.Principal.UserId).Translate([Security.Principal.SecurityIdentifier]).Value
 if($taskSid -cne $identity.User.Value -or $task.Principal.RunLevel -ne 'Limited' -or $task.Principal.LogonType -ne 'Password' -or $task.State -ne 'Running' -or
  $task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ine 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -or
  $task.Actions[0].Arguments -cne ('-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$compat+'"')){throw 'TASK_CHANGED'}
 $configBytes=Get-FixedBytes $configPath;$launcherBytes=Get-FixedBytes $launcherPath
 $secure=ConvertTo-SecureString ([Text.Encoding]::UTF8.GetString($configBytes).Trim([char]0xFEFF).Trim())
 $plain=(New-Object Management.Automation.PSCredential('config',$secure)).GetNetworkCredential().Password
 $current=$plain | ConvertFrom-Json;$plain=$null;$secure=$null
 if($current.version -ne 1 -or $current.commit -cne 'a49c458d69a28c0266be8fcad5b26253e5ed8d75' -or $current.releaseRoot -cne $oldRoot){throw 'BASELINE_CHANGED'}
 $launcher=[Text.Encoding]::UTF8.GetString($launcherBytes).TrimStart([char]0xFEFF)
 if(-not $launcher.Contains($oldRoot)){throw 'BASELINE_CHANGED'}
 $nextLauncher=$launcher.Replace($oldRoot,$releaseRoot)
 $before=Inspect-State 'inspect';Assert-CompletionState
 $tree=@(Get-OwnedTree $oldRoot);$null=$tree
 $marker=Join-Path $env:LOCALAPPDATA 'goriq-1858-native-active.json'
 if(Test-Path -LiteralPath $marker){throw 'RECONCILIATION_REQUIRED'}
 if($Phase -eq 'apply'){
  # Reserve ample forward/recovery time before the first service interruption.
  if([datetimeoffset]::UtcNow.AddMinutes(30) -ge [datetimeoffset]::Parse('2026-10-23T14:30:00Z')){throw 'INSUFFICIENT_RECOVERY_WINDOW'}
  if(Test-Path -LiteralPath $releaseRoot){throw 'IMMUTABLE_RELEASE_EXISTS'}
  $stage='transaction'
  $result=Invoke-CompletionTransaction -Persist {
   Assert-CompletionSource;Assert-CompletionState
   $script:backupId=[guid]::NewGuid().ToString('N')
   $backupPath=Join-Path $env:LOCALAPPDATA ('goriq-1858-native-before-'+$backupId+'.dpapi')
   $transaction=@{version=1;issue=1858;sourceRevision=$SourceRevision;helperSha256=$ExpectedHelperSha256;ownerSid=$identity.User.Value;records=$records;wanted=$wanted;guards=$guardRecords;state=$before;taskXml=$taskXml;configCipher=[Convert]::ToBase64String($configBytes);launcherCipher=[Convert]::ToBase64String($launcherBytes)}
   Write-FixedTransaction $backupPath $marker $transaction $backupId
  } -Apply {
   Stop-CompletionHost $oldRoot
   Close-FixedHandles;Open-FixedHandles $true
   for($i=0;$i -lt 5;$i++){
    Assert-CompletionState;$script:mutated=$true
    Invoke-FixedTransition $targets[$i] $handles[$i] $records[$i] $wanted[$i] -EnforceExpiry
   }
   $script:pointerRecords=@((Get-FixedRecord $targets[3] $handles[3]),(Get-FixedRecord $targets[4] $handles[4]))
   Close-FixedHandles
   foreach($entry in $targets){Assert-NativeFile $entry.path}
   $script:stage='build';Assert-CompletionState
   New-OwnedReleaseDirectory $releaseRoot $identity.User;Assert-NativeFile $releaseRoot
   $archive=Join-Path $releaseRoot 'source.tar'
   & git -C $source archive --format=tar ('--output='+$archive) $SourceRevision
   if($LASTEXITCODE -ne 0){throw 'ARCHIVE_FAILED'}
   & tar -xf $archive -C $releaseRoot
   if($LASTEXITCODE -ne 0){throw 'ARCHIVE_FAILED'}
   Invoke-CompletionBuild
   Assert-CompletionSource;Assert-CompletionState
   [IO.File]::WriteAllText((Join-Path $releaseRoot 'jarvis-release.json'),(@{version=1;commit=$SourceRevision;issue=1858} | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
   $prepared=Inspect-State 'prepare';Assert-State-Preserved $before $prepared
   $next=$current | ConvertTo-Json -Depth 20 -Compress | ConvertFrom-Json
   $next.commit=$SourceRevision;$next.releaseRoot=$releaseRoot
   $candidateJson=$next | ConvertTo-Json -Depth 20 -Compress
   $candidateJson | & $node (Join-Path $releaseRoot 'scripts\validate-jarvis-production-config.mjs') $releaseRoot $production
   if($LASTEXITCODE -ne 0){throw 'CANDIDATE_REJECTED'}
   $encoded=$candidateJson | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
   $script:stage='cutover';$script:switched=$true
   Write-CompletionPointer 3 ([Text.Encoding]::UTF8.GetBytes($encoded))
   Write-CompletionPointer 4 ([byte[]]([Text.Encoding]::UTF8.GetPreamble()+[Text.Encoding]::UTF8.GetBytes($nextLauncher)))
   $encoded=$null;$candidateJson=$null;$next=$null
   Assert-CompletionState;Assert-FixedExpiry;$script:startAttempted=$true
   Start-ScheduledTask -TaskName $taskName
  } -Verify {
   $script:stage='verify';$health=Wait-Health $SourceRevision
   if(-not $health.serviceRecoveryVerified){throw 'RECOVERY_UNVERIFIED'}
   Assert-CompletionState
   foreach($entry in $targets){Assert-NativeFile $entry.path}
   Remove-Item -LiteralPath $marker -Force
  } -Recover { Restore-Completion }
  $restored=$result.restored
  if(-not $result.verified){throw $result.failure}
 }
 @{issue=1858;phase=$Phase;verified=$true;productionActivated=($Phase -eq 'apply');sourceRevision=$SourceRevision;permissionChanged=$mutated;backupId=$backupId;stopAttempted=$stopAttempted;taskUnchanged=$true;schemaPreserved=$true;identityCount=$before.identityCount;androidCount=$before.androidCount;operationalAcceptance=$false;at=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
}catch{
 $failure=$_.Exception;while($null -ne $failure.InnerException){$failure=$failure.InnerException}
 $reason=if($failure.Message -match '^[A-Z_0-9-]{3,80}$'){$failure.Message}else{'NATIVE_ACTIVATION_FAILED'}
 @{issue=1858;phase=$Phase;verified=$false;stage=$stage;reason=$reason;permissionChanged=$mutated;stopAttempted=$stopAttempted;switched=$switched;restored=$restored;backupId=$backupId;reconciliationRequired=($null -ne $marker -and (Test-Path -LiteralPath $marker));at=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
 exit 1
}finally{
 foreach($h in $handles){$h.Dispose()};foreach($h in $guards){$h.Dispose()};foreach($s in $sourceStreams){$s.Dispose()}
 if('GoriqFixedProcessNative' -as [type]){[GoriqFixedProcessNative]::Clear()}
 Set-Location $initialLocation
 $current=$null;$plain=$null;$configBytes=$null;$launcherBytes=$null;$records=$null;$wanted=$null
}
