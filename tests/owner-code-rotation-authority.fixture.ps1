param([Parameter(Mandatory=$true)][string]$SourcePath,[ValidateSet('valid-positive','expiry-after-prompt','config-after-prompt','expiry-during-validation','config-during-validation','expiry-after-candidate-created','config-after-candidate-created')][string]$Case)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
# Compatibility scenarios now call the import-safe real transaction directly;
# no production statements are extracted, removed or rewritten.
$scenario=if($Case -eq 'valid-positive'){'success'}else{$Case}
& (Join-Path $PSScriptRoot 'owner-code-rotation-transaction.fixture.ps1') -SourcePath $SourcePath -Case $scenario -LegacyAuthority
