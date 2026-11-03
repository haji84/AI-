import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const source=fileURLToPath(new URL('./rotate-jarvis-owner-code-windows.ps1',import.meta.url));
const fixture=fileURLToPath(new URL('../tests/owner-code-rotation-authority.fixture.ps1',import.meta.url));
const powershell=process.platform==='win32'
  ?join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'pwsh';
const probe=spawnSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8',timeout:15000,windowsHide:true});
const unavailable=process.platform!=='win32'&&probe.error?.code==='ENOENT';
if(!unavailable){assert.equal(probe.error,undefined);assert.equal(probe.status,0,probe.stderr);assert.ok(existsSync(source));}
// Linux: add the checksum-verified portable PowerShell directory to PATH.
// Windows: use WindowsPowerShell5.1 directly. Both use synthetic native boundaries;
// no live DPAPI, credential, UI, Scheduled Task or network action is performed.
for(const scenario of ['valid-positive','expiry-after-prompt','config-after-prompt','expiry-during-validation','config-during-validation','expiry-after-candidate-created','config-after-candidate-created']){
  test(`rotation preserves bound authority and config at ${scenario}`,{skip:unavailable?'PowerShell is not installed; add approved portable pwsh to PATH':false},()=>{
    const run=spawnSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',fixture,'-SourcePath',source,'-Case',scenario],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:131072});
    assert.equal(run.error,undefined);assert.equal(run.stderr,'','Fake validator/runtime must not hide a dependency failure');assert.equal(run.status,0,run.stdout+run.stderr);
    const result=JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(result.initialActualGuardsPassed,true);assert.equal(result.actualDPAPIOrProductionOrNetworkUsed,false);assert.equal(result.mutationAndRollbackStatementsFromSource,true);
    assert.equal(result.credentialRngReplacedByDeterministicFixture,true);assert.equal(result.candidateFilesLeft,0);
    if(scenario==='valid-positive'){assert.equal(result.replacementPerformed,true);assert.deepEqual(result.taskOperations,['stop','start','fake-login']);}
    else{assert.equal(result.replacementPerformed,false);assert.deepEqual(result.taskOperations,[]);assert.equal(result.refused,true);}
  });
}
