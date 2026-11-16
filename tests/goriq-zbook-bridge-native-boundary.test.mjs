import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { createPowerShellFixtureBatch } from './helpers/powershell-fixture-batch.mjs';
const adapter=resolve('scripts/goriq-zbook-bridge-original-read.ps1');
const root=mkdtempSync(join(tmpdir(),'bridge-native-fixture-'));after(()=>rmSync(root,{recursive:true,force:true}));
const scenarios=['valid','context','private-parent','acl','reparse','identity','sharing','journal','changed','budget','bounds','runtime','child-error','extra-key','raw-content','bad-count','recovered','fixed-bool-type','fixed-version-type'];
const script=join(root,'fixture.ps1');
writeFileSync(script,`param([string]$Scenario,[string]$Adapter)
$ErrorActionPreference='Stop'
. $Adapter
function Get-GoriqBridgeNativeContext { return $true }
function Assert-GoriqBridgeContext { if($Scenario -ceq 'context'){throw 'PRIVATE_CONTEXT'} }
$script:calls=[Collections.Generic.List[string]]::new()
function New-GoriqBridgeCapture {
 $script:calls.Add('storage')
 if($Scenario -cin @('private-parent','acl','reparse','identity')){throw 'PRIVATE_STORAGE_DETAIL'}
 $capture=[pscustomobject]@{Root='PRIVATE_PATH';Preserved=$false}
 $capture|Add-Member ScriptMethod Acquire { $script:calls.Add('acquire');if($Scenario -cin @('sharing','journal','changed','budget','bounds')){throw 'PRIVATE_SOURCE_DETAIL'};$this.Preserved=$true }
 $capture|Add-Member ScriptMethod WritePrivate { param($Name,$Bytes) $script:calls.Add('private-write') }
 $capture|Add-Member ScriptMethod Stage { param($Name,$Bytes) $script:calls.Add('stage') }
 $capture|Add-Member ScriptMethod PrepareOutputs { $script:calls.Add('prepare-output') }
 $capture|Add-Member ScriptMethod Dispose { $script:calls.Add('dispose') }
 return $capture
}
function Get-GoriqBridgeNode { $script:calls.Add('runtime');if($Scenario -ceq 'runtime'){throw 'PRIVATE_RUNTIME'};return 'PRIVATE_NODE' }
function Invoke-GoriqBridgeCopiedQuery {
 param($Capture,$Node)
 $script:calls.Add('query')
 if(-not $Capture.Preserved){throw 'PRIVATE_QUERY_BEFORE_PRESERVATION'}
 if($Scenario -ceq 'child-error'){throw 'PRIVATE_CHILD_STDERR'}
 $r=New-GoriqBridgeSummary
 $r.status='COPIED_STATE_READ';$r.failureCode='NONE';$r.queryVerified=$true
 if($Scenario -ceq 'extra-key'){$r['private']='PRIVATE_CONTENT'}
 if($Scenario -ceq 'raw-content'){$r.workRunPhase='PRIVATE_CONTENT'}
 if($Scenario -ceq 'bad-count'){$r.attemptCount=-1}
 if($Scenario -ceq 'recovered'){$r.originalGoalRecovered=$true}
 if($Scenario -ceq 'fixed-bool-type'){$r.readOnly=1}
 if($Scenario -ceq 'fixed-version-type'){$r.version='1'}
 return ($r|ConvertTo-Json -Compress)
}
$result=Invoke-GoriqBridgeRead -QuerySource ([Text.Encoding]::UTF8.GetBytes('PUBLIC_QUERY')) -InventorySource ([Text.Encoding]::UTF8.GetBytes('PUBLIC_INVENTORY')) -NativeSource 'PUBLIC_NATIVE'
[ordered]@{result=$result;calls=@($script:calls)}|ConvertTo-Json -Depth 5 -Compress
`);
let run;
function fixture(scenario){
 assert.ok(existsSync(adapter),'fixed Windows adapter must exist');
 run??=createPowerShellFixtureBatch({shell:'pwsh',fixture:script,scenarios,parameters:{Adapter:adapter},timeoutMs:10000});
 const out=run(scenario);assert.equal(out.status,0,out.stderr);assert.equal(out.stderr,'');assert.doesNotMatch(out.stdout,/PRIVATE_(?:CONTENT|PATH|CONTEXT|STORAGE_DETAIL|SOURCE_DETAIL|RUNTIME|CHILD_STDERR|NODE)/);return JSON.parse(out.stdout);
}
for(const scenario of scenarios)test('native boundary double '+scenario+' keeps fixed closed output and capture before query',()=>{
 const {result,calls}=fixture(scenario);
 assert.equal(result.originalGoalRecovered,false);assert.equal(result.g1,'HOLD');
 if(scenario==='valid'){assert.equal(result.status,'COPIED_STATE_READ');assert.equal(result.preserved,true);assert.equal(result.preservationMode,'OBSERVED_STABLE_SHARED');assert.ok(calls.indexOf('acquire')<calls.indexOf('query'));}
 else {assert.equal(result.status,'INCOMPLETE');assert.equal(result.queryVerified,false);}
 if(['context','private-parent','acl','reparse','identity','sharing','journal','changed','budget','bounds','runtime'].includes(scenario))assert.ok(!calls.includes('query'));
 if(scenario==='context')assert.equal(calls.length,0);
});
test('native implementation contains fixed handle identity/ACL/creation guards and no permission repair',()=>{
 assert.ok(existsSync('scripts/goriq-zbook-bridge-capture.cs'));
 const s=readFileSync('scripts/goriq-zbook-bridge-capture.cs','utf8');
 for(const text of ['GetSecurityInfo','GetFileInformationByHandle','GetFinalPathNameByHandle','CreateFileW','CreateDirectoryW','CREATE_NEW','FILE_SHARE_READ','RawSecurityDescriptor','goal-1218-bridge-state','jobs.json','change-sets.json','-journal','-wal','-shm'])assert.ok(s.includes(text),text);
 assert.doesNotMatch(s,/SetSecurityInfo|SetFileSecurity|Set-Acl|icacls|AdjustTokenPrivileges/);
 assert.ok(Buffer.byteLength(s)<65536);
});
