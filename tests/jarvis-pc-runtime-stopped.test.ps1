Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$source=Join-Path $PSScriptRoot '..\scripts\goriq-pc-runtime-refresh-windows.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'runtime-script-parse'}
foreach($name in @('Wait-Health','Get-LiveListeners','Assert-StoppedInstallation','Assert-State-Preserved','Same-Bytes','Assert-StoppedRollback')){
  $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if($null -ne $definition){Invoke-Expression $definition.Extent.Text}
}
$ports=@(3000,8787,8790,8792); $taskName='JARVIS Remote Host'
$releaseRoot='C:\fixture\JARVIS\releases\candidate'; $installationRoot='C:\fixture\JARVIS'
$taskXml='fixture-task-xml'; $fixtureTaskState='Running'; $fixtureTaskXml=$taskXml
$fixturePorts=@(3000,8787,8790); $fixtureAddress=$false; $fixtureProcesses=@()
$fixtureQueryFails=$false; $fixtureProcessFails=$false; $fixtureAddressFails=$false
$fixtureHealthFails=$false; $fixtureRevision='candidate'; $fixtureTransitions=@(); $fixtureInspectorCalls=0
$fixtureState=@{schemaDigest='schema';identityDigest='identity';fleetDigest='fleet';tasksDigest='tasks';pcTasksDigest='pc-tasks';compassDigest='compass';privateAddressAssigned=$false}
function Start-Sleep { param($Seconds) }
function Get-ScheduledTask {param($TaskName) return [pscustomobject]@{State=$fixtureTaskState}}
function Export-ScheduledTask {param($TaskName) return $fixtureTaskXml}
function Get-CimInstance {
  [CmdletBinding()]param($ClassName,$OperationTimeoutSec)
  if($OperationTimeoutSec -ne 15){throw 'process-timeout-missing'}
  if($fixtureProcessFails){throw 'SECRET_PROCESS_ERROR'}
  return $fixtureProcesses
}
function Get-NetTCPConnection {
  [CmdletBinding()]param($State,$LocalPort)
  if($fixtureQueryFails){throw 'SECRET_LISTENER_ERROR'}
  return @($fixturePorts | ForEach-Object {[pscustomobject]@{LocalPort=$_;OwningProcess=2}})
}
function Inspect-State {
  param($operation)
  if($fixtureAddressFails){throw 'state'}
  $script:fixtureInspectorCalls++
  if($fixtureTransitions.Count){
    $script:fixtureAddress=$fixtureTransitions[0]
    if($fixtureTransitions.Count -gt 1){$script:fixtureTransitions=@($fixtureTransitions | Select-Object -Skip 1)}else{$script:fixtureTransitions=@()}
    if($fixtureAddress){$script:fixturePorts=@(3000,8787,8790,8792)}
  }
  $result=@{}; foreach($key in $fixtureState.Keys){$result[$key]=$fixtureState[$key]}
  $result.privateAddressAssigned=$fixtureAddress
  return [pscustomobject]$result
}
function Get-OwnedTree {param($root,$requireHealthy,$requiredPorts) return @([pscustomobject]@{ProcessId=2})}
function Invoke-RestMethod {
  [CmdletBinding()]param($Uri,$TimeoutSec)
  if($fixtureHealthFails){throw 'health'}
  if($Uri -eq 'http://127.0.0.1:8787/health'){return @{ok=$true;runtimeRevision=$fixtureRevision;service='jarvis-broker'}}
  if($Uri -eq 'http://127.0.0.1:8790/health'){return @{ok=$true;service='jarvis-remote-gateway'}}
  if($Uri -eq 'http://127.0.0.1:3000/api/health'){return @{status='ok'}}
  throw 'unexpected-health-uri'
}
function Assert-Refused([scriptblock]$action,[string]$label) {
  $refused=$false
  try{& $action | Out-Null}catch{$refused=$true}
  if(-not $refused){throw ('UNSAFE_ACCEPTANCE_'+$label)}
}
# Regression uses actual old Wait-Health: it rejects verified core health while the configured LAN is absent.
try{$ready=Wait-Health 'candidate'}catch{throw 'OFFLINE_CORE_ACTIVATION_REJECTED'}
if($ready.privateIngressReady -or -not $ready.coreServicesReady -or $ready.activationState -ne 'network-waiting'){throw 'degraded-receipt'}
$fixtureAddress=$true; $fixturePorts=@(3000,8787,8790)
Assert-Refused {Wait-Health 'candidate'} 'present-address-requires-four'
$fixturePorts=@(3000,8787,8790,8792)
$ready=Wait-Health 'candidate'
if(-not $ready.privateIngressReady -or $ready.activationState -ne 'ready'){throw 'full-ready-receipt'}
$fixtureAddress=$false; $fixturePorts=@(3000,8787,8790); $fixtureTransitions=@($false,$true)
$ready=Wait-Health 'candidate'
if(-not $ready.privateIngressReady){throw 'address-return-was-misclassified'}
$fixtureAddressFails=$true; Assert-Refused {Wait-Health 'candidate'} 'address-query-fails'; $fixtureAddressFails=$false
$fixtureHealthFails=$true; Assert-Refused {Wait-Health 'candidate'} 'health-fails'; $fixtureHealthFails=$false
$fixtureRevision='wrong'; Assert-Refused {Wait-Health 'candidate'} 'revision-mismatch'; $fixtureRevision='candidate'

