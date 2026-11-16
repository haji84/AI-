[CmdletBinding()]
param([switch]$Read,[byte[]]$QuerySource,[byte[]]$InventorySource,[string]$NativeSource)
# Definition-only import is inert. The action-free workflow passes pinned public
# source bytes in memory; no caller-provided source/path/SQL workflow inputs.
function New-GoriqBridgeSummary {
 [ordered]@{version=1;mode='FIXED_BRIDGE_COPIED_STATE';status='INCOMPLETE';failureCode='CONTEXT_INVALID';readOnly=$true;preserved=$false;preservationMode=$null;queryVerified=$false;currentGoalMatches=$null;jobMatches=$null;attemptCount=$null;transitionCount=$null;changeSetMatches=$null;workRunCount=$null;workRunPhase=$null;paused=$null;blockerCount=$null;approvalRecorded=$null;jobsPresent=$false;changesPresent=$false;historicalGoalRows=$null;historicalJobRows=$null;authorityComplete=$false;originalGoalRecovered=$false;g1='HOLD'}
}
function Get-GoriqBridgeNativeContext {
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSVersion.Major -ne 5 -or $ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage'){throw 'REFUSED'}
 $fixed=[IO.Path]::Combine([Environment]::GetFolderPath('System'),'WindowsPowerShell','v1.0','powershell.exe')
 if([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName -ine $fixed){throw 'REFUSED'}
 $signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $fixed -ErrorAction Stop
 if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|, )O=Microsoft Corporation(?:,|$)'){throw 'REFUSED'}
 return $true
}
function Assert-GoriqBridgeContext {
 if(-not (Get-GoriqBridgeNativeContext) -or $env:OS -cne 'Windows_NT' -or $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_NAME -cne 'ZBook' -or
  $env:GITHUB_REPOSITORY -cne 'haji84/AI-' -or $env:GITHUB_ACTOR -cne 'haji84' -or $env:GITHUB_REF -cne 'refs/heads/main' -or $env:GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
  $env:GITHUB_SHA -cnotmatch '^[a-f0-9]{40}\z' -or $env:GITHUB_RUN_ID -cnotmatch '^[1-9][0-9]{0,19}\z' -or $env:GITHUB_RUN_ATTEMPT -cnotmatch '^[1-9][0-9]{0,19}\z' -or
  $env:GORIQ_ZBOOK_BRIDGE_ORIGINAL_ONLY -cne 'true' -or $env:GORIQ_ZBOOK_NATIVE_ONLY -cne 'false' -or $env:GORIQ_ZBOOK_RUNNER_ONLY -cne 'false'){throw 'REFUSED'}
}
function New-GoriqBridgeCapture([string]$Source) {
 $null=Add-Type -TypeDefinition $Source -Language CSharp -ErrorAction Stop
 return [GoriqBridgeCapture]::new($env:GITHUB_RUN_ID,$env:GITHUB_RUN_ATTEMPT)
}
function Get-GoriqBridgeNode($Capture) {
 $node=$Capture.TrustedNode()
 $signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $node -ErrorAction Stop
 if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|, )O=(?:OpenJS Foundation|Node.js Foundation)(?:,|$)'){throw 'REFUSED'}
 $Capture.WritePrivate('runtime.txt',[Text.Encoding]::UTF8.GetBytes('path='+$node+"`n"+'signature='+$signature.Status+"`n"+'signer='+$signature.SignerCertificate.Subject))
 return $node
}
function Invoke-GoriqBridgeCopiedQuery($Capture,[string]$Node) {
 $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$Node;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.WorkingDirectory=$Capture.Root
 # No NODE_OPTIONS/NODE_PATH, inherited tokens or startup hooks in the child.
 $start.EnvironmentVariables.Clear();$start.EnvironmentVariables['SystemRoot']=[Environment]::GetFolderPath('Windows')
 $start.Arguments='"'+[IO.Path]::Combine($Capture.Root,'goriq-zbook-bridge-original-read.mjs')+'" "'+$Capture.Root+'"'
 $child=[Diagnostics.Process]::new();$child.StartInfo=$start
 try {
  $Capture.VerifyRuntime()
  if(-not $child.Start()){throw 'REFUSED'}
  $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
  if(-not $child.WaitForExit(40000)){$child.Kill();$child.WaitForExit();throw 'REFUSED'}
  $out=$stdout.GetAwaiter().GetResult();$err=$stderr.GetAwaiter().GetResult()
  $Capture.WritePrivate('query-stdout.txt',[Text.Encoding]::UTF8.GetBytes($out));$Capture.WritePrivate('query-stderr.txt',[Text.Encoding]::UTF8.GetBytes($err))
  if($child.ExitCode -ne 0 -or $out.Length -gt 16384){throw 'REFUSED'}
  return $out
 }finally{$child.Dispose()}
}
function ConvertFrom-GoriqBridgeSummary([string]$Text,[bool]$PreservedExpected=$false) {
 if($Text.Length -gt 16384){throw 'REFUSED'}
 $report=ConvertFrom-Json -InputObject $Text -ErrorAction Stop;$template=New-GoriqBridgeSummary;$template.preserved=$PreservedExpected;if($PreservedExpected){$template.preservationMode='OBSERVED_STABLE_SHARED'}
 if($null -eq $report -or $report -isnot [pscustomobject] -or @($report.PSObject.Properties).Count -ne $template.Count){throw 'REFUSED'}
 foreach($key in $template.Keys){if($report.PSObject.Properties.Name -cnotcontains $key){throw 'REFUSED'}}
 foreach($key in @('version','mode','readOnly','preserved','preservationMode','authorityComplete','originalGoalRecovered','g1')){if($report.$key -cne $template[$key]){throw 'REFUSED'}}
 if(($report.version -isnot [int] -and $report.version -isnot [long]) -or $report.mode -isnot [string] -or $report.g1 -isnot [string]){throw 'REFUSED'}
 foreach($key in @('readOnly','preserved','authorityComplete','originalGoalRecovered')){if($report.$key -isnot [bool]){throw 'REFUSED'}}
 foreach($key in @('queryVerified','jobsPresent','changesPresent')){if($report.$key -isnot [bool]){throw 'REFUSED'}}
 foreach($key in @('currentGoalMatches','paused','approvalRecorded')){if($null -ne $report.$key -and $report.$key -isnot [bool]){throw 'REFUSED'}}
 foreach($key in @('jobMatches','attemptCount','transitionCount','changeSetMatches','workRunCount','blockerCount','historicalGoalRows','historicalJobRows')){
  if($null -ne $report.$key -and (($report.$key -isnot [int] -and $report.$key -isnot [long]) -or $report.$key -lt 0 -or $report.$key -gt 10000)){throw 'REFUSED'}
 }
 if($null -ne $report.workRunPhase -and $report.workRunPhase -cnotin @('QUEUED','PLANNING','RUNNING','IMPLEMENTING','WAITING_FOR_CONNECTIVITY','WAITING_FOR_RESOURCE','VERIFYING','RECOVERING','READY_TO_PUBLISH','PUBLISHING','HUMAN_GATE','BLOCKED','COMPLETED','CANCELLED','FAILED')){throw 'REFUSED'}
 if(($report.status -ceq 'COPIED_STATE_READ' -and ($report.failureCode -cne 'NONE' -or -not $report.queryVerified)) -or
  ($report.status -ceq 'INCOMPLETE' -and ($report.failureCode -cne 'COPIED_QUERY_INVALID' -or $report.queryVerified)) -or $report.status -cnotin @('COPIED_STATE_READ','INCOMPLETE')){throw 'REFUSED'}
 $clean=[ordered]@{};foreach($key in $template.Keys){$clean[$key]=$report.$key};return $clean
}
function Invoke-GoriqBridgeRead([byte[]]$QuerySource,[byte[]]$InventorySource,[string]$NativeSource) {
 $result=New-GoriqBridgeSummary;$capture=$null;$failure='CONTEXT_INVALID'
 try {
  Assert-GoriqBridgeContext
  $failure='PRIVATE_STORAGE_UNAVAILABLE';$capture=New-GoriqBridgeCapture $NativeSource
  $failure='SOURCE_ACQUISITION_INCOMPLETE';$capture.Acquire();if(-not $capture.Preserved){throw 'REFUSED'}
  $result.preserved=$true;$result.preservationMode='OBSERVED_STABLE_SHARED'
  $failure='INSTALLED_RUNTIME_UNAVAILABLE';$node=Get-GoriqBridgeNode $capture
  $capture.Stage('goriq-zbook-bridge-original-read.mjs',$QuerySource);$capture.Stage('goriq-g1-backup-inventory.mjs',$InventorySource)
  $failure='COPIED_QUERY_UNVERIFIED';$capture.PrepareOutputs();$raw=Invoke-GoriqBridgeCopiedQuery $capture $node
  $result=ConvertFrom-GoriqBridgeSummary $raw;$result.preserved=$true;$result.preservationMode='OBSERVED_STABLE_SHARED'
 }catch{
  $result=New-GoriqBridgeSummary;$result.failureCode=$failure
  if($null -ne $capture){$result.preserved=[bool]$capture.Preserved;if($result.preserved){$result.preservationMode='OBSERVED_STABLE_SHARED'};try{$capture.WritePrivate('failure.txt',[Text.Encoding]::UTF8.GetBytes($_.ToString()))}catch{}}
 }finally{if($null -ne $capture){$capture.Dispose()}}
 return $result
}
if($Read) {
 $ErrorActionPreference='Stop';$WarningPreference='Stop'
 Invoke-GoriqBridgeRead $QuerySource $InventorySource $NativeSource | ConvertTo-Json -Depth 4 -Compress
}
