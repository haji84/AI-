Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\tmp'))) ('native-process-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$child=Join-Path $testRoot 'child.ps1'
@'
param([int]$Code=0)
[Console]::Error.WriteLine('fixture-build-warning')
[Console]::Out.WriteLine('fixture-child-completed')
exit $Code
'@ | Set-Content -LiteralPath $child -Encoding UTF8
$powershell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$legacyFailed=$false
try { & $powershell -NoProfile -ExecutionPolicy RemoteSigned -File $child *> (Join-Path $testRoot 'legacy.log') }
catch { $legacyFailed=$_.FullyQualifiedErrorId -match 'NativeCommandError' }
if(-not $legacyFailed){throw 'legacy-warning-termination-not-reproduced'}
Write-Host 'Legacy NativeCommandError reproduced from a stderr warning.'
$source=Join-Path $PSScriptRoot '..\scripts\goriq-pc-runtime-launch.ps1'
if(-not (Test-Path -LiteralPath $source)){throw 'runtime-launch-helper-missing'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'runtime-launch-helper-parse'}
foreach($name in @('Invoke-RuntimeProcess','Assert-RuntimeReceipt')) {
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if($null -eq $definition){throw 'runtime-launch-function-missing'}
  Invoke-Expression $definition.Extent.Text
}
$success=Invoke-RuntimeProcess $powershell @('-NoProfile','-ExecutionPolicy','RemoteSigned','-File',('"'+$child+'"')) $testRoot 'success'
if($success.exitCode -ne 0 -or -not (Get-Content -LiteralPath $success.stdout -Raw).Contains('fixture-child-completed') -or -not (Get-Content -LiteralPath $success.stderr -Raw).Contains('fixture-build-warning')){throw 'warning-capture-failed'}
$failure=Invoke-RuntimeProcess $powershell @('-NoProfile','-ExecutionPolicy','RemoteSigned','-File',('"'+$child+'"'),'-Code','9') $testRoot 'failure'
if($failure.exitCode -ne 9){throw 'child-failure-hidden'}
$sha='a'*40
$receipt=@{issue=1662;nodeId='zbook';phase='apply';revision=$sha;runtimeExact=$true;identityPreserved=$true;schemaPreserved=$true;taskUnchanged=$true}
Assert-RuntimeReceipt $receipt 'apply' $sha
foreach($field in @('runtimeExact','identityPreserved','schemaPreserved','taskUnchanged')) {
  foreach($value in @($false,'true','false',1)) {
    $bad=$receipt.Clone();$bad[$field]=$value;$rejected=$false
    try { Assert-RuntimeReceipt $bad 'apply' $sha } catch {$rejected=$true}
    if(-not $rejected){throw 'incomplete-apply-accepted'}
  }
}
$rejected=$false
try { Assert-RuntimeReceipt @{sourceRevision=$sha;exactMainCi=$true} 'apply' $sha } catch {$rejected=$true}
if(-not $rejected){throw 'source-only-receipt-accepted'}
Write-Host 'Native runtime process capture fixtures PASS (no production invocation).'
