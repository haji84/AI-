param(
  [Parameter(Mandatory=$true)][string]$SourcePath,
  [ValidateSet('valid-positive','expiry-after-prompt','config-after-prompt','expiry-during-validation','config-during-validation','expiry-after-candidate-created','config-after-candidate-created')][string]$Case
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$source=[IO.File]::ReadAllText($SourcePath)
$sha=[Security.Cryptography.SHA256]::Create()
try {$sourceSha=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($source)))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count -ne 0){throw 'source parse failed'}
$guard=$ast.Find({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text -match '^if \(\$authorization\.scopeId'},$true)
$hashGuard=$ast.Find({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text -match '^if \(\(Get-FileHash'},$true)
$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$consumeConfiguration'},$true)
if($null -eq $guard -or $null -eq $hashGuard -or $null -eq $assignment){throw 'reviewed source boundaries missing'}
$block=$assignment.Right.Find({param($n) $n -is [Management.Automation.Language.ScriptBlockAst]},$true)
if($null -eq $block){throw 'actual source callback missing'}
# Keep the actual authorization/mutation/rollback statements verbatim. Only the
# final native MessageBox statement is removed as an explicit fake UI boundary;
# the RNG factory expression is replaced by a deterministic test-data object.
$statements=@($block.EndBlock.Statements|Where-Object { -not ($_ -is [Management.Automation.Language.TryStatementAst] -and $_.Body.Extent.Text.Contains('[System.Windows.Forms.MessageBox]::Show(')) }|ForEach-Object {$_.Extent.Text})
$callbackText='param($configuration)' + "`n" + ($statements -join "`n")
$rngExpression='[Security.Cryptography.RandomNumberGenerator]::Create()'
if(-not $callbackText.Contains($rngExpression)){throw 'reviewed RNG boundary missing'}
$callbackText=$callbackText.Replace($rngExpression,'$fixtureRng')
$temp=Join-Path ([IO.Path]::GetTempPath()) ('goriq-1218-authority-fixture-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp)|Out-Null
$global:fixtureTaskOps=[Collections.Generic.List[string]]::new()
$global:fixtureCase=$Case
$global:fixtureConfigPath=Join-Path $temp 'config.dpapi'
# Windows identity/DPAPI/ACL/task/network/validator/UI boundaries are fake.
# File.Replace is real and confined to this new temporary fixture directory.
function global:Get-ScheduledTask {param($TaskName) [pscustomobject]@{State='Running'}}
function global:Stop-ScheduledTask {param($TaskName) $global:fixtureTaskOps.Add('stop')}
function global:Start-ScheduledTask {param($TaskName) $global:fixtureTaskOps.Add('start')}
function global:Invoke-WebRequest {param([switch]$UseBasicParsing,$Method,$Uri,$Headers,$Body,$TimeoutSec) $global:fixtureTaskOps.Add('fake-login');[pscustomobject]@{StatusCode=200;Content='{"ok":true}'}}
function global:Start-Sleep {param($Seconds)}
function global:Get-Acl {param($LiteralPath) [pscustomobject]@{Fixture=$true}}
function global:Set-Acl {
 param($LiteralPath,$AclObject)
 if($global:fixtureCase -eq 'expiry-after-candidate-created'){[Threading.Thread]::Sleep(800)}
 if($global:fixtureCase -eq 'config-after-candidate-created'){[IO.File]::WriteAllText($global:fixtureConfigPath,'fixture-encrypted-concurrent-owner-update')}
}
function global:ConvertTo-SecureString {param([Parameter(ValueFromPipeline=$true)]$String,[switch]$AsPlainText,[switch]$Force) process {'fixture-secure-value'}}
function global:ConvertFrom-SecureString {param([Parameter(ValueFromPipeline=$true)]$SecureString) process {'fixture-encrypted-replacement'}}
try {
 $stateRoot=$temp;$releaseRoot=$temp;$taskName='FIXTURE-NO-REAL-TASK';$configPath=$global:fixtureConfigPath
 $node=(Get-Command node -ErrorAction Stop).Source;$validator=Join-Path $temp 'fake-validator.mjs'
 [IO.File]::WriteAllText($configPath,'fixture-encrypted-original')
 $validatorSource="import fs from 'node:fs';import path from 'node:path';const mode=process.argv[2],target=path.join(process.argv[3],'config.dpapi');fs.readFileSync(0);if(mode==='expiry-during-validation')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,800);if(mode==='config-during-validation')fs.writeFileSync(target,'fixture-encrypted-concurrent-owner-update');"
 [IO.File]::WriteAllText($validator,$validatorSource)
 # The existing callback passes releaseRoot/stateRoot to its validator. These
 # fake arguments encode only this fixture's mode and temporary target path.
 $releaseRoot=$Case
 $originalSha=(Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
 $identity=[pscustomobject]@{User=[pscustomobject]@{Value='fixture-owner-sid'}}
 $expires=[DateTimeOffset]::UtcNow.AddSeconds(30)
 if($Case -like 'expiry-*'){$expires=[DateTimeOffset]::UtcNow.AddMilliseconds(400)}
 $authorization=[pscustomobject]@{scopeId='issue:1218';ownerSid='fixture-owner-sid';credentialRotationApproval=$true;expiresAt=$expires.ToString('o');configSha256=$originalSha}
 & ([scriptblock]::Create($guard.Extent.Text))
 & ([scriptblock]::Create($hashGuard.Extent.Text))
 $initialGuardsPassed=$true
 # Evaluate actual top-level scriptblock dependency definitions, if present.
 # They define capabilities only; the fixture never runs the script entrypoint.
 $helperDefinitions=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ne '$consumeConfiguration' -and $null -ne $_.Right.Find({param($n) $n -is [Management.Automation.Language.ScriptBlockAst]},$true)})
 foreach($definition in $helperDefinitions){. ([scriptblock]::Create($definition.Extent.Text))}
 if($Case -eq 'expiry-after-prompt'){[Threading.Thread]::Sleep(800)}
 if($Case -eq 'config-after-prompt'){[IO.File]::WriteAllText($configPath,'fixture-encrypted-concurrent-owner-update')}
 $beforeCallback=[IO.File]::ReadAllText($configPath)
 $configuration=[pscustomobject]@{version=1;releaseRoot=$releaseRoot;environment=[pscustomobject]@{JARVIS_OWNER_SECRET='fixture-not-a-real-login-code-123456789';JARVIS_OWNER_TOKEN='fixture-other-value-preserved'}}
 $fixtureRng=New-Object psobject
 $fixtureRng|Add-Member -MemberType ScriptMethod -Name GetBytes -Value {param([byte[]]$bytes) for($i=0;$i -lt $bytes.Length;$i++){$bytes[$i]=7}}
 $fixtureRng|Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
 $callback=([scriptblock]::Create($callbackText)).GetNewClosure()
 $caught=$null
 try{& $callback $configuration|Out-Null}catch{$caught=$_.Exception.Message}
 $afterCallback=[IO.File]::ReadAllText($configPath)
 # For simulated concurrent writes during validation/ACL, preserving that
 # writer's bytes is required. It must never become our replacement bytes.
 $unexpectedReplacement=($afterCallback -eq 'fixture-encrypted-replacement')
 $candidateLeft=@([IO.Directory]::GetFiles($temp,'*.candidate')).Count
 $result=[ordered]@{case=$Case;sourceSha256=$sourceSha;runtime=$PSVersionTable.PSVersion.ToString();initialActualGuardsPassed=$initialGuardsPassed;expiredAtFinish=([DateTimeOffset]::UtcNow -ge $expires);replacementPerformed=$unexpectedReplacement;taskOperations=@($global:fixtureTaskOps.ToArray());candidateFilesLeft=$candidateLeft;refused=($null -ne $caught);offlineWindowsBoundariesMocked=$true;actualDPAPIOrProductionOrNetworkUsed=$false;mutationAndRollbackStatementsFromSource=$true;nativeUiOmitted=$true;credentialRngReplacedByDeterministicFixture=$true}
 $result|ConvertTo-Json -Depth 6 -Compress
 if($Case -ne 'valid-positive' -and ($unexpectedReplacement -or $global:fixtureTaskOps.Count -gt 0 -or -not $result.refused -or $candidateLeft -gt 0)){exit 1}
 if($Case -eq 'valid-positive' -and (-not $unexpectedReplacement -or $global:fixtureTaskOps.Count -ne 3 -or $result.refused)){exit 2}
} finally {
 [IO.Directory]::Delete($temp,$true)
}
