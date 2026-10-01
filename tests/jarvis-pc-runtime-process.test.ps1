Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Exercise only the diagnostic function with controlled process/network inputs.
$source=Join-Path $PSScriptRoot '..\scripts\goriq-pc-runtime-refresh-windows.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'runtime-script-parse'}
$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Runtime-Process-Facts'},$true)
if($null -eq $function){throw 'diagnostic-missing'}
Invoke-Expression $function.Extent.Text
$identity=@{User=@{Value='fixture-owner'}}
$launcherPath='C:\Private\launch-current.ps1'; $compat='C:\Private\compat.ps1'; $ports=@(3000,8787,8790,8792)
$fixtureProcesses=@(
  [pscustomobject]@{Name='powershell.exe';ProcessId=11;ParentProcessId=0;CommandLine=$launcherPath+' SECRET_SENTINEL'},
  [pscustomobject]@{Name='node.exe';ProcessId=12;ParentProcessId=11;CommandLine='node C:\fixture\scripts\jarvis-remote-host.mjs SECRET_SENTINEL'},
  [pscustomobject]@{Name='node.exe';ProcessId=13;ParentProcessId=12;CommandLine=$null},
  [pscustomobject]@{Name='node.exe';ProcessId=14;ParentProcessId=0;CommandLine=$null})
function Get-CimInstance {return $fixtureProcesses}
function Invoke-CimMethod {
  [CmdletBinding()]param($InputObject,$MethodName)
  if($InputObject.ProcessId -eq 14){return @{ReturnValue=2}}
  return @{ReturnValue=0;Sid='fixture-owner'}
}
function Get-NetTCPConnection {
  [CmdletBinding()]param($State,$LocalPort)
  return @($ports | ForEach-Object {[pscustomobject]@{LocalPort=$_;OwningProcess=13}})
}
$fact=Runtime-Process-Facts 'C:\Fixture'
if($fact.candidates.Count -ne 3){throw 'Hidden service candidates must not disappear from diagnostic output'}
if($fact.hostRoleCandidateCount -ne 1 -or $fact.nodeMissingCommandLineCount -ne 2 -or $fact.listenerPortCount -ne 4){throw 'diagnostic-counts'}
$visible=$fact.candidates[0]; $hidden=$fact.candidates[1]; $denied=$fact.candidates[2]
if($visible.configuredRootExact -or -not $visible.configuredRootIgnoreCase -or -not $visible.launcherAncestorObserved){throw 'case-ancestor'}
if($hidden.commandLineAvailable -or $hidden.ownerClass -ne 'current-user' -or $hidden.directListenerPortCount -ne 4){throw 'hidden-service-visibility'}
if($denied.ownerQueryClass -ne 'access-denied' -or $denied.ownerClass -ne 'unavailable'){throw 'owner-denial'}
$json=$fact | ConvertTo-Json -Depth 7 -Compress
if($json.Contains('SECRET_SENTINEL') -or $json.Contains('C:') -or $json.Contains('fixture-owner') -or $json.Contains('ProcessId')){throw 'private-output'}
$fixtureProcesses[1].CommandLine='node scripts/jarvis-remote-host.mjs SECRET_SENTINEL'
$relative=(Runtime-Process-Facts 'C:\Fixture').candidates[0]
if($relative.configuredRootExact -or $relative.configuredRootIgnoreCase -or -not $relative.hostEntrypointObserved){throw 'relative-entrypoint'}
$fixtureProcesses=@(1..40 | ForEach-Object {[pscustomobject]@{Name='node.exe';ProcessId=100+$_;ParentProcessId=0;CommandLine=$null}})
$bounded=Runtime-Process-Facts 'C:\Fixture'
if($bounded.candidates.Count -ne 32 -or -not $bounded.candidatesTruncated -or $bounded.nodeProcessCount -ne 40){throw 'bounded-candidates'}
Write-Output 'Process visibility fixtures PASS'
