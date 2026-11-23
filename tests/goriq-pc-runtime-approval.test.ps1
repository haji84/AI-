Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repository=Join-Path $PSScriptRoot '..'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $repository 'scripts/goriq-pc-runtime-refresh-windows.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'runtime-script-parse'}
$gate=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-Approval'},$true)
if($null -eq $gate){throw 'runtime-approval-missing'}
Invoke-Expression $gate.Extent.Text
$ownedTree=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-OwnedTree'},$true)
if($null -eq $ownedTree){throw 'runtime-owned-tree-missing'}
Invoke-Expression $ownedTree.Extent.Text

function Assert-Refused([datetimeoffset]$now) {
  try{Assert-Approval $now}catch{if($_.Exception.Message -ceq 'approval'){return};throw}
  throw 'runtime-approval-expected-refusal'
}

$source=Join-Path ([IO.Path]::GetTempPath()) ('goriq-runtime-approval-'+[guid]::NewGuid().ToString('N'))
$relative='docs/authorizations/1662-zbook-runtime-refresh.json'
$fixturePath=Join-Path $source $relative
$secondDay=[datetimeoffset]::Parse('2026-11-25T00:00:00Z')
try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $fixturePath) | Out-Null
  Copy-Item -LiteralPath (Join-Path $repository $relative) -Destination $fixturePath
  Assert-Approval ([datetimeoffset]::Parse('2026-11-23T12:15:59.000Z'))
  Assert-Approval $secondDay
  Assert-Approval ([datetimeoffset]::Parse('2026-11-26T12:14:59.999Z'))
  Assert-Refused ([datetimeoffset]::Parse('2026-11-23T12:15:58.999Z'))
  Assert-Refused ([datetimeoffset]::Parse('2026-11-26T12:15:00.000Z'))
  Assert-Refused ([datetimeoffset]::Parse('2026-11-26T12:15:00.001Z'))

  $json=Get-Content -LiteralPath $fixturePath -Raw
  foreach($change in @(
    @{field='approvedAt';value='2026-11-23T12:15:58.999Z'},
    @{field='expiresAt';value='2026-11-26T12:15:00.001Z'},
    @{field='expiresAt';value='2026-11-26T12:15:00.0001Z'},
    @{field='operation';value='pc-enrollment'},
    @{field='issue';value=1787},
    @{field='goalIssue';value=1662},
    @{field='targets';value=@(@{nodeId='zbook';platform='macos'})},
    @{field='targets';value=@(@{nodeId='zbook';platform='windows'},@{nodeId='zbook';platform='windows'})}
  )){
    $fixture=$json | ConvertFrom-Json
    $fixture.($change.field)=$change.value
    $fixture | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $fixturePath
    Assert-Refused $secondDay
  }

  $fixture=$json | ConvertFrom-Json
  $fixture.approvedAt='2026-11-24T12:00:00.000Z'
  $fixture.expiresAt='2026-11-25T12:00:00.000Z'
  $fixture | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $fixturePath
  Assert-Approval $secondDay
}finally{Remove-Item -LiteralPath $source -Recurse -Force}

$installationRoot='C:\Users\fixture\JARVIS'
$fixtureRelease=$installationRoot+'\releases\old'
$launcherPath=$installationRoot+'\production\launch-current.ps1'
$compat='C:\Users\fixture\AppData\Local\JARVIS\production\launch-current.ps1'
$current='{"environment":{"JARVIS_ADB_PATH":"C:/platform-tools/renamed-adb.exe"}}' | ConvertFrom-Json
$identity=@{User=@{Value='fixture-owner'}}
$ports=@(3000,8787,8790,8792)
$adb=[pscustomobject]@{Name='adb.exe';ProcessId=21;ParentProcessId=0;CommandLine='adb fork-server server'}
$fixtureProcesses=@(
  [pscustomobject]@{Name='powershell.exe';ProcessId=11;ParentProcessId=0;CommandLine=$compat},
  [pscustomobject]@{Name='powershell.exe';ProcessId=12;ParentProcessId=11;CommandLine=$launcherPath},
  [pscustomobject]@{Name='node.exe';ProcessId=13;ParentProcessId=12;CommandLine=($fixtureRelease+'\scripts\jarvis-remote-host.mjs')},
  [pscustomobject]@{Name='powershell.exe';ProcessId=31;ParentProcessId=0;CommandLine=$compat},
  $adb)
function Get-CimInstance { return $fixtureProcesses }
function Invoke-CimMethod { return @{ReturnValue=0;Sid='fixture-owner'} }
function Get-LiveListeners { return @($ports | ForEach-Object {[pscustomobject]@{LocalPort=$_;OwningProcess=13}}) }
function Assert-AdbRefused([string]$label) {
  try{$null=Get-OwnedTree $fixtureRelease $true $ports $true}catch{
    if($_.Exception.Message -ceq 'adb-stop-scope'){return}
    throw
  }
  throw ('adb-stop-scope-expected-refusal-'+$label)
}

if(@(Get-OwnedTree $fixtureRelease $true $ports $true).Count -ne 1){throw 'independent-adb-rejected'}
foreach($parent in @(13,11,31)) {
  $adb.ParentProcessId=$parent
  Assert-AdbRefused ('parent-'+$parent)
}
$adb.Name='RENAMED-ADB.EXE';$adb.ParentProcessId=13
$null=Get-OwnedTree $fixtureRelease
Assert-AdbRefused 'configured-name'

foreach($inputJson in @('{"environment":{}}','{}')) {
  $current=$inputJson | ConvertFrom-Json
  $adb.Name='adb.exe';$adb.ParentProcessId=0
  if(@(Get-OwnedTree $fixtureRelease $true $ports $true).Count -ne 1){throw 'independent-default-adb-rejected'}
  $adb.ParentProcessId=13
  Assert-AdbRefused 'default-name'
}
Write-Output 'Runtime approval fixtures PASS'
