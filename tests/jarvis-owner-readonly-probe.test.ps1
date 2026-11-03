Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Removing the watchdog must make a stalled real child outlive its deadline;
# selecting a PID instead of the owned Process handle must risk the control child.
$source=Join-Path $PSScriptRoot '..\scripts\goriq-zbook-owner-readonly-probe.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'probe-parse'}
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-ProbeChild'},$true)
if($null -eq $definition){throw 'Missing external watchdog: a blocked call can exceed the diagnostic deadline'}
Invoke-Expression $definition.Extent.Text
$publicDefinition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ConvertTo-ProbePublicJson'},$true)
if($null -ne $publicDefinition){Invoke-Expression $publicDefinition.Extent.Text}
$valid='{"version":1,"issue":1662,"nodeId":"zbook","readOnly":true,"observedAt":"2026-10-01T17:00:00Z","goalIssue":1219,"administratorRoleActive":true,"sourceRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","previousRevision":"ff761733c66f60a49e8c25c5ab0450a7a5e679c5","exactMainCi":true,"taskOwnerMatches":true,"candidatesTruncated":false,"listenerPortCount":4,"serviceNodeCandidates":[{"instanceStable":true,"ownerClass":"current-user","ownerQueryClass":"success","commandLineAvailable":true,"configuredRootExact":true,"configuredRootIgnoreCase":true,"hostEntrypointObserved":false,"directListenerPortCount":1}]}'
if($null -ne $publicDefinition){
  $accepted=ConvertTo-ProbePublicJson $valid | ConvertFrom-Json
  if($accepted.listenerPortCount -ne 4 -or $accepted.serviceNodeCandidates.Count -ne 1){throw 'public-success-schema'}
  foreach($invalid in @(
    $valid.Replace('"directListenerPortCount":1','"directListenerPortCount":1,"rawCommand":"SECRET_SENTINEL"'),
    $valid.Replace('"listenerPortCount":4','"listenerPortCount":"4"'),
    $valid.Replace('"version":1','"version":1.5'))){
    $denied=$false
    try {$null=ConvertTo-ProbePublicJson $invalid}catch{if($_.Exception.Message -ne 'DIAGNOSTIC_OUTPUT_REJECTED'){throw};$denied=$true}
    if(-not $denied){throw 'unsafe-schema-or-type-accepted'}
  }
}
function Fixture-StartInfo([string]$code) {
  $info=New-Object Diagnostics.ProcessStartInfo
  $executable=if($env:OS -eq 'Windows_NT'){'powershell.exe'}else{'pwsh'}
  $info.FileName=Join-Path $PSHOME $executable
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
  $info.Arguments='-NoProfile -EncodedCommand '+$encoded
  $info.UseShellExecute=$false; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  return $info
}
$control=New-Object Diagnostics.Process
$control.StartInfo=Fixture-StartInfo 'Start-Sleep -Seconds 60'
$controlStarted=$false
try {
  $controlStarted=$control.Start()
  if(-not $controlStarted){throw 'control-start'}
  $clock=[Diagnostics.Stopwatch]::StartNew()
  $receipt=Invoke-ProbeChild (Fixture-StartInfo 'Write-Output "PROBE_STAGE=task"; Start-Sleep -Seconds 60') ([datetimeoffset]::UtcNow.AddSeconds(2))
  if(-not $receipt.TimedOut -or -not $receipt.ChildStopped -or $receipt.FailedStage -ne 'task'){throw 'stall-not-bounded-or-stage-lost'}
  if($clock.Elapsed.TotalSeconds -gt 6){throw 'watchdog-return-too-late'}
  if($control.HasExited){throw 'unrelated-process-stopped'}
  $ok=Invoke-ProbeChild (Fixture-StartInfo 'Write-Output ''{"version":1,"issue":1662,"nodeId":"zbook","readOnly":true,"failedStage":"task","failureReason":"TASK_BOUNDARY_REJECTED","observedAt":"2026-10-01T17:00:00Z"}''; exit 1') ([datetimeoffset]::UtcNow.AddSeconds(5))
  if($ok.TimedOut -or $ok.ExitCode -ne 1 -or ($ok.Json | ConvertFrom-Json).failureReason -ne 'TASK_BOUNDARY_REJECTED'){throw 'valid-receipt-lost'}
  $silent=Invoke-ProbeChild (Fixture-StartInfo 'exit 0') ([datetimeoffset]::UtcNow.AddSeconds(5))
  if($silent.FailureReason -ne 'PROBE_RECEIPT_MISSING'){throw 'silent-success-must-not-pass'}
  $noisy=Invoke-ProbeChild (Fixture-StartInfo 'Write-Output "SECRET_SENTINEL"; [Console]::Error.WriteLine("SECRET_SENTINEL"); exit 1') ([datetimeoffset]::UtcNow.AddSeconds(5))
  if(($noisy | ConvertTo-Json -Compress).Contains('SECRET_SENTINEL')){throw 'private-child-output-leaked'}
  $rejected=$false
  try {
    $null=Invoke-ProbeChild (Fixture-StartInfo 'Write-Output ''{"version":1,"issue":1662,"readOnly":true,"secret":"SECRET_SENTINEL"}''') ([datetimeoffset]::UtcNow.AddSeconds(5))
  }catch{if($_.Exception.Message -ne 'DIAGNOSTIC_OUTPUT_REJECTED'){throw};$rejected=$true}
  if(-not $rejected){throw 'JSON-shaped private output must be rejected'}
  $rejected=$false
  try {
    $null=Invoke-ProbeChild (Fixture-StartInfo '[Console]::Out.Write(("x"*32768)); Start-Sleep -Seconds 60') ([datetimeoffset]::UtcNow.AddSeconds(3))
  }catch{if($_.Exception.Message -ne 'DIAGNOSTIC_OUTPUT_REJECTED'){throw};$rejected=$true}
  if(-not $rejected){throw 'Unterminated output must be bounded before newline or deadline'}
  $expired=Invoke-ProbeChild (Fixture-StartInfo 'Start-Sleep -Seconds 60') ([datetimeoffset]::UtcNow.AddSeconds(-1))
  if(-not $expired.TimedOut -or -not $expired.ChildStopped){throw 'expired-deadline-started-child'}
} finally {
  if($controlStarted -and -not $control.HasExited){$control.Kill(); $null=$control.WaitForExit(2000)}
  $control.Dispose()
}
Write-Output 'Read-only probe watchdog fixtures PASS (controlled children, not Windows acceptance)'
