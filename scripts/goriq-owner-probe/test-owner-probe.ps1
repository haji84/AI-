Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$checks=0
function Assert-Case([string]$Name,[bool]$Condition) {
  if(-not $Condition){throw ('TEST_FAILED:'+ $Name)}
  $script:checks++
  Write-Output ('PASS '+$Name)
}
$source=Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs'
Assert-Case 'standalone_source_exists' ([IO.File]::Exists($source))
if($PSVersionTable.PSVersion.Major -eq 5) {
  # WindowsPS5 uses the installed .NET Framework C#5 CodeDOM compiler and has
  # no Add-Type -CompilerOptions parameter. Exercise that real native path.
  $null=Add-Type -TypeDefinition ([IO.File]::ReadAllText($source)) -Language CSharp -ErrorAction Stop
}else{
  $null=Add-Type -TypeDefinition ([IO.File]::ReadAllText($source)) -Language CSharp -CompilerOptions '/langversion:5' -ErrorAction Stop
}
Assert-Case 'csharp5_compile' ($null -ne ('GoriqPrivateOwnerProbe' -as [type]))
foreach($path in @('C:\Users\Owner','d:\','D:\Profiles\Alice\.goriq-handoff')) {
  Assert-Case ('canonical_good_'+$checks) ([GoriqPrivateOwnerProbe]::CanonicalLocalPath($path))
}
foreach($path in @($null,'','C:relative','\\server\share','\\?\C:\Users\Owner','C:\A\..\B','C:\A\','C:\A.','C:\A ','C:\NUL.txt','C:\COM1','C:\A:stream','C:/A',('C:\A'+[char]1+'B'),('C:\'+('a'*238)))) {
  Assert-Case ('canonical_refuses_'+$checks) (-not [GoriqPrivateOwnerProbe]::CanonicalLocalPath($path))
}
Assert-Case 'context_normal' ([GoriqPrivateOwnerProbe]::ProfileContextSafe('C:\Users\Owner','C:\Users\Owner','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local','D:\actions\repo'))
foreach($args in @(
  @('C:\Users\Owner','C:\Users\Other','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local','D:\actions\repo'),
  @('C:\','C:\','C:\Local','C:\Local','D:\actions\repo'),
  @('C:\Users\Owner','C:\Users\Owner','D:\Local','D:\Local','D:\actions\repo'),
  @('C:\Users\Owner','C:\Users\Owner','C:\Users\Owner\AppData\Local','C:\Users\Owner\Other','D:\actions\repo'),
  @('C:\Users\Owner','C:\Users\Owner','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local','C:\Users\Owner'),
  @('C:\Users\Owner','C:\Users\Owner','C:\Users\Owner\.goriq-handoff','C:\Users\Owner\.goriq-handoff','D:\actions\repo'),
  @('C:\Users\Owner','C:\Users\Owner','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local\GAIWorker\goal-1218-bridge-state'),
  @('C:\Users\Owner','C:\Users\Owner','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local\GAIWorker\goal-1218-bridge-state\child'),
  @('C:\Users\Owner','C:\Users\Owner','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local','C:\Users\Owner\AppData\Local\GAIWorker'),
  @('C:\a\b\c\d\e\f\g\h\i','C:\a\b\c\d\e\f\g\h\i','C:\a\b\c\d\e\f\g\h\i\Local','C:\a\b\c\d\e\f\g\h\i\Local','D:\actions\repo')
)) {
  Assert-Case ('unsafe_context_refuses_'+$checks) (-not [GoriqPrivateOwnerProbe]::ProfileContextSafe($args[0],$args[1],$args[2],$args[3],$args[4]))
}
$plan=[GoriqPrivateOwnerProbe]::FixedTargets('C:\Users\Owner')
Assert-Case 'fixed_plan_count' ($plan.Count -eq 8)
Assert-Case 'fixed_plan_first' ($plan[0].Target.ToString() -ceq 'VOLUME_ROOT' -and $plan[0].Path -ceq 'C:\')
Assert-Case 'fixed_plan_profile_private' ($plan[2].Target.ToString() -ceq 'PROFILE' -and $plan[2].Private)
Assert-Case 'fixed_plan_raw' ($plan[5].Path -ceq 'C:\Users\Owner\.goriq-handoff\1219-original-inspection-43843790970-1\raw')
Assert-Case 'fixed_plan_context_metadata' ($plan[7].Target.ToString() -ceq 'CONTEXT' -and -not $plan[7].Directory)
Assert-Case 'target_cap_includes_identity_environment' (([GoriqPrivateOwnerProbe]::FixedTargets('C:\a\b\c\d\e\f\g\h').Count+2) -eq 16)
Assert-Case 'too_deep_plan_refuses' ([GoriqPrivateOwnerProbe]::FixedTargets('C:\a\b\c\d\e\f\g\h\i').Count -eq 0)
function New-Ace($Account,$Qualifier='ALLOW',[bool]$Qualified=$true,[bool]$Callback=$false,[bool]$InheritOnly=$false) {
  $ace=New-Object OwnerProbeAce
  $ace.Account=[OwnerProbeAccount]$Account;$ace.Qualifier=[OwnerProbeQualifier]$Qualifier
  $ace.Qualified=$Qualified;$ace.Callback=$Callback;$ace.InheritOnly=$InheritOnly
  return $ace
}
foreach($account in @('CURRENT_USER','SYSTEM','ADMINISTRATORS','TRUSTED_INSTALLER')) {
  $aces=[OwnerProbeAce[]]@((New-Ace $account))
  Assert-Case ('private_trusted_'+$account) ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,$aces).ToString() -ceq 'OBSERVED_POLICY_MATCH')
}
Assert-Case 'foreign_owner_precedes_dacl' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$false,$true,[OwnerProbeAce[]]@((New-Ace 'OTHER'))).ToString() -ceq 'PRIVATE_OWNER_UNVERIFIED')
Assert-Case 'missing_descriptor_owner' ([GoriqPrivateOwnerProbe]::ReduceSecurity($false,$true,$true,$true,[OwnerProbeAce[]]@()).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
Assert-Case 'absent_dacl' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$false,$true,$true,[OwnerProbeAce[]]@()).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
Assert-Case 'untrusted_allow_even_zero_mask' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,[OwnerProbeAce[]]@((New-Ace 'OTHER'))).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
Assert-Case 'denial_does_not_grant' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,[OwnerProbeAce[]]@((New-Ace 'OTHER' 'DENY'))).ToString() -ceq 'OBSERVED_POLICY_MATCH')
Assert-Case 'callback_refused' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,[OwnerProbeAce[]]@((New-Ace 'CURRENT_USER' 'ALLOW' $true $true))).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
Assert-Case 'unknown_ace_refused' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,[OwnerProbeAce[]]@((New-Ace 'CURRENT_USER' 'ALLOW' $false))).ToString() -ceq 'PRIVATE_DACL_UNVERIFIED')
Assert-Case 'inherit_only_skipped_first' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$true,$true,[OwnerProbeAce[]]@((New-Ace 'OTHER' 'ALLOW' $false $true $true))).ToString() -ceq 'OBSERVED_POLICY_MATCH')
Assert-Case 'ancestor_metadata_policy' ([GoriqPrivateOwnerProbe]::ReduceSecurity($true,$true,$false,$false,[OwnerProbeAce[]]@((New-Ace 'OTHER'))).ToString() -ceq 'OBSERVED_POLICY_MATCH')
$report=New-Object OwnerProbeReport
$report.AllFixedTargetsObserved=$true
$json=[GoriqPrivateOwnerProbe]::Render($report)
$public=$json | ConvertFrom-Json
Assert-Case 'report_remains_incomplete' ($public.status -ceq 'INCOMPLETE' -and $public.authority -ceq 'NOT_AUTHORITATIVE' -and -not $public.recovered -and $public.g1 -ceq 'HOLD' -and -not $public.historicalStateProven)
Assert-Case 'report_closed_keys' ((@($public.PSObject.Properties.Name) -join ',') -ceq 'schema,authority,status,readOnly,metadataOnly,recovered,g1,historicalStateProven,allFixedTargetsObserved,target,reason,observations')
$report.Reason=[Enum]::ToObject([OwnerProbeReason],999)
$rejected=[GoriqPrivateOwnerProbe]::Render($report) | ConvertFrom-Json
Assert-Case 'invalid_enum_never_serialized' ($rejected.reason -ceq 'OUTPUT_REJECTED' -and -not $rejected.allFixedTargetsObserved -and $rejected.observations.Count -eq 0)
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  $unsupported=[GoriqPrivateOwnerProbe]::ObserveJson() | ConvertFrom-Json
  Assert-Case 'native_refuses_unsupported_before_identity' ($unsupported.reason -ceq 'UNSUPPORTED_PLATFORM' -and $unsupported.target -ceq 'NONE' -and $unsupported.observations.Count -eq 0)
}
$launcher=Join-Path $PSScriptRoot 'observe-private-owner.ps1'
$loaded=@(. $launcher)
Assert-Case 'launcher_definition_load_inert' ($loaded.Count -eq 0)
$clean=ConvertTo-OwnerProbeClosedJson (New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM')
Assert-Case 'supervisor_reconstructs_closed_report' (($clean | ConvertFrom-Json).reason -ceq 'UNSUPPORTED_PLATFORM')
foreach($bad in @(
  $json.Replace('"OWNER_PROBE_V1"','"C:\\Users\\LEAK"'),
  $json.Replace('"recovered":false','"recovered":true'),
  $json.Replace('"readOnly":true','"readOnly":"true"'),
  $json.Replace('"observations":[]','"observations":[],"extra":"S-1-5-21-LEAK"'),
  $json.Replace('"reason":"NOT_STARTED"','"reason":"arbitrary exception text"')
)) {
  $rejected=$false
  try {$null=ConvertTo-OwnerProbeClosedJson $bad}catch{$rejected=$true}
  Assert-Case ('supervisor_rejects_unclosed_'+$checks) $rejected
}
$safeFailure=New-OwnerProbeFailure 'S-1-5-21-LEAK'
Assert-Case 'supervisor_failure_reason_closed' (($safeFailure | ConvertFrom-Json).reason -ceq 'OUTPUT_REJECTED' -and $safeFailure -notmatch 'LEAK')
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
  $unsupported=Invoke-OwnerProbeObservation | ConvertFrom-Json
  Assert-Case 'supervisor_refuses_unsupported_before_child' ($unsupported.reason -ceq 'UNSUPPORTED_PLATFORM' -and $unsupported.observations.Count -eq 0)
}
Assert-Case 'compiler_preflight_guard_exists' ($null -ne (Get-Command Get-OwnerProbeCompilerAncestors -ErrorAction SilentlyContinue))
$ancestors=@(Get-OwnerProbeCompilerAncestors 'D:\actions\repo')
Assert-Case 'compiler_preflight_root_to_workspace' (($ancestors -join '|') -ceq 'D:\|D:\actions|D:\actions\repo')
Assert-Case 'compiler_preflight_refuses_namespace' (@(Get-OwnerProbeCompilerAncestors '\\?\D:\actions\repo').Count -eq 0)
Assert-Case 'compiler_preflight_refuses_excess_depth' (@(Get-OwnerProbeCompilerAncestors ('D:\'+(('a\'*16)+'repo'))).Count -eq 0)
Assert-Case 'compiler_metadata_ordinary_directory' (Test-OwnerProbeCompilerMetadata 'D:\actions' 'd:\actions' ([IO.FileAttributes]::Directory) $true 'Fixed' 'NTFS')
Assert-Case 'compiler_metadata_refuses_reparse' (-not (Test-OwnerProbeCompilerMetadata 'D:\actions' 'D:\actions' ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint) $true 'Fixed' 'NTFS'))
Assert-Case 'compiler_metadata_refuses_alias' (-not (Test-OwnerProbeCompilerMetadata 'D:\actions' 'C:\Users\Owner\.goriq-handoff' ([IO.FileAttributes]::Directory) $true 'Fixed' 'NTFS'))
Assert-Case 'compiler_metadata_refuses_file' (-not (Test-OwnerProbeCompilerMetadata 'D:\actions' 'D:\actions' ([IO.FileAttributes]::Normal) $true 'Fixed' 'NTFS'))
Assert-Case 'compiler_metadata_refuses_nonfixed' (-not (Test-OwnerProbeCompilerMetadata 'D:\actions' 'D:\actions' ([IO.FileAttributes]::Directory) $true 'Network' 'NTFS'))
Assert-Case 'compiler_metadata_refuses_nonntfs' (-not (Test-OwnerProbeCompilerMetadata 'D:\actions' 'D:\actions' ([IO.FileAttributes]::Directory) $true 'Fixed' 'FAT32'))
Assert-Case 'compiler_metadata_refuses_unready' (-not (Test-OwnerProbeCompilerMetadata 'D:\actions' 'D:\actions' ([IO.FileAttributes]::Directory) $false 'Fixed' 'NTFS'))
# Reports must identify the actual final observed target, never a contradictory
# summary or a claimed complete observation that skipped required targets.
$facts=@()
foreach($name in @('IDENTITY','PROFILE_ENVIRONMENT','VOLUME_ROOT','ANCESTOR_01','PROFILE','HANDOFF','LAYOUT','RAW','WORK','CONTEXT')) {
  $native=$name -notin @('IDENTITY','PROFILE_ENVIRONMENT')
  $private=$name -in @('PROFILE','HANDOFF','LAYOUT','RAW','WORK','CONTEXT')
  $facts+=@{target=$name;reason='OBSERVED_POLICY_MATCH';storageVerified=$native;attributesVerified=$native;finalPathVerified=$native;owner=$(if(-not $native){'UNOBSERVED'}elseif($private){'CURRENT_USER'}else{'OTHER'});dacl=$(if(-not $native){'UNOBSERVED'}elseif($private){'PRIVATE_POLICY_MATCH'}else{'ANCESTOR_METADATA_ONLY'})}
}
$complete=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'|ConvertFrom-Json
$complete.target='CONTEXT';$complete.reason='OBSERVED_POLICY_MATCH';$complete.allFixedTargetsObserved=$true;$complete.observations=$facts
$completeWire=$complete|ConvertTo-Json -Depth 5 -Compress
Assert-Case 'complete_observation_roundtrip' ((ConvertTo-OwnerProbeClosedJson $completeWire|ConvertFrom-Json).allFixedTargetsObserved)
$wrong=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'|ConvertFrom-Json
$wrong.target='HANDOFF';$wrong.reason='PRIVATE_OWNER_UNVERIFIED'
$wrong.observations=@($facts[0],$facts[1],$facts[2],$facts[3],@{target='PROFILE';reason='PRIVATE_DACL_UNVERIFIED';storageVerified=$true;attributesVerified=$true;finalPathVerified=$true;owner='CURRENT_USER';dacl='UNVERIFIED'})
$wrongSummary=$wrong|ConvertTo-Json -Depth 5 -Compress
$skipped=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'|ConvertFrom-Json
$skipped.target='CONTEXT';$skipped.reason='OBSERVED_POLICY_MATCH';$skipped.allFixedTargetsObserved=$true
$skipped.observations=@($facts[0],$facts[1],$facts[2])
foreach($n in 1..6){$skipped.observations+=@{target=('ANCESTOR_0'+$n);reason='OBSERVED_POLICY_MATCH';storageVerified=$false;attributesVerified=$false;finalPathVerified=$false;owner='UNOBSERVED';dacl='UNOBSERVED'}}
foreach($bad in @($wrongSummary,($skipped|ConvertTo-Json -Depth 5 -Compress))) {
  $refused=$false;try{$null=ConvertTo-OwnerProbeClosedJson $bad}catch{$refused=$true}
  Assert-Case ('contradictory_or_skipped_report_refused_'+$checks) $refused
}
foreach($reason in @('CHILD_START_UNAVAILABLE','CHILD_STOP_UNCONFIRMED')) {
  Assert-Case ('supervisor_roundtrip_'+$reason) ((ConvertTo-OwnerProbeClosedJson (New-OwnerProbeFailure $reason)|ConvertFrom-Json).reason -ceq $reason)
}
# Real pending tasks must be drained within the supplied remaining budget.
$pending=[Threading.Tasks.Task]::Delay(30)
Assert-Case 'pending_output_is_drained' (Wait-OwnerProbeOutput -Tasks ([Threading.Tasks.Task[]]@($pending)) -RemainingMilliseconds 1000)
Assert-Case 'drained_output_is_complete' $pending.IsCompleted
$blocked=New-Object 'Threading.Tasks.TaskCompletionSource[bool]'
Assert-Case 'unclosed_output_pipe_is_bounded' (-not (Wait-OwnerProbeOutput -Tasks ([Threading.Tasks.Task[]]@($blocked.Task)) -RemainingMilliseconds 1))
$blocked.SetResult($true)
# A one-record source transfer must close its writer after completion. Windows
# PowerShell's redirected-input host can keep running while that pipe is open.
Assert-Case 'source_transfer_function_exists' ($null -ne (Get-Command Send-OwnerProbeSource -ErrorAction SilentlyContinue))
$child=$null
try {
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  $reader='if([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())) -ceq "fixed-inert-source"){[Console]::Out.WriteLine("OWNER_SOURCE_EOF")}else{exit 1}'
  $info.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($reader))
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $child=New-Object Diagnostics.Process;$child.StartInfo=$info;$null=$child.Start()
  $output=$child.StandardOutput.ReadToEndAsync();$errors=$child.StandardError.ReadToEndAsync()
  $clock=[Diagnostics.Stopwatch]::StartNew()
  Assert-Case 'source_writer_finishes_and_closes' (Send-OwnerProbeSource -Child $child -NativeSource 'fixed-inert-source' -Clock $clock)
  Assert-Case 'source_reader_observes_eof' ($child.WaitForExit(3000))
  Assert-Case 'source_output_is_drained' (Wait-OwnerProbeOutput -Tasks ([Threading.Tasks.Task[]]@($output,$errors)) -RemainingMilliseconds 1000)
  Assert-Case 'source_roundtrip_exact' ($child.ExitCode -eq 0 -and $output.GetAwaiter().GetResult().Trim() -ceq 'OWNER_SOURCE_EOF' -and $errors.GetAwaiter().GetResult().Length -eq 0)
}finally{if($null -ne $child){if(-not $child.HasExited){$child.Kill();$null=$child.WaitForExit(2000)};$child.Dispose()}}
# Actual WindowsPS5 child supervision with inert C# only; no native private
# observer is invoked by these fixtures. Guard binding before any child call.
if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
  Assert-Case 'supervisor_has_in_memory_source_binding' ((Get-Command Invoke-OwnerProbeObservation).Parameters.ContainsKey('NativeSource'))
  $wire=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'
  $literal=$wire.Replace('"','""')
  $inert='public static class GoriqPrivateOwnerProbe { public static string ObserveJson() { return @"'+$literal+'"; } }'
  $result=Invoke-OwnerProbeObservation -NativeSource $inert | ConvertFrom-Json
  if($result.reason -cne 'UNSUPPORTED_PLATFORM'){
    # Failure-only instrumentation on this inert fixture, never on the real
    # observer. Fixed markers distinguish native startup/signature/workspace/
    # source-input/compiler boundaries without raw paths or exception output.
    $definition=(Get-Command Invoke-OwnerProbeObservation).Definition
    foreach($pair in @(
      @(' $signature=Microsoft.PowerShell.Security',' [Console]::Out.WriteLine("INERT_SIGNATURE_START");$signature=Microsoft.PowerShell.Security'),
      @(' try {$workspaceReady=Test-OwnerProbeCompilerWorkspace',' [Console]::Out.WriteLine("INERT_WORKSPACE_START");try {$workspaceReady=Test-OwnerProbeCompilerWorkspace'),
      @(' $encoded=[Console]::In.ReadLine()',' [Console]::Out.WriteLine("INERT_INPUT_START");$encoded=[Console]::In.ReadLine();[Console]::Out.WriteLine("INERT_INPUT_FINISHED")'),
      @(' $null=Add-Type -TypeDefinition $source',' [Console]::Out.WriteLine("INERT_BUILD_START");$null=Add-Type -TypeDefinition $source'),
      @(' [Console]::Out.WriteLine([GoriqPrivateOwnerProbe]',' [Console]::Out.WriteLine("INERT_BUILD_FINISHED");[Console]::Out.WriteLine([GoriqPrivateOwnerProbe]')
    )){$definition=$definition.Replace($pair[0],$pair[1])}
    $definition=$definition.Replace('$child.WaitForExit($remaining)','$child.WaitForExit([Math]::Min(3000,$remaining))')
    $definition=$definition.Replace('$child.Kill()','$child.Kill();$null=$child.WaitForExit(2000);if($stdout.IsCompleted){[Console]::Out.WriteLine($stdout.GetAwaiter().GetResult())}')
    $definition=$definition.Replace('if($child.ExitCode -ne 0)','[Console]::Out.WriteLine("INERT_CHILD_EXIT "+$child.ExitCode);if($child.ExitCode -ne 0)')
    $definition=$definition.Replace('if($errorText.Length -ne 0)','[Console]::Out.WriteLine("INERT_CHILD_STDOUT "+$text);[Console]::Out.WriteLine("INERT_STDERR_NONEMPTY "+[bool]$errorText.Length+" CLIXML "+$errorText.Contains("#< CLIXML")+" MODULE_PROGRESS "+$errorText.Contains("Preparing modules for first use"));if($errorText.Length -ne 0)')
    $definition=$definition.Replace('return ConvertTo-OwnerProbeClosedJson $text','[Console]::Out.WriteLine("INERT_CHILD_STDOUT "+$text);return ConvertTo-OwnerProbeClosedJson $text')
    . ([ScriptBlock]::Create('function Invoke-OwnerProbeInertTrace {'+$definition+'}'))
    $trace=Invoke-OwnerProbeInertTrace -NativeSource $inert
    Write-Output ('INERT_SUPERVISOR_REASON '+$result.reason)
    Write-Output ('INERT_TRACE_RESULT '+$trace)
  }
  Assert-Case ('native_ps5_child_compiles_supplied_source_'+$result.reason) ($result.reason -ceq 'UNSUPPORTED_PLATFORM' -and $result.observations.Count -eq 0)
  $invalid=Invoke-OwnerProbeObservation -NativeSource 'deliberately invalid PRIVATE C#' | ConvertFrom-Json
  Assert-Case 'native_ps5_child_build_failure_closed' ($invalid.reason -ceq 'NATIVE_BUILD_UNAVAILABLE')
  $extra=$inert.Replace('return @"','System.Console.WriteLine("PRIVATE_SID_PATH"); return @"')
  $rejected=Invoke-OwnerProbeObservation -NativeSource $extra
  Assert-Case 'native_ps5_child_extra_output_discarded' (($rejected|ConvertFrom-Json).reason -ceq 'OUTPUT_REJECTED' -and $rejected -notmatch 'PRIVATE_SID_PATH')
}
Write-Output ('TOTAL_PASS='+$checks)
