import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
for(const scenario of ['schema','typed-faults','scalar-domains','pre-guard','call-throw','throw-then-deadline','returned-late','profiles','wire-rejections','return-preservation','cim-then-harddeadline','stale-operation','recovered-disable','profile-not-checked','throwing-getters','diagnostics-failure','transient-diagnostic-save','raw-duplicate-wire','canonical-producer-wire','cleanup-post-guard']){
 test(`closed task proof diagnostics: ${scenario}`,()=>{
  const env={...process.env};delete env.PSModulePath;
  const r=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',resolve('tests/owner-code-task-proof-diagnostics.test.ps1'),'-Scenario',scenario],{env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:128*1024});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stderr,'');
  const v=JSON.parse(r.stdout.trim());assert.equal(v.pass,true);assert.equal(v.realCredentialTaskWindowsQueries,0);assert.equal(v.scenario,scenario);
 });
}

test('closed task proof diagnostics: provider-cim',{skip:process.platform==='win32'?false:'requires Windows in-memory CIM instance; no CIM query'},()=>{
 const env={...process.env};delete env.PSModulePath;
 const r=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',resolve('tests/owner-code-task-proof-diagnostics.test.ps1'),'-Scenario','provider-cim'],{env,encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stderr,'');assert.equal(JSON.parse(r.stdout.trim()).realCredentialTaskWindowsQueries,0);
});
