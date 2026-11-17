param([switch]$ReusePolicyTypes)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$checks=0
function Assert-SourceGuard([string]$Name,[bool]$Value) {
 if(-not $Value){throw ('SOURCE_GUARD_DIAGNOSTIC_FAILED:'+ $Name)}
 $script:checks++;Write-Output ('PASS '+$Name)
}
if(-not $ReusePolicyTypes){
 $source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../goriq-zbook-bridge-capture.cs'))
 if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $source -Language CSharp}
 else{$null=Add-Type -TypeDefinition $source -Language CSharp -CompilerOptions '/langversion:5'}
}
. (Join-Path $PSScriptRoot '../goriq-zbook-bridge-original-read.ps1')
Assert-SourceGuard 'projector_exists' ($null -ne (Get-Command Get-GoriqBridgeSourceFailure -ErrorAction SilentlyContinue))
$fallback='SOURCE_ACQUISITION_INCOMPLETE'
$reasons=@([Enum]::GetValues([GoriqBridgePrivateGuardReason]))
Assert-SourceGuard 'eight_closed_reasons' ($reasons.Count -eq 8)
foreach($reason in $reasons){
 $e=[GoriqBridgePrivateGuardException]::new($reason)
 Assert-SourceGuard ('direct_'+$reason) ((Get-GoriqBridgeSourceFailure $e) -ceq ('SOURCE_'+$reason))
 $wrapped=[IO.IOException]::new('PRIVATE_WRAPPER_PATH_SID',$e)
 Assert-SourceGuard ('wrapped_'+$reason) ((Get-GoriqBridgeSourceFailure $wrapped) -ceq ('SOURCE_'+$reason))
}
$unknown=[Enum]::ToObject([GoriqBridgePrivateGuardReason],999)
$e=[Activator]::CreateInstance([GoriqBridgePrivateGuardException],[object[]]@($unknown))
Assert-SourceGuard 'actual_unknown_enum_constructed' ($e.Code -ceq '999')
$e|Add-Member NoteProperty Code 'PRIVATE_DACL_UNVERIFIED' -Force
Assert-SourceGuard 'unknown_enum_ets_cannot_forge' ((Get-GoriqBridgeSourceFailure $e) -ceq $fallback)
$e=[GoriqBridgePrivateGuardException]::new([GoriqBridgePrivateGuardReason]::PRIVATE_OWNER_UNVERIFIED)
$e|Add-Member NoteProperty Code 'PRIVATE_PATH_SID_CONTENT' -Force
$e|Add-Member ScriptMethod GetType {return [Exception]} -Force
Assert-SourceGuard 'native_code_and_type_ignore_ets' ((Get-GoriqBridgeSourceFailure $e) -ceq 'SOURCE_PRIVATE_OWNER_UNVERIFIED')
$e=[IO.IOException]::new('PRIVATE_DACL_UNVERIFIED')
$e.Data['Code']='PRIVATE_DACL_UNVERIFIED'
$e|Add-Member NoteProperty Code 'PRIVATE_DACL_UNVERIFIED' -Force
$e|Add-Member ScriptMethod GetType {return [GoriqBridgePrivateGuardException]} -Force
$e|Add-Member NoteProperty InnerException ([GoriqBridgePrivateGuardException]::new([GoriqBridgePrivateGuardReason]::PRIVATE_DACL_UNVERIFIED)) -Force
Assert-SourceGuard 'external_message_data_and_ets_refused' ((Get-GoriqBridgeSourceFailure $e) -ceq $fallback)
$e=[GoriqBridgePrivateGuardException]::new([GoriqBridgePrivateGuardReason]::PRIVATE_DACL_UNVERIFIED)
for($i=0;$i -lt 7;$i++){$e=[IO.IOException]::new('PRIVATE_WRAPPER',$e)}
Assert-SourceGuard 'eighth_link_allowed' ((Get-GoriqBridgeSourceFailure $e) -ceq 'SOURCE_PRIVATE_DACL_UNVERIFIED')
$e=[IO.IOException]::new('PRIVATE_WRAPPER',$e)
Assert-SourceGuard 'ninth_link_refused' ((Get-GoriqBridgeSourceFailure $e) -ceq $fallback)
$name=[Reflection.AssemblyName]::new('SourceGuardDifferentAssembly')
if(@([Reflection.Emit.AssemblyBuilder].GetMethods()|Where-Object {$_.Name -ceq 'DefineDynamicAssembly'}).Count){$assembly=[Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly($name,[Reflection.Emit.AssemblyBuilderAccess]::Run)}else{$assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly($name,[Reflection.Emit.AssemblyBuilderAccess]::Run)}
$module=$assembly.DefineDynamicModule('FixtureModule');$builder=$module.DefineType('GoriqBridgePrivateGuardException',[Reflection.TypeAttributes]::Public,[Exception])
$null=$builder.DefineDefaultConstructor([Reflection.MethodAttributes]::Public)
$property=$builder.DefineProperty('Code',[Reflection.PropertyAttributes]::None,[string],$null)
$getter=$builder.DefineMethod('get_Code',[Reflection.MethodAttributes]'Public,SpecialName,HideBySig',[string],[type[]]@())
$il=$getter.GetILGenerator();$il.Emit([Reflection.Emit.OpCodes]::Ldstr,'PRIVATE_DACL_UNVERIFIED');$il.Emit([Reflection.Emit.OpCodes]::Ret);$property.SetGetMethod($getter)
$fake=$builder.CreateType();$expected=[GoriqBridgeCapture].Assembly.GetType('GoriqBridgePrivateGuardException')
Assert-SourceGuard 'same_name_different_type_setup' ($fake.FullName -ceq $expected.FullName -and $fake -ne $expected)
Assert-SourceGuard 'same_name_different_assembly_refused' ((Get-GoriqBridgeSourceFailure ([Activator]::CreateInstance($fake))) -ceq $fallback)

# Context, capture/storage/disposal and runtime/query edges are doubled. The
# real adapter, CLR exception types and workflow sanitizer validate projection
# and control flow; this fixture does not execute native source acquisition.
function Assert-GoriqBridgeContext {}
$script:runtimeCase=$false
function New-GoriqBridgeCapture {
 $c=[pscustomobject]@{Preserved=$false}
 $c|Add-Member ScriptMethod Acquire {$script:calls.Add('acquire');if($script:runtimeCase){$this.Preserved=$true;return};throw [GoriqBridgePrivateGuardException]::new($script:sourceReason)}
 $c|Add-Member ScriptMethod WritePrivate {param($Name,$Bytes);$script:calls.Add('private-failure')}
 $c|Add-Member ScriptMethod Dispose {$script:calls.Add('dispose')}
 return $c
}
function Get-GoriqBridgeNode {$script:calls.Add('runtime');throw [GoriqBridgePrivateGuardException]::new([GoriqBridgePrivateGuardReason]::PRIVATE_OWNER_UNVERIFIED)}
function Invoke-GoriqBridgeCopiedQuery {throw 'UNEXPECTED_QUERY'}
$workflow=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../.github/workflows/goriq-pc-private-network-probe.yml'))
$job=($workflow -split '\r?\n  zbook_bridge_original:',2)[1] -split '\r?\n  zbook_native:',2
$job=$job[0];$start=$job.IndexOf('            $candidate = ConvertFrom-Json');$end=$job.IndexOf('          } catch',$start)
Assert-SourceGuard 'actual_workflow_sanitizer_found' ($start -ge 0 -and $end -gt $start)
$sanitizer=($job.Substring($start,$end-$start) -split '\r?\n'|ForEach-Object {$_ -replace '^ {12}',''}) -join "`n"
foreach($reason in $reasons){
 $script:sourceReason=$reason;$script:calls=[Collections.Generic.List[string]]::new()
 $report=Invoke-GoriqBridgeRead -NativeSource 'PUBLIC_UNUSED' -QuerySource ([byte[]]@(1)) -InventorySource ([byte[]]@(2))
 Assert-SourceGuard ('adapter_code_'+$reason) ($report.failureCode -ceq ('SOURCE_'+$reason))
 Assert-SourceGuard ('adapter_closed_failure_'+$reason) ($report.Count -eq 25 -and $report.status -ceq 'INCOMPLETE' -and -not $report.preserved -and -not $report.queryVerified -and -not $report.originalGoalRecovered -and $report.g1 -ceq 'HOLD')
 Assert-SourceGuard ('adapter_disposed_without_runtime_'+$reason) (($script:calls -join ',') -ceq 'acquire,private-failure,dispose')
 $raw=@($report|ConvertTo-Json -Depth 4 -Compress)
 $wire=@(& ([ScriptBlock]::Create($sanitizer)))
 Assert-SourceGuard ('workflow_single_closed_output_'+$reason) ($wire.Count -eq 1 -and $wire[0].StartsWith('GORIQ_ZBOOK_BRIDGE_ORIGINAL '))
 $clean=$wire[0].Substring('GORIQ_ZBOOK_BRIDGE_ORIGINAL '.Length)|ConvertFrom-Json
 Assert-SourceGuard ('workflow_code_'+$reason) ($clean.failureCode -ceq ('SOURCE_'+$reason) -and -not $clean.preserved -and -not $clean.queryVerified)
}
$script:runtimeCase=$true;$script:calls=[Collections.Generic.List[string]]::new()
$report=Invoke-GoriqBridgeRead -NativeSource 'PUBLIC_UNUSED' -QuerySource ([byte[]]@(1)) -InventorySource ([byte[]]@(2))
Assert-SourceGuard 'later_runtime_guard_not_reclassified_as_source' ($report.failureCode -ceq 'INSTALLED_RUNTIME_UNAVAILABLE' -and $report.preserved -and -not $report.queryVerified)
Assert-SourceGuard 'runtime_failure_disposed_without_query' (($script:calls -join ',') -ceq 'acquire,runtime,private-failure,dispose')
$script:runtimeCase=$false
$bad=New-GoriqBridgeSummary;$bad.status='COPIED_STATE_READ';$bad.queryVerified=$true;$bad.failureCode='SOURCE_PRIVATE_OWNER_UNVERIFIED';$raw=@($bad|ConvertTo-Json -Compress)
$refused=$false;try{$null=& ([ScriptBlock]::Create($sanitizer))}catch{$refused=$true}
Assert-SourceGuard 'source_failure_cannot_be_success' $refused
$bad=New-GoriqBridgeSummary;$bad.failureCode='SOURCE_PRIVATE_PATH_SID_CONTENT';$raw=@($bad|ConvertTo-Json -Compress)
$refused=$false;try{$null=& ([ScriptBlock]::Create($sanitizer))}catch{$refused=$true}
Assert-SourceGuard 'unknown_source_code_not_exported' $refused
Write-Output ('SOURCE_GUARD_DIAGNOSTIC_PASS='+$checks)
