param([string]$Scenario)
$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-task-credential-retention-proof-1218.ps1'
. $source
function Require([bool]$Value,[string]$Code){if(-not $Value){throw ('DIAGNOSTIC_REGRESSION_'+$Code)}}
function New-TestDiagnostics {return [ordered]@{version=1;forwardFailure=$null;cleanupFailure=$null;cleanupFailedComponents=@();profileCleanupState='NOT_CHECKED'}}
function New-TestBudget {
 $clock=@{utc=[datetimeoffset]::Parse('2026-11-06T00:00:00Z');mono=[double]0}
 $b=New-R05ProofBudget -ScopeExpiry $clock.utc.AddHours(1) -JobDeadline $clock.utc.AddSeconds(660) -UtcClock {$clock.utc}.GetNewClosure() -MonoClock {$clock.mono}.GetNewClosure()
 # On baseline, attach inert expected state without replacing any executor code.
 # The real old API/budget/cleanup path runs and then fails the evidence assertion.
 if(-not $b.PSObject.Properties['Diagnostics']){$b|Add-Member NoteProperty Diagnostics (New-TestDiagnostics)}else{$b.Diagnostics=New-TestDiagnostics}
 if(-not $b.PSObject.Properties['DiagnosticComponent']){$b|Add-Member NoteProperty DiagnosticComponent 'NONE'}
 return @{budget=$b;clock=$clock}
}
function Advance($Clock,[double]$Seconds){$Clock.utc=$Clock.utc.AddSeconds($Seconds);$Clock.mono+=$Seconds}
function Protected($B,[string]$Phase,[scriptblock]$Action,[string]$Operation='OTHER',[string]$Component='FORWARD'){
 $args=@{Budget=$B;Phase=$Phase;Action=$Action}
 if((Get-Command Invoke-R05ProtectedApi).Parameters.ContainsKey('Operation')){$args.Operation=$Operation;$args.Component=$Component}
 Invoke-R05ProtectedApi @args
}
$privateMarker='PRIVATE_DIAGNOSTIC_CANARY_C:\PRIVATE\S-1-5-21-111-222-333-444_PASSWORD'
if($Scenario -eq 'schema'){
 $r=New-R05FixtureResult
 Require ($r.schemaVersion -eq 3) 'OUTPUT_SCHEMA3_REQUIRED'
 Require ($r.diagnostics.version -eq 1 -and $r.diagnostics.profileCleanupState -eq 'NOT_CHECKED') 'FIXED_DIAGNOSTICS_REQUIRED'
}elseif($Scenario -in @('pre-guard','call-throw','throw-then-deadline','returned-late','return-preservation','cim-then-harddeadline','stale-operation','transient-diagnostic-save')){
 $s=New-TestBudget;$b=$s.budget;$clock=$s.clock;$state=@{calls=0;next=0}
 if($Scenario -eq 'transient-diagnostic-save'){
  Add-Type 'public class R05ThrowOnceDictionary : System.Collections.Hashtable { private bool failNext; private int failedWrites; public void Arm() { failNext=true; } public int FailedWrites() { return failedWrites; } public override object this[object key] { get { return base[key]; } set { if(failNext && (string)key == "forwardFailure") { failNext=false; failedWrites++; throw new System.InvalidOperationException("PUBLIC_INERT_SETTER_FAILURE"); } base[key]=value; } } }'
  $transient=[R05ThrowOnceDictionary]::new()
  foreach($key in $b.Diagnostics.Keys){$transient[$key]=$b.Diagnostics[$key]}
  $transient.Arm();$b.Diagnostics=$transient
 }
 if($Scenario -eq 'stale-operation'){
  Protected $b Forward {} 'TASK_ACTION_UPDATE'
  try{Protected $b Forward {throw [Runtime.InteropServices.COMException]::new($privateMarker,-2147024891)}}catch{}
  Require ($null -ne $b.Diagnostics.forwardFailure -and $b.Diagnostics.forwardFailure.operation -eq 'OTHER') 'NO_STALE_ACTION_CONTEXT'
 }elseif($Scenario -eq 'return-preservation'){
  $returned=@(Protected $b Forward {'PUBLIC_RETURN_SENTINEL'})
  Require ($returned.Count -eq 1 -and $returned[0] -ceq 'PUBLIC_RETURN_SENTINEL' -and $null -eq $b.Diagnostics.forwardFailure) 'RETURN_PIPELINE_UNCHANGED'
 }else{
  if($Scenario -eq 'pre-guard'){Advance $clock 480}
  $call={
   $state.calls++
   if($Scenario -in @('throw-then-deadline','returned-late','transient-diagnostic-save')){Advance $clock 481}
   if($Scenario -eq 'cim-then-harddeadline'){Advance $clock 601;throw [Microsoft.Management.Infrastructure.CimException]::new($privateMarker)}
   if($Scenario -in @('call-throw','throw-then-deadline','transient-diagnostic-save')){throw [Runtime.InteropServices.COMException]::new($privateMarker,-2147024891)}
   return 'PUBLIC_RETURN'
  }.GetNewClosure()
  $forward={Protected $b Forward $call 'TASK_ACTION_UPDATE';Protected $b Forward {$state.next++}}.GetNewClosure()
  $outcome=Invoke-R05BudgetedRun $b $forward {}
  Require ($state.calls -eq $(if($Scenario -eq 'pre-guard'){0}else{1}) -and $state.next -eq 0) 'REAL_BASELINE_PATH_EXECUTED'
  $f=$b.Diagnostics.forwardFailure
  Require ($null -ne $f) 'FIRST_FAULT_NOT_RETAINED'
  if($Scenario -eq 'pre-guard'){Require ($f.origin -eq 'PRE_GUARD' -and $f.callState -eq 'NOT_ENTERED') 'PRE_GUARD_NO_CALL'}
  elseif($Scenario -eq 'cim-then-harddeadline'){Require ($outcome.failureCode -eq 'PROOF_HARD_DEADLINE' -and $f.origin -eq 'CALL_THROW' -and $f.callState -eq 'THREW' -and $f.exceptionKind -eq 'CIM' -and $f.cimNativeCode -eq 0 -and $f.win32NativeCode -eq $null) 'FIRST_CIM_SURVIVES_HARD_DEADLINE'}
  elseif($Scenario -eq 'returned-late'){Require ($f.origin -eq 'POST_GUARD' -and $f.callState -eq 'RETURNED') 'POST_GUARD_UNKNOWN_EFFECT'}
  elseif($Scenario -eq 'transient-diagnostic-save'){Require ($transient.FailedWrites() -eq 1) 'TRANSIENT_SETTER_ACTUALLY_THROWN_ONCE';Require ($f.origin -eq 'CALL_THROW' -and $f.callState -eq 'THREW' -and $f.exceptionKind -eq 'COM' -and $f.hresult -eq -2147024891 -and $outcome.failureCode -eq 'PROOF_FORWARD_DEADLINE') ('TRANSIENT_FIRST_FAULT_'+$f.origin+'_'+$f.callState)}
  else{Require ($f.origin -eq 'CALL_THROW' -and $f.callState -eq 'THREW' -and $f.exceptionKind -eq 'COM' -and $f.hresult -eq -2147024891 -and $f.operation -eq 'TASK_ACTION_UPDATE') 'THROW_UNKNOWN_EFFECT'}
  if($Scenario -eq 'throw-then-deadline'){Require ($outcome.failureCode -eq 'PROOF_FORWARD_DEADLINE' -and $f.origin -eq 'CALL_THROW') 'FIRST_FAULT_SURVIVES_POST_DEADLINE'}
  Require (-not $outcome.forwardCompleted) 'FAILURE_NEVER_FORWARD_SUCCESS'
 }
}elseif($Scenario -eq 'cleanup-post-guard'){
 $s=New-TestBudget;$budget=$s.budget;$clock=$s.clock
 $state=@{returned=0}
 $cleanup={$state.returned++;Advance $clock 121}.GetNewClosure()
 $outcome=Invoke-R05BudgetedRun $budget {} $cleanup
 Require ($state.returned -eq 1 -and $outcome.cleanupFailureCode -eq 'PROOF_CLEANUP_DEADLINE' -and -not $outcome.cleanupCompleted -and -not $outcome.finalDeadlineValid) 'ACTUAL_CLEANUP_DEADLINE_PATH_RAN'
 $fault=$budget.Diagnostics.cleanupFailure
 Require ($null -ne $fault -and $fault.origin -eq 'POST_GUARD' -and $fault.callState -eq 'RETURNED') ('CLEANUP_RETURN_'+$fault.origin+'_'+$fault.callState)
}elseif($Scenario -in @('raw-duplicate-wire','canonical-producer-wire')){
 $workflow=Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot) '.github/workflows/gai-owner-task-credential-proof-1218.yml') -Raw
 $run=[regex]::Match($workflow,'(?ms)^        run: \|\r?\n(.*?)(?=^      - name: Retain)').Groups[1].Value
 $run=($run -split '\r?\n'|ForEach-Object {if($_.Length -ge 10){$_.Substring(10)}else{$_}})-join "`n"
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($run,[ref]$tokens,[ref]$errors)
 foreach($f in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){Invoke-Expression $f.Extent.Text}
 $start=$run.IndexOf('$closed=$wire|ConvertFrom-Json')
 $write=[regex]::Match($run,'(?m)^\s*\$(?:wire|validatedWire)\|Set-Content -LiteralPath \$result -Encoding UTF8\s*$')
 Require ($start -ge 0 -and $write.Success) 'ACTUAL_RETAINED_WIRE_CONSUMER_FOUND'
 $consumer=$run.Substring($start,$write.Index+$write.Length-$start)
 $base=New-R05FixtureResult
 $baseWire=$base|ConvertTo-Json -Depth 5 -Compress
 $faultResult=New-R05FixtureResult
 $faultResult.diagnostics.forwardFailure=New-R05DiagnosticFault ([ComponentModel.Win32Exception]::new(-1,'PRIVATE_MANAGED_CANARY')) FORWARD TASK_ACTION_UPDATE CALL_THROW THREW
 $faultWire=$faultResult|ConvertTo-Json -Depth 5 -Compress
 function Retain-Wire([string]$InputWire){
  # Execute the actual workflow parse/validate/retain statements with only an
  # owned public temp file and inert process/deadline values; never start Apply.
  $wire=$InputWire.Trim();$process=@{ExitCode=1};$clock=@{Elapsed=@{TotalSeconds=0}};$wrapperLimit=[datetimeoffset]::UtcNow.AddMinutes(10)
  $result=Join-Path ([IO.Path]::GetTempPath()) ('public-proof-wire-'+[guid]::NewGuid().ToString('N')+'.json')
  $accepted=$false;$retained=$null
  try{try{Invoke-Expression $consumer;$accepted=$true}catch{};if(Test-Path -LiteralPath $result){$retained=[IO.File]::ReadAllText($result).Trim()};return @{accepted=$accepted;retained=$retained}}
  finally{if(Test-Path -LiteralPath $result){Remove-Item -LiteralPath $result -Force}}
 }
 if($Scenario -eq 'raw-duplicate-wire'){
  $bad=@(
   $baseWire.Replace('"profileCleanupState":"NOT_CHECKED"','"profileCleanupState":"PRIVATE_DUPLICATE_CANARY","profileCleanupState":"NOT_CHECKED"'),
   $baseWire.Replace('"operation":"ephemeral-password-task-retention-proof"','"operation":{"private":"PRIVATE_DUPLICATE_CANARY"},"operation":"ephemeral-password-task-retention-proof"'),
   $faultWire.Replace('"win32NativeCode":4294967295','"win32NativeCode":{"Message":"PRIVATE_DUPLICATE_CANARY"},"win32NativeCode":4294967295'),
   ($base|ConvertTo-Json -Depth 5))
  foreach($inputWire in $bad){
   Require ($inputWire -cne $baseWire -and $inputWire -cne $faultWire) 'RAW_MALFORMED_INPUT_ACTUALLY_DISTINCT'
   $observed=Retain-Wire $inputWire
   Require (-not $observed.accepted -and $null -eq $observed.retained) 'DUPLICATE_OR_NONCANONICAL_RAW_WIRE_RETAINED'
  }
 }else{
  # Actual producer CLI failure is deliberately before approval/platform/identity.
  # The second positive uses actual producer functions/serializer with UInt32Max.
  $shell=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  $actualWire=(@(& $shell -NoLogo -NoProfile -NonInteractive -File $source -ValidateOnly)-join "`n").Trim()
  Require ($LASTEXITCODE -eq 1) 'INERT_PRODUCER_CLI_APPROVAL_REFUSAL'
  foreach($positive in @($actualWire,$faultWire,$baseWire)){
   $observed=Retain-Wire $positive
   Require ($observed.accepted -and $observed.retained -ceq $positive) 'CANONICAL_PRODUCER_ROUNDTRIP'
  }
  Require ($faultWire -match '"win32NativeCode":4294967295' -and $baseWire -match '"cleanupFailedComponents":\[\]') 'UINT32_AND_EMPTY_ARRAY_POSITIVES'
 }
}elseif($Scenario -eq 'typed-faults'){
 Require ([bool](Get-Command New-R05DiagnosticFault -ErrorAction SilentlyContinue)) 'TYPED_FAULT_HELPER_REQUIRED'
 $types=@(
  @{e=[Runtime.InteropServices.COMException]::new($privateMarker,-2147024891);kind='COM';native=$null},
  @{e=[ComponentModel.Win32Exception]::new(1326,$privateMarker);kind='WIN32';native=1326},
  @{e=[Exception]::new($privateMarker);kind='DOTNET';native=$null},
  @{e=[Microsoft.Management.Infrastructure.CimException]::new($privateMarker);kind='CIM';native=$null})
 foreach($case in $types){
  $wrapped=[Exception]::new($privateMarker,$case.e)
  $record=[Management.Automation.ErrorRecord]::new($wrapped,'PRIVATE_RECORD',[Management.Automation.ErrorCategory]::NotSpecified,$privateMarker)
  $f=New-R05DiagnosticFault -ErrorRecord $record -Component FORWARD -Operation TASK_ACTION_UPDATE -Origin CALL_THROW -CallState THREW
  Require ($f.exceptionKind -eq $case.kind -and $f.hresult -eq $case.e.HResult -and $f.win32NativeCode -eq $case.native) 'EXACT_TYPED_DOMAIN'
  if($case.kind -eq 'CIM'){Require ($f.cimNativeCode -eq 0 -and $f.cimStatusCode -eq 0) 'CIM_NOT_WIN32'}
  Require (@($f.Keys).Count -eq 10 -and $null -eq $f.cimProviderErrorCode) 'FIXED_FAULT_FIELDS'
  Require (($f|ConvertTo-Json -Compress) -notmatch 'PRIVATE|S-1-|System\.[^"]*Exception|C:\\') 'PRIVATE_ERROR_SURFACES_NOT_EMITTED'
 }
}elseif($Scenario -eq 'provider-cim'){
 Require ([bool](Get-Command New-R05DiagnosticFault -ErrorAction SilentlyContinue)) 'TYPED_PROVIDER_HELPER_REQUIRED'
 foreach($value in @([uint32]2147943726,'2147943726',$true,[double]123.5)){
  $instance=[Microsoft.Management.Infrastructure.CimInstance]::new('CIM_Error')
  try{
   $instance.CimInstanceProperties.Add([Microsoft.Management.Infrastructure.CimProperty]::Create('Error_Code',$value,[Microsoft.Management.Infrastructure.CimFlags]::None))
   $exception=[Microsoft.Management.Infrastructure.CimException]::new($privateMarker)
   $exception|Add-Member NoteProperty ErrorData $instance -Force
   $record=[Management.Automation.ErrorRecord]::new($exception,'PRIVATE_RECORD',[Management.Automation.ErrorCategory]::NotSpecified,$privateMarker)
   $f=New-R05DiagnosticFault -ErrorRecord $record -Component FORWARD -Operation TASK_ACTION_UPDATE -Origin CALL_THROW -CallState THREW
   Require ($f.cimProviderErrorCode -eq $(if($value -is [uint32]){[uint32]2147943726}else{$null})) 'ONLY_LITERAL_TYPED_PROVIDER_NUMBER'
   Require (($f|ConvertTo-Json -Compress) -notmatch 'PRIVATE|S-1-|System\.[^"]*Exception|C:\\') 'PROVIDER_PRIVATE_SURFACES_NOT_EMITTED'
  }finally{$instance.Dispose()}
 }
}elseif($Scenario -eq 'throwing-getters'){
 Require ([bool](Get-Command New-R05DiagnosticFault -ErrorAction SilentlyContinue)) 'GETTER_SAFE_HELPER_REQUIRED'
 $e=[Microsoft.Management.Infrastructure.CimException]::new($privateMarker)
 $e|Add-Member ScriptProperty HResult {throw 'PRIVATE_GETTER_MUST_NOT_ESCAPE'} -Force
 $e|Add-Member ScriptProperty ErrorData {throw 'PRIVATE_GETTER_MUST_NOT_ESCAPE'} -Force
 $record=[Management.Automation.ErrorRecord]::new($e,'PRIVATE_RECORD',[Management.Automation.ErrorCategory]::NotSpecified,$privateMarker)
 $fault=New-R05DiagnosticFault -ErrorRecord $record -Component FORWARD -Operation TASK_ACTION_UPDATE -Origin CALL_THROW -CallState THREW
 Require ($fault.exceptionKind -eq 'CIM' -and $null -eq $fault.hresult -and $null -eq $fault.cimProviderErrorCode -and $fault.cimNativeCode -eq 0) 'THROWING_TYPED_GETTERS_ARE_NULL'
 foreach($bad in @('123',$true,1.5,[DayOfWeek]1)){
  $e|Add-Member NoteProperty StatusCode $bad -Force
  $fault=New-R05DiagnosticFault -ErrorRecord $record -Component FORWARD -Origin CALL_THROW -CallState THREW
  Require ($null -eq $fault.cimStatusCode) 'TYPED_SCALAR_OVERRIDE_NOT_COERCED'
 }
 Require (($fault|ConvertTo-Json -Compress) -notmatch 'PRIVATE|S-1-|System\.[^"]*Exception|C:\\') 'THROWING_GETTER_NO_PII'
}elseif($Scenario -eq 'diagnostics-failure'){
 $s=New-TestBudget;$budget=$s.budget;Start-R05ProofCleanup $budget
 $dict=[Collections.Generic.Dictionary[string,object]]::new()
 foreach($key in $budget.Diagnostics.Keys){$dict.Add($key,$budget.Diagnostics[$key])}
 $readonly=[Collections.ObjectModel.ReadOnlyDictionary[string,object]]::new($dict)
 $budget.Diagnostics=$readonly;$result=@{diagnostics=$readonly};$owned=@{sid='S-1-5-21-111-222-333-444'}
 function Get-CimInstance {param($ClassName,$Filter)throw [Runtime.InteropServices.COMException]::new('PRIVATE_ORIGINAL_API_ERROR',-2147024891)}
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
 $command=$ast.Find({param($n)$n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-R05ProtectedApi' -and $n.Extent.Text -match '-Operation PROFILE_QUERY$'},$true)
 Require ($null -ne $command) 'ACTUAL_PROFILE_QUERY_BOUNDARY_REQUIRED'
 $caught=$null;try{Invoke-Expression $command.Extent.Text}catch{$caught=$_}
 Require ($null -ne $caught) 'ORIGINAL_ERROR_PROPAGATES'
 $fault=New-R05DiagnosticFault -ErrorRecord $caught -Component PROFILE -Operation PROFILE_QUERY -Origin CALL_THROW -CallState THREW
 Require ($fault.exceptionKind -eq 'COM' -and $fault.hresult -eq -2147024891) 'DIAGNOSTIC_SETTER_CANNOT_MASK_ORIGINAL'
}elseif($Scenario -eq 'scalar-domains'){
 Require ([bool](Get-Command Convert-R05UInt32Scalar -ErrorAction SilentlyContinue)) 'SCALAR_HELPER_REQUIRED'
 foreach($bad in @('123',$true,1.5,[double]::NaN,[double]::PositiveInfinity,[long]4294967296,[long]-2,[DayOfWeek]1)){
  Require ($null -eq (Convert-R05UInt32Scalar $bad)) 'NONINTEGER_OR_UNKNOWN_ENUM_REFUSED'
 }
 Require ((Convert-R05UInt32Scalar ([int]-1) -SignedInt32) -eq [uint32]::MaxValue) 'SIGNED_INT32_BITS'
 Require ((Convert-R05UInt32Scalar ([long]4294967295)) -eq [uint32]::MaxValue) 'UINT32_RANGE'
}elseif($Scenario -in @('profiles','recovered-disable','profile-not-checked')){
 Add-Type 'public static class R05FixtureNative { public static bool BatchRight(string sid,int operation,System.Action check) { check(); return false; } }'
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
 $assignment=$ast.Find({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$cleanup'},$true).Extent.Text
 function Get-LocalUser {param($Name,$ErrorAction)if($script:fixture.removedAccount){return};return [pscustomobject]@{SID=[pscustomobject]@{Value='S-1-5-21-111-222-333-444'}}}
 function Disable-LocalUser {param($InputObject)if($Scenario -eq 'recovered-disable'){throw [ComponentModel.Win32Exception]::new(5,$privateMarker)}}
 function Remove-LocalUser {param($InputObject)$script:fixture.removedAccount=$true}
 function Get-CimInstance {
  param($ClassName,$Filter)
  $script:fixture.queries++
  if($script:fixture.case -eq 'query-failed' -or ($script:fixture.case -eq 'readback-failed' -and $script:fixture.queries -eq 2)){throw [Runtime.InteropServices.COMException]::new('PRIVATE_PROFILE_MESSAGE',-2147024891)}
  if($Scenario -eq 'recovered-disable' -or $script:fixture.case -eq 'absent' -or ($script:fixture.queries -eq 2 -and $script:fixture.case -ne 'still-present')){return}
  return [pscustomobject]@{SID=$(if($script:fixture.case -eq 'sid'){ 'S-1-5-21-111-222-333-555' }else{'S-1-5-21-111-222-333-444'});Special=$script:fixture.case -eq 'special';Loaded=$script:fixture.case -eq 'loaded'}
 }
 function Remove-CimInstance {param($InputObject)$script:fixture.removes++;if($script:fixture.case -eq 'remove-failed'){throw [Runtime.InteropServices.COMException]::new('PRIVATE_REMOVE_MESSAGE',-2147024891)}}
 $pairs=if($Scenario -eq 'recovered-disable'){@(@('recovered','ABSENT_CONFIRMED'))}elseif($Scenario -eq 'profile-not-checked'){@(@('not-checked','NOT_CHECKED'))}else{@(@('loaded','LOADED_REFUSED'),@('special','SPECIAL_REFUSED'),@('sid','SID_MISMATCH_REFUSED'),@('query-failed','QUERY_FAILED'),@('remove-failed','REMOVE_FAILED'),@('readback-failed','READBACK_FAILED'),@('still-present','STILL_PRESENT'),@('absent','ABSENT_CONFIRMED'),@('removed','REMOVED_AND_ABSENT_CONFIRMED'))}
 foreach($pair in $pairs){
  $s=New-TestBudget;$budget=$s.budget;$owned=@{stage='cleanup';registered=$false;sid='S-1-5-21-111-222-333-444';userName='PUBLIC_NOT_ACCOUNT';rootCreated=$false;rootAttempted=$false;accountAttempted=$false}
  $result=New-R05FixtureResult
  if(-not $result.Contains('diagnostics')){$result.diagnostics=$budget.Diagnostics}else{$budget.Diagnostics=$result.diagnostics}
  $result.accountCreated=$Scenario -ne 'profile-not-checked';$script:fixture=@{case=$pair[0];queries=0;removes=0;removedAccount=$false}
  Invoke-Expression $assignment
  $outcome=Invoke-R05BudgetedRun $budget {} $cleanup
  if($Scenario -eq 'profile-not-checked'){
   Require ($script:fixture.queries -eq 0 -and $result.diagnostics.profileCleanupState -eq 'NOT_CHECKED' -and $result.ownProfileRemovedOrAbsent) 'LEGACY_TRUE_NOT_MEASURED_ABSENCE'
   continue
  }
  Require ($script:fixture.queries -ge 1 -and $script:fixture.removedAccount) 'ACTUAL_PROFILE_AND_INDEPENDENT_ACCOUNT_PATH_RAN'
  if($Scenario -eq 'recovered-disable'){
   Require ($outcome.cleanupCompleted -and $null -eq $outcome.failureCode -and $result.cleanupVerified) 'RECOVERED_DIAGNOSTIC_NOT_TERMINAL_FAILURE'
   Require ($null -ne $result.diagnostics.cleanupFailure -and $result.diagnostics.cleanupFailure.component -eq 'ACCOUNT_DISABLE' -and $result.diagnostics.cleanupFailedComponents -contains 'ACCOUNT_DISABLE') 'RECOVERED_FAULT_RETAINED'
   $requiredAst=$ast.Find({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$required'},$true)
   Invoke-Expression $requiredAst.Extent.Text
   foreach($key in $required){$result[$key]=$true}
   $result.mode='APPLY';$result.failureCode=$null
   $completeAst=$ast.Find({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$result.complete'},$true)
   Invoke-Expression $completeAst.Extent.Text
   Require $result.complete 'EXISTING_COMPLETE_PREDICATE_UNCHANGED'
   continue
  }
  Require ($result.diagnostics.profileCleanupState -eq $pair[1]) ('MEASURED_PROFILE_'+$pair[1])
  if($pair[0] -in @('absent','removed')){Require $result.ownProfileRemovedOrAbsent 'ABSENCE_ONLY_AFTER_READBACK'}
  else{Require (-not $result.ownProfileRemovedOrAbsent -and $result.diagnostics.cleanupFailedComponents -contains 'PROFILE') 'PROFILE_FAILURE_NOT_ABSENCE'}
 }
}elseif($Scenario -eq 'wire-rejections'){
 $workflow=Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot) '.github/workflows/gai-owner-task-credential-proof-1218.yml') -Raw
 $run=[regex]::Match($workflow,'(?ms)^        run: \|\r?\n(.*?)(?=^      - name: Retain)').Groups[1].Value
 $run=($run -split '\r?\n'|ForEach-Object {if($_.Length -ge 10){$_.Substring(10)}else{$_}})-join "`n"
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($run,[ref]$tokens,[ref]$errors)
 foreach($f in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){Invoke-Expression $f.Extent.Text}
 Require ([bool](Get-Command Assert-R05ClosedProofResult -ErrorAction SilentlyContinue)) 'STRICT_CONSUMER_REQUIRED'
 $r=New-R05FixtureResult;$r.schemaVersion=3
 if(-not $r.Contains('diagnostics')){$r.diagnostics=New-TestDiagnostics}
 $r.diagnostics.forwardFailure=[ordered]@{component='FORWARD';operation='TASK_ACTION_UPDATE';origin='CALL_THROW';callState='THREW';exceptionKind='COM';hresult=-2147024891;win32NativeCode=$null;cimNativeCode=$null;cimStatusCode=$null;cimProviderErrorCode=$null}
 $normal=$r|ConvertTo-Json -Depth 8 -Compress|ConvertFrom-Json
 Assert-R05ClosedProofResult $normal
 $mutations=@(
  {$args[0].diagnostics|Add-Member NoteProperty private 'PRIVATE_NESTED_CANARY'},
  {$args[0].diagnostics.version=2},
  {$args[0].diagnostics.profileCleanupState='PRIVATE_STATE'},
  {$args[0].diagnostics.cleanupFailedComponents=@('PROFILE','PROFILE')},
  {$args[0].schemaVersion=2},
  {$args[0].operation=@('ephemeral-password-task-retention-proof')},
  {$args[0].diagnostics.forwardFailure.hresult='-2147024891'},
  {$args[0].diagnostics.forwardFailure.hresult=$true},
  {$args[0].diagnostics.forwardFailure.hresult=1.5},
  {$args[0].diagnostics.forwardFailure.cimProviderErrorCode='123'},
  {$args[0].diagnostics.forwardFailure.cimStatusCode=[long]4294967296},
  {$args[0].diagnostics.forwardFailure.origin='PRIVATE_ORIGIN'},
  {$args[0].diagnostics.forwardFailure|Add-Member NoteProperty Message 'PRIVATE_NESTED_CANARY'})
 foreach($mutation in $mutations){$copy=$r|ConvertTo-Json -Depth 8 -Compress|ConvertFrom-Json;& $mutation $copy;$refused=$false;try{Assert-R05ClosedProofResult $copy}catch{$refused=$true};Require $refused 'INVALID_NESTED_OR_OLD_VERSION_REJECTED'}
 $wrapper=$ast.Find({param($n)$n -is [Management.Automation.Language.HashtableAst] -and $n.Extent.Text -match "mode='WRAPPER_ERROR'"},$true)
 Require ($null -ne $wrapper) 'SEPARATE_SAFE_WRAPPER_ERROR_REQUIRED'
 $started=$true;$code='PROOF_PROCESS_PROTOCOL_FAILED'
 $safe=Invoke-Expression $wrapper.Extent.Text
 Require ($safe.schemaVersion -eq 3 -and $safe.childStarted -and $safe.potentialOwnedObjectsRemaining -and -not $safe.cleanupVerified -and $safe.Keys.Count -eq 11) 'WRAPPER_STARTED_MEANS_CLEANUP_UNKNOWN'
 Require (($safe|ConvertTo-Json -Compress) -notmatch 'PRIVATE') 'REJECTED_PAYLOAD_NOT_ECHOED'

}
@{schemaVersion=1;scenario=$Scenario;pass=$true;realCredentialTaskWindowsQueries=0}|ConvertTo-Json -Compress
