# Execute the actual resume controller against an isolated process/OS adapter.
# No production file, service, privilege or permission operation is performed.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\scripts\goriq-completion-native-activate.ps1'),[ref]$tokens,[ref]$errors)
foreach($name in @('Resume-CompletionRecovery','Restore-Completion','Assert-CompletionRecoveryRecords','Get-CompletionByteHash')){
 $def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 Invoke-Expression $def.Extent.Text
}
foreach($name in @('Assert-CompletionRecoveryProvenance','Restart-CompletionUnchangedBaseline')){
 $def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 if($null -ne $def){Invoke-Expression $def.Extent.Text}
}
Add-Type -TypeDefinition @'
public sealed class CompletionFixtureHandle : System.IDisposable { public void Dispose() {} }
public static class GoriqFixedAclNative {
 public static CompletionFixtureHandle Open(string p,bool w,bool d) { return new CompletionFixtureHandle(); }
}
'@
$SourceRevision='a'*40;$ExpectedHelperSha256='b'*64;$RecoveryBackupId='c'*32
$RestartUnchangedBaseline=$false;$Phase='restore'
$root='fixture-root';$oldRoot='fixture-old';$releaseRoot='fixture-new';$installationRoot='fixture';$taskName='fixture-task'
$identity=[pscustomobject]@{User=[pscustomobject]@{Value='fixture-owner'}}
$cipher=ConvertFrom-SecureString (ConvertTo-SecureString '{"version":1,"commit":"fixture-old","releaseRoot":"fixture-old"}' -AsPlainText -Force)
$cipherBytes=[Text.Encoding]::UTF8.GetBytes($cipher);$launchBytes=[Text.Encoding]::UTF8.GetBytes('fixture-launcher')
$fixtureRecords=@(0..4 | ForEach-Object {[pscustomobject]@{path="fixture-$_";directory=($_ -lt 3);identity="id-$_";descriptor="original-$_";hash=$(if($_ -eq 3){Get-CompletionByteHash $cipherBytes}elseif($_ -eq 4){Get-CompletionByteHash $launchBytes}else{$null})}})
$fixtureTx=[pscustomobject]@{version=1;issue=1858;sourceRevision=$SourceRevision;helperSha256=$ExpectedHelperSha256;ownerSid=$identity.User.Value;records=$fixtureRecords;wanted=@(0..4 | ForEach-Object {"changed-original-$_"});guards=@();state=@{fixture=$true};taskXml='fixture-task';configCipher=[Convert]::ToBase64String($cipherBytes);launcherCipher=[Convert]::ToBase64String($launchBytes)}
$serialized=$fixtureTx | ConvertTo-Json -Depth 8 -Compress
$steps=New-Object 'Collections.Generic.List[string]'
function Assert-FixedExpiry {}
function Assert-CompletionNative {}
function Read-FixedTransaction { $steps.Add('load');return ($serialized | ConvertFrom-Json) }
function Get-FixedTargets { return $fixtureRecords }
function Open-CompletionGuards { $script:guardRecords=@();$script:guardEntries=@();$script:guards=@() }
function Get-Acl { return 'fixture-acl' }
function Get-RuleFacts { return 'fixture-rules' }
function Select-RepairCandidate { return [pscustomobject]@{sidValue='fixture-reader'} }
function New-FixedDescriptor($d) { return 'changed-'+$d }
function Get-FixedRecord($entry,$handle) { return ($fixtureRecords | Where-Object {$_.path -ceq $entry.path}) }
function Assert-FixedRecord($a,$b) { if(($a | ConvertTo-Json -Compress) -cne ($b | ConvertTo-Json -Compress)){throw 'fixture-record-drift'} }
function Read-CompletionIntent { return $null }
function Assert-CompletionState { $steps.Add('state') }
function Get-OwnedTree($expected) { if($expected -cne $oldRoot){throw 'fixture-wrong-root'};$steps.Add('healthy-old');return [pscustomobject]@{ProcessId=42} }
function Get-CimInstance { return [pscustomobject]@{Name='node.exe';CommandLine='fixture-old jarvis-remote-host.mjs'} }
function Stop-CompletionHost { $steps.Add('STOP');throw 'healthy-host-stopped' }
function Assert-StoppedInstallation { throw 'healthy-host-required-stopped' }
function Remove-Item { $steps.Add('clear-marker') }
$handles=@();$guardRecords=@();$mutated=$false;$stopAttempted=$false;$switched=$false;$startAttempted=$false;$restored=$false
Resume-CompletionRecovery
if(-not $restored -or $mutated -or $stopAttempted -or $steps -contains 'STOP' -or $steps -notcontains 'clear-marker' -or $steps -notcontains 'load' -or $steps -notcontains 'healthy-old'){throw 'no-mutation-resume-failed'}
Write-Output 'Actual resume controller: persisted-before-apply interruption leaves healthy old host running PASS'

