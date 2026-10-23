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
Add-Type -TypeDefinition @'
public sealed class CompletionFixtureHandle : System.IDisposable { public void Dispose() {} }
public static class GoriqFixedAclNative {
 public static CompletionFixtureHandle Open(string p,bool w,bool d) { return new CompletionFixtureHandle(); }
}
'@
$SourceRevision='a'*40;$ExpectedHelperSha256='b'*64;$RecoveryBackupId='c'*32
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
