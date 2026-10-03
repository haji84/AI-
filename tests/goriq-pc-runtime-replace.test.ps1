Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Extract only byte replacement; never run production updater.
$tokens=$null;$errors=$null
$source=Join-Path $PSScriptRoot '..\scripts\goriq-pc-runtime-refresh-windows.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'runtime-script-parse'}
$definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Replace-Bytes'},$true)
if($null -eq $definition){throw 'replace-function-missing'}
Invoke-Expression $definition.Extent.Text
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('goriq-replace-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$path=Join-Path $fixture 'pointer.bin'
$before=[byte[]]@(0,1,128,255,13,10)
$after=[byte[]]@(255,0,2,3)
try {
  [IO.File]::WriteAllBytes($path,$before)
  Replace-Bytes $path $after
  if([Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) -cne [Convert]::ToBase64String($after)){throw 'activate-bytes-mismatch'}
  Replace-Bytes $path $before
  if([Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) -cne [Convert]::ToBase64String($before)){throw 'rollback-bytes-mismatch'}
  Write-Output 'Atomic activation and rollback byte fixtures PASS'
} finally {
  # Remove only this uniquely created disposable fixture.
  Remove-Item -LiteralPath $fixture -Recurse -Force
}