# Reproduce stopped, baseline-equal recovery with an unavailable writable handle.
# Only the explicit recovery mode may use the pinned prior transaction, and it
# must never fall through to ACL/pointer restoration or another stop.
$RestartUnchangedBaseline=$true
$RecoveryBackupId='bde347b3c55a4db1af3bd63e9528d464'
$fixtureTx.sourceRevision='75100488cdde6b58e5b4ed1bb72c654faefc7b5f'
$fixtureTx.helperSha256='025e2cb455b4ff8727aff5e5cac83c9bc67b3edf4c53b7343807de779741f7ed'
$serialized=$fixtureTx | ConvertTo-Json -Depth 8 -Compress
$pinnedSerialized=$serialized
$fixtureStarted=$false;$fixtureHealthy=$true;$fixtureStopped=$true;$fixtureStateGood=$true;$fixtureRecordGood=$true
$fixtureLockGood=$true
function Open-CompletionReadLock($index) { if(-not $fixtureLockGood){throw 'fixture-sharing-violation'};return (New-Object CompletionFixtureHandle) }
function Get-OwnedTree($expected) { if(-not $fixtureStarted){throw 'host'};if($expected -cne $oldRoot){throw 'fixture-wrong-root'};return [pscustomobject]@{ProcessId=42} }
function Get-CimInstance { return @() }
function Assert-StoppedInstallation { if(-not $fixtureStopped -or $fixtureStarted){throw 'stopped-installation'};$steps.Add('stopped') }
function Open-FixedHandles { throw 'HANDLE_REJECTED_32' }
function Close-FixedHandles { $steps.Add('close') }
function Restore-FixedRecords { throw 'unexpected-acl-write' }
function Write-CompletionPointer { throw 'unexpected-pointer-write' }
function Assert-CompletionState { if(-not $fixtureStateGood){throw 'fixture-state-drift'};$steps.Add('state') }
function Start-ScheduledTask { param($TaskName) if($TaskName -cne 'fixture-task' -or $fixtureStarted){throw 'unexpected-start'};$steps.Add('START');$script:fixtureStarted=$true }
function Wait-Health($sha) { if($sha -cne 'fixture-old' -or $releaseRoot -cne $oldRoot){throw 'wrong-recovery-release'};$steps.Add('health');return @{serviceRecoveryVerified=$fixtureHealthy} }
function Get-FixedRecord($entry,$handle) {
 $record=($fixtureRecords | Where-Object {$_.path -ceq $entry.path}).PSObject.Copy()
 if(-not $fixtureRecordGood -and $fixtureStarted -and $entry.path -ceq 'fixture-2'){$record.descriptor='post-start-drift'}
 return $record
}
$steps.Clear();$handles=@();$restored=$false;$mutated=$false;$stopAttempted=$false;$startAttempted=$false
Resume-CompletionRecovery
if(-not $restored -or $mutated -or $stopAttempted -or @($steps | Where-Object {$_ -ceq 'START'}).Count -ne 1 -or $steps -notcontains 'health' -or $steps[-1] -cne 'clear-marker' -or $steps -contains 'close'){throw 'restart-only-recovery-failed'}
Write-Output 'Actual resume controller: unchanged stopped baseline restarts once without writable handle PASS'
foreach($fault in @('backup-id','source','helper','owner','descriptor','identity','bytes','task-state','state','health','post-record','default-mode','writer-lock')){
 $serialized=$pinnedSerialized;$RecoveryBackupId='bde347b3c55a4db1af3bd63e9528d464';$RestartUnchangedBaseline=$true
 $fixtureStarted=$false;$fixtureHealthy=$true;$fixtureStopped=$true;$fixtureStateGood=$true;$fixtureRecordGood=$true
 $fixtureLockGood=$true
 $steps.Clear();$handles=@();$restored=$false;$mutated=$false;$stopAttempted=$false;$startAttempted=$false
 $tx=$serialized | ConvertFrom-Json
 switch($fault){
  'backup-id' {$RecoveryBackupId='d'*32}
  'source' {$tx.sourceRevision='d'*40}
  'helper' {$tx.helperSha256='d'*64}
  'owner' {$tx.ownerSid='another-owner'}
  'descriptor' {$tx.records[2].descriptor='different'}
  'identity' {$tx.records[2].identity='different'}
  'bytes' {$tx.records[4].hash='different'}
  'task-state' {$fixtureStopped=$false}
  'state' {$fixtureStateGood=$false}
  'health' {$fixtureHealthy=$false}
  'post-record' {$fixtureRecordGood=$false}
  'default-mode' {$RestartUnchangedBaseline=$false}
  'writer-lock' {$fixtureLockGood=$false}
 }
 $serialized=$tx | ConvertTo-Json -Depth 8 -Compress
 $rejected=$false;try{Resume-CompletionRecovery}catch{$rejected=$true}
 if(-not $rejected -or $restored -or $steps -contains 'clear-marker'){throw "unsafe-restart-accepted-$fault"}
 if($fault -notin @('health','post-record') -and $fixtureStarted){throw "restart-before-preflight-$fault"}
 if($mutated -or $stopAttempted -or $steps -contains 'STOP' -or $steps -contains 'close'){throw "restart-fell-through-$fault"}
}
Write-Output 'Restart-only provenance, baseline, stopped/state and post-start rejection preserve marker PASS'

