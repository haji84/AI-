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
function Initialize-GoriqBridgeNative([string]$Source) {
 $null=Add-Type -TypeDefinition $Source -Language CSharp -ErrorAction Stop
}
function New-GoriqBridgeNativeInstance {
 return [GoriqBridgeCapture]::new($env:GITHUB_RUN_ID,$env:GITHUB_RUN_ATTEMPT)
}
function New-GoriqBridgeCapture([string]$Source,[ref]$InitializationFailure) {
 if($null -ne $InitializationFailure){$InitializationFailure.Value='NATIVE_BUILD_UNAVAILABLE'}
 Initialize-GoriqBridgeNative $Source
 if($null -ne $InitializationFailure){$InitializationFailure.Value='PRIVATE_STORAGE_UNAVAILABLE'}
 return New-GoriqBridgeNativeInstance
}
function Get-GoriqBridgeInitializationFailure([Exception]$Exception) {
 $allowed=@('PRIVATE_IDENTITY_UNAVAILABLE','PRIVATE_ENVIRONMENT_UNAVAILABLE','PRIVATE_ANCESTRY_UNAVAILABLE','PRIVATE_PARENT_UNAVAILABLE','PRIVATE_LAYOUT_UNAVAILABLE','PRIVATE_CONTEXT_UNAVAILABLE','PRIVATE_PATH_UNVERIFIED','PRIVATE_LOCAL_STORAGE_UNAVAILABLE','PRIVATE_NATIVE_OPEN_UNAVAILABLE','PRIVATE_FILE_METADATA_UNVERIFIED','PRIVATE_FINAL_PATH_UNVERIFIED','PRIVATE_OWNER_UNVERIFIED','PRIVATE_DACL_UNVERIFIED','PRIVATE_CREATE_UNAVAILABLE')
 $captureType='GoriqBridgeCapture' -as [type]
 if($null -eq $captureType){return 'PRIVATE_STORAGE_UNAVAILABLE'}
 $expected=$captureType.Assembly.GetType('GoriqBridgeInitializationException',$false,$false)
 if($null -eq $expected){return 'PRIVATE_STORAGE_UNAVAILABLE'}
 $phaseProperty=$expected.GetProperty('PhaseCode')
 $innerProperty=[Exception].GetProperty('InnerException')
 if($null -eq $phaseProperty -or $null -eq $innerProperty){return 'PRIVATE_STORAGE_UNAVAILABLE'}
 # Only the source-owned CLR exception can supply a constructor checkpoint.
 # CLR membership/getters ignore ETS-shadows of GetType, PhaseCode or InnerException.
 # Raw messages, Data, HResult and lookalike properties are never reflected.
 for($depth=0;$depth -lt 8 -and $null -ne $Exception;$depth++){
  if($Exception -is $expected){
   $code=$phaseProperty.GetValue($Exception,$null)
   if($code -is [string] -and $code -cin $allowed){return $code}
   return 'PRIVATE_STORAGE_UNAVAILABLE'
  }
  $Exception=$innerProperty.GetValue($Exception,$null)
 }
 return 'PRIVATE_STORAGE_UNAVAILABLE'
}
function Get-GoriqBridgeSourceFailure([Exception]$Exception) {
 $fallback='SOURCE_ACQUISITION_INCOMPLETE'
 $allowed=@('PRIVATE_PATH_UNVERIFIED','PRIVATE_LOCAL_STORAGE_UNAVAILABLE','PRIVATE_NATIVE_OPEN_UNAVAILABLE','PRIVATE_FILE_METADATA_UNVERIFIED','PRIVATE_FINAL_PATH_UNVERIFIED','PRIVATE_OWNER_UNVERIFIED','PRIVATE_DACL_UNVERIFIED','PRIVATE_CREATE_UNAVAILABLE')
 $captureType='GoriqBridgeCapture' -as [type]
 if($null -eq $captureType){return $fallback}
 $expected=$captureType.Assembly.GetType('GoriqBridgePrivateGuardException',$false,$false)
 if($null -eq $expected){return $fallback}
 $codeProperty=$expected.GetProperty('Code')
 $innerProperty=[Exception].GetProperty('InnerException')
 if($null -eq $codeProperty -or $null -eq $innerProperty){return $fallback}
 # Source-owned CLR membership and getters bypass ETS shadows. Never classify
 # source failures from raw messages, Data, HResult or lookalike exception types.
 for($depth=0;$depth -lt 8 -and $null -ne $Exception;$depth++){
  if($Exception -is $expected){
   $code=$codeProperty.GetValue($Exception,$null)
   if($code -is [string] -and $code -cin $allowed){return ('SOURCE_'+$code)}
   return $fallback
  }
  $Exception=$innerProperty.GetValue($Exception,$null)
 }
 return $fallback
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
  $failure='PRIVATE_STORAGE_UNAVAILABLE';$capture=New-GoriqBridgeCapture $NativeSource ([ref]$failure)
  $failure='SOURCE_ACQUISITION_INCOMPLETE';$capture.Acquire();if(-not $capture.Preserved){throw 'REFUSED'}
  $result.preserved=$true;$result.preservationMode='OBSERVED_STABLE_SHARED'
  $failure='INSTALLED_RUNTIME_UNAVAILABLE';$node=Get-GoriqBridgeNode $capture
  $capture.Stage('goriq-zbook-bridge-original-read.mjs',$QuerySource);$capture.Stage('goriq-g1-backup-inventory.mjs',$InventorySource)
  $failure='COPIED_QUERY_UNVERIFIED';$capture.PrepareOutputs();$raw=Invoke-GoriqBridgeCopiedQuery $capture $node
  $result=ConvertFrom-GoriqBridgeSummary $raw;$result.preserved=$true;$result.preservationMode='OBSERVED_STABLE_SHARED'
 }catch{
  if($failure -ceq 'PRIVATE_STORAGE_UNAVAILABLE'){$failure=Get-GoriqBridgeInitializationFailure $_.Exception}
  elseif($failure -ceq 'SOURCE_ACQUISITION_INCOMPLETE'){$failure=Get-GoriqBridgeSourceFailure $_.Exception}
  $result=New-GoriqBridgeSummary;$result.failureCode=$failure
  if($null -ne $capture){$result.preserved=[bool]$capture.Preserved;if($result.preserved){$result.preservationMode='OBSERVED_STABLE_SHARED'};try{$capture.WritePrivate('failure.txt',[Text.Encoding]::UTF8.GetBytes($_.ToString()))}catch{}}
 }finally{if($null -ne $capture){$capture.Dispose()}}
 return $result
}
if($Read) {
 $ErrorActionPreference='Stop';$WarningPreference='Stop'
 Invoke-GoriqBridgeRead $QuerySource $InventorySource $NativeSource | ConvertTo-Json -Depth 4 -Compress
}
