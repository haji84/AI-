import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import process from 'node:process';

const executable=process.platform==='win32'
 ?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
for(const scenario of ['callback','callback-expiry','right-failure','profile-failure','cleanup-success','wrong-sid','cleanup-expiry']){
 test(`isolated task proof: ${scenario} uses real guards and inert native boundary`,()=>{
  const env={...process.env};delete env.PSModulePath;
  const run=spawnSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',resolve('tests/owner-code-task-proof.test.ps1'),'-Scenario',scenario],{env,encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(run.error,undefined);assert.equal(run.status,0,run.stdout+run.stderr);
  const evidence=JSON.parse(run.stdout.trim());
  assert.equal(evidence.pass,true);assert.equal(evidence.realWindowsApiCalls,0);
  assert.equal(evidence.scenario,scenario);
 });
}