# Exercise the actual read-lock implementation with real Windows file sharing.
$def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Open-CompletionReadLock'},$true)
Invoke-Expression $def.Extent.Text
$fixturePath=Join-Path ([IO.Path]::GetTempPath()) ('goriq-1858-read-lock-'+[guid]::NewGuid().ToString('N'))
$lock=$null;$writer=$null
try{
 [IO.File]::WriteAllText($fixturePath,'original')
 $entry=[pscustomobject]@{path=$fixturePath;directory=$false;identity='fixture-id';descriptor='fixture-descriptor';hash=(Get-CompletionByteHash ([IO.File]::ReadAllBytes($fixturePath)))}
 $targets=@($null,$null,$null,$entry);$records=@($null,$null,$null,$entry)
 function Get-FixedRecord($entry,$handle) { $result=$entry.PSObject.Copy();$result.hash=Get-CompletionByteHash ([IO.File]::ReadAllBytes($entry.path));return $result }
 $lock=Open-CompletionReadLock 3
 if([IO.File]::ReadAllText($fixturePath) -cne 'original'){throw 'read-lock-blocks-launcher-read'}
 $blocked=$false;try{[IO.File]::WriteAllText($fixturePath,'changed')}catch{$blocked=$true}
 if(-not $blocked){throw 'read-lock-allows-concurrent-writer'}
 $lock.Dispose();$lock=$null
 $writer=New-Object IO.FileStream($fixturePath,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)
 $blocked=$false;try{$lock=Open-CompletionReadLock 3}catch{$blocked=$true}
 if(-not $blocked){throw 'read-lock-admitted-existing-writer'}
 $writer.Dispose();$writer=$null
 [IO.File]::WriteAllText($fixturePath,'drift')
 $blocked=$false;try{$lock=Open-CompletionReadLock 3}catch{$blocked=$true}
 if(-not $blocked){throw 'read-lock-admitted-byte-drift'}
 Write-Output 'Real read locks: readers allowed, existing/new writers and baseline drift refused PASS'
}finally{
 if($null -ne $lock){$lock.Dispose()};if($null -ne $writer){$writer.Dispose()}
 [IO.File]::Delete($fixturePath)
}
