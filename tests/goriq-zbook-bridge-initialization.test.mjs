import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { createPowerShellFixtureBatch } from './helpers/powershell-fixture-batch.mjs';
const phases=['PRIVATE_IDENTITY_UNAVAILABLE','PRIVATE_ENVIRONMENT_UNAVAILABLE','PRIVATE_ANCESTRY_UNAVAILABLE','PRIVATE_PARENT_UNAVAILABLE','PRIVATE_LAYOUT_UNAVAILABLE','PRIVATE_CONTEXT_UNAVAILABLE'];
const reasons=['PRIVATE_PATH_UNVERIFIED','PRIVATE_LOCAL_STORAGE_UNAVAILABLE','PRIVATE_NATIVE_OPEN_UNAVAILABLE','PRIVATE_FILE_METADATA_UNVERIFIED','PRIVATE_FINAL_PATH_UNVERIFIED','PRIVATE_OWNER_UNVERIFIED','PRIVATE_DACL_UNVERIFIED','PRIVATE_CREATE_UNAVAILABLE'];
const cases=['build',...phases.map((_,i)=>'phase-'+i),...reasons.map((_,i)=>'reason-'+i),'unknown','spoof','same-name','unknown-enum','nested','too-deep','valid',...['NATIVE_BUILD_UNAVAILABLE',...phases,...reasons].map((_,i)=>'workflow-'+i),'workflow-unknown','workflow-malicious'];
const root=mkdtempSync(join(tmpdir(),'bridge-initialization-'));after(()=>rmSync(root,{recursive:true,force:true}));
const adapter=resolve('scripts/goriq-zbook-bridge-original-read.ps1'),native=resolve('scripts/goriq-zbook-bridge-capture.cs');
const workflow=readFileSync('.github/workflows/goriq-pc-private-network-probe.yml','utf8');
const job=workflow.split('\n  zbook_bridge_original:')[1].split('\n  zbook_native:')[0];
const sanitizer=job.slice(job.indexOf('            $candidate = ConvertFrom-Json'),job.indexOf('          } catch')).split('\n').map(l=>l.replace(/^ {12}/,'')).join('\n');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const file=join(root,'fixture.ps1');
writeFileSync(file,`param([string]$Scenario,[string]$Adapter,[string]$Native,[string]$Root)
$ErrorActionPreference='Stop'
. $Adapter
if(-not ('GoriqBridgeCapture' -as [type])){Add-Type -Path $Native -ErrorAction Stop}
$phases=@(${phases.map(quote).join(',')})
$reasons=@(${reasons.map(quote).join(',')})
if($Scenario.StartsWith('workflow-')) {
 $codes=@('NATIVE_BUILD_UNAVAILABLE')+$phases+$reasons
 $summary=New-GoriqBridgeSummary
 if($Scenario -ceq 'workflow-unknown'){$summary.failureCode='UNTRUSTED_STAGE'}
 elseif($Scenario -ceq 'workflow-malicious'){$summary.failureCode='PRIVATE_PATH_SID_CONTENT'}
 else {$summary.failureCode=$codes[[int]$Scenario.Substring(9)]}
 $raw=@($summary|ConvertTo-Json -Depth 4 -Compress)
 try {
${sanitizer}
 }catch{Write-Output 'CLOSED_STAGE_REFUSED'}
 return
}
$script:calls=[Collections.Generic.List[string]]::new()
function Assert-GoriqBridgeContext {}
function Initialize-GoriqBridgeNative {
 $script:calls.Add('build')
 if($Scenario -ceq 'build'){throw 'PRIVATE_COMPILER_EXCEPTION_PATH'}
}
function New-GoriqBridgeNativeInstance {
 $script:calls.Add('constructor')
 if($Scenario -ceq 'valid'){
  $c=[pscustomobject]@{Preserved=$false;Root='PRIVATE_ROOT'}
  $c|Add-Member ScriptMethod Acquire {$script:calls.Add('acquire');$this.Preserved=$true}
  $c|Add-Member ScriptMethod WritePrivate {param($Name,$Bytes)}
  $c|Add-Member ScriptMethod Stage {param($Name,$Bytes)}
  $c|Add-Member ScriptMethod PrepareOutputs {}
  $c|Add-Member ScriptMethod Dispose {$script:calls.Add('dispose')}
  return $c
 }
 if($Scenario -ceq 'unknown'){throw [InvalidOperationException]::new('PRIVATE_RAW_HRESULT_PATH')}
 if($Scenario -ceq 'spoof'){$e=[InvalidOperationException]::new('PRIVATE_CONTEXT_UNAVAILABLE');$e.Data['PhaseCode']='PRIVATE_CONTEXT_UNAVAILABLE';throw $e}
 if($Scenario -ceq 'same-name'){
  $name=[Reflection.AssemblyName]::new('FixtureDifferentAssembly')
  if(@([Reflection.Emit.AssemblyBuilder].GetMethods()|Where-Object {$_.Name -ceq 'DefineDynamicAssembly'}).Count){$assembly=[Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly($name,[Reflection.Emit.AssemblyBuilderAccess]::Run)}else{$assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly($name,[Reflection.Emit.AssemblyBuilderAccess]::Run)}
  $module=$assembly.DefineDynamicModule('FixtureModule');$type=$module.DefineType('GoriqBridgeInitializationException',[Reflection.TypeAttributes]::Public,[Exception])
  $null=$type.DefineDefaultConstructor([Reflection.MethodAttributes]::Public)
  $property=$type.DefineProperty('PhaseCode',[Reflection.PropertyAttributes]::None,[string],$null)
  $getter=$type.DefineMethod('get_PhaseCode',[Reflection.MethodAttributes]'Public,SpecialName,HideBySig',[string],[type[]]@())
  $il=$getter.GetILGenerator();$il.Emit([Reflection.Emit.OpCodes]::Ldstr,'PRIVATE_CONTEXT_UNAVAILABLE');$il.Emit([Reflection.Emit.OpCodes]::Ret);$property.SetGetMethod($getter)
  $fake=$type.CreateType();$expected=[GoriqBridgeCapture].Assembly.GetType('GoriqBridgeInitializationException');if($fake.FullName -cne $expected.FullName -or $fake -eq $expected){throw 'PRIVATE_SPOOF_SETUP'};$script:calls.Add('same-name-different-type');throw [Activator]::CreateInstance($fake)
 }
 if($Scenario.StartsWith('reason-')){
  if(-not ('GoriqBridgePrivateGuardException' -as [type])){throw 'PRIVATE_PHASE_CONFLATED'}
  $reason=[Enum]::Parse([GoriqBridgePrivateGuardReason],$reasons[[int]$Scenario.Substring(7)])
  throw [GoriqBridgeInitializationException]::new([GoriqBridgeInitializationPhase]::PRIVATE_ANCESTRY_UNAVAILABLE,[GoriqBridgePrivateGuardException]::new($reason))
 }
 if(-not ('GoriqBridgeInitializationException' -as [type])){throw 'PRIVATE_PHASE_CONFLATED'}
 $phase=if($Scenario.StartsWith('phase-')){$phases[[int]$Scenario.Substring(6)]}else{$phases[0]}
 if($Scenario -ceq 'phase-5'){[IO.File]::WriteAllText([IO.Path]::Combine($Root,'partial-retention-canary'),'PUBLIC_PARTIAL')}
 $value=if($Scenario -ceq 'unknown-enum'){[GoriqBridgeInitializationPhase]999}else{[Enum]::Parse([GoriqBridgeInitializationPhase],$phase)}
 $e=[GoriqBridgeInitializationException]::new($value,[InvalidOperationException]::new('PRIVATE_NATIVE_PATH_SID_ACL_HASH_CONTENT'))
 if($Scenario -ceq 'nested'){$e=[InvalidOperationException]::new('PRIVATE_WRAPPER',$e)}
 if($Scenario -ceq 'too-deep'){for($i=0;$i -lt 12;$i++){$e=[InvalidOperationException]::new('PRIVATE_WRAPPER',$e)}}
 throw $e
}
function Get-GoriqBridgeNode {$script:calls.Add('runtime');return 'PUBLIC_NODE'}
function Invoke-GoriqBridgeCopiedQuery {
 $script:calls.Add('query');$r=New-GoriqBridgeSummary;$r.status='COPIED_STATE_READ';$r.failureCode='NONE';$r.queryVerified=$true;return ($r|ConvertTo-Json -Depth 4 -Compress)
}
$result=Invoke-GoriqBridgeRead -QuerySource ([byte[]]@(1)) -InventorySource ([byte[]]@(2)) -NativeSource ([IO.File]::ReadAllText($Native))
[ordered]@{result=$result;calls=@($script:calls);partialExists=[IO.File]::Exists([IO.Path]::Combine($Root,'partial-retention-canary'))}|ConvertTo-Json -Depth 5 -Compress
`);
const run=createPowerShellFixtureBatch({shell:process.platform==='win32'?'powershell.exe':'pwsh',fixture:file,scenarios:cases,parameters:{Adapter:adapter,Native:native,Root:root},timeoutMs:10000});
function result(scenario){const r=run(scenario);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.doesNotMatch(r.stdout,/PRIVATE_(?:COMPILER_EXCEPTION_PATH|RAW_HRESULT_PATH|ROOT|NATIVE_PATH_SID_ACL_HASH_CONTENT|WRAPPER|PATH_SID_CONTENT|PHASE_CONFLATED)/);return r.stdout;}
for(const scenario of cases.filter(x=>!x.startsWith('workflow-')))test('initialization '+scenario+' has fixed phase, unchanged closed summary and no premature acquisition',()=>{
 const {result:r,calls,partialExists}=JSON.parse(result(scenario));assert.equal(Object.keys(r).length,25);assert.equal(r.originalGoalRecovered,false);assert.equal(r.g1,'HOLD');
 if(scenario==='valid'){assert.equal(r.status,'COPIED_STATE_READ');assert.deepEqual(calls,['build','constructor','acquire','runtime','query','dispose']);return;}
 assert.equal(r.status,'INCOMPLETE');assert.equal(r.preserved,false);assert.equal(r.queryVerified,false);assert.equal(r.currentGoalMatches,null);assert.ok(!calls.includes('acquire'));assert.ok(!calls.includes('runtime'));assert.ok(!calls.includes('query'));
 const expected=scenario==='build'?'NATIVE_BUILD_UNAVAILABLE':scenario.startsWith('phase-')?phases[Number(scenario.slice(6))]:scenario.startsWith('reason-')?reasons[Number(scenario.slice(7))]:scenario==='nested'?phases[0]:'PRIVATE_STORAGE_UNAVAILABLE';
 assert.equal(r.failureCode,expected);assert.deepEqual(calls,scenario==='build'?['build']:scenario==='same-name'?['build','constructor','same-name-different-type']:['build','constructor']);
 if(scenario==='phase-5')assert.equal(partialExists,true);
});
for(const [i,code] of ['NATIVE_BUILD_UNAVAILABLE',...phases,...reasons].entries())test('workflow permits only fixed initialization phase '+code,()=>{
 const wire=result('workflow-'+i);assert.match(wire,/^GORIQ_ZBOOK_BRIDGE_ORIGINAL /);const r=JSON.parse(wire.slice('GORIQ_ZBOOK_BRIDGE_ORIGINAL '.length));assert.equal(Object.keys(r).length,25);assert.equal(r.failureCode,code);assert.equal(r.preserved,false);assert.equal(r.queryVerified,false);
});
for(const name of ['workflow-unknown','workflow-malicious'])test(name+' remains a closed refusal without raw stage output',()=>assert.equal(result(name).trim(),'CLOSED_STAGE_REFUSED'));

test('existing bounded Windows PowerShell CI selects the inert initialization compiler and phase fixtures',()=>{
 const ci=readFileSync('.github/workflows/ci.yml','utf8').split('  windows-runtime-byte-fixtures:')[1];
 assert.match(ci,/timeout-minutes: 5/);assert.match(ci,/shell: powershell/);assert.match(ci,/run: node --test .* tests\/goriq-zbook-bridge-initialization.test.mjs(?:\n|$)/);
});