if(-not (Get-Command Assert-StoppedInstallation -ErrorAction SilentlyContinue)){throw 'stopped-baseline-guard-missing'}
$fixtureTaskState='Ready'; $fixturePorts=@(); $fixtureProcesses=@()
Assert-StoppedInstallation
$fixtureTaskState='Running'; Assert-Refused {Assert-StoppedInstallation} 'running-task'; $fixtureTaskState='Ready'
$fixtureTaskXml='changed'; Assert-Refused {Assert-StoppedInstallation} 'task-xml-race'; $fixtureTaskXml=$taskXml
$fixturePorts=@(8792); Assert-Refused {Assert-StoppedInstallation} 'busy-port'; $fixturePorts=@()
$fixtureQueryFails=$true; Assert-Refused {Assert-StoppedInstallation} 'listener-query-fails'; $fixtureQueryFails=$false
$fixtureProcessFails=$true; Assert-Refused {Assert-StoppedInstallation} 'process-query-fails'; $fixtureProcessFails=$false
foreach($command in @('node C:\fixture\JARVIS\releases\old\scripts\jarvis-broker.ts','node C:\elsewhere\jarvis-remote-host.mjs','powershell C:\fixture\JARVIS\production\launch-current.ps1')){
  $fixtureProcesses=@([pscustomobject]@{Name='node.exe';CommandLine=$command})
  Assert-Refused {Assert-StoppedInstallation} 'orphan-or-other-release'
}
$fixtureProcesses=@([pscustomobject]@{Name='node.exe';CommandLine=$null})
Assert-Refused {Assert-StoppedInstallation} 'hidden-node-command'
$fixtureProcesses=@([pscustomobject]@{Name='node.exe';CommandLine='node C:\unrelated\independent-app.mjs'})
Assert-StoppedInstallation
$fixtureProcesses=@()
$before=[pscustomobject]$fixtureState; $after=[pscustomobject]($fixtureState.Clone())
Assert-State-Preserved $before $after
foreach($field in @('schemaDigest','identityDigest','fleetDigest','tasksDigest','pcTasksDigest','compassDigest')){
  $changed=$fixtureState.Clone(); $changed[$field]='changed'
  Assert-Refused {Assert-State-Preserved $before ([pscustomobject]$changed)} ('digest-'+$field)
}
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('goriq-stopped-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $temporary
try{
  $configPath=Join-Path $temporary 'config.bin'; $launcherPath=Join-Path $temporary 'launcher.bin'
  $configBytes=[byte[]]@(1,2,3); $launcherBytes=[byte[]]@(4,5,6)
  [IO.File]::WriteAllBytes($configPath,$configBytes); [IO.File]::WriteAllBytes($launcherPath,$launcherBytes)
  Assert-StoppedRollback
  [IO.File]::WriteAllBytes($configPath,[byte[]]@(9))
  Assert-Refused {Assert-StoppedRollback} 'rollback-pointer-mismatch'
  [IO.File]::WriteAllBytes($configPath,$configBytes)
  $fixtureState.pcTasksDigest='changed'
  Assert-Refused {Assert-StoppedRollback} 'rollback-pc-task-change'
}finally{Remove-Item -LiteralPath $temporary -Recurse -Force}
Write-Output 'Stopped baseline and degraded activation fixtures PASS'
