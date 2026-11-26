import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';

const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
function run(scenario){
 const env={...process.env};delete env.PSModulePath;
 const r=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',resolve('tests/owner-code-task-collection.test.ps1'),'-Scenario',scenario],{env,encoding:'utf8',timeout:30000,maxBuffer:131072,windowsHide:true});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stderr,'');
 const v=JSON.parse(r.stdout.trim());
 assert.deepEqual(v,{scenario,pass:true,realTaskRegistrationCalls:0,realCredentialCalls:0});
}
for(const scenario of ['state-single','update-restore','zero-actions','multiple-actions']){
 test(`enumerable task Actions collection: ${scenario}`,()=>run(scenario));
}
const hostedWindows=process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted';
test('task Actions collection: hosted Windows unregistered COM memory definition',{skip:hostedWindows?false:'Requires GitHub-hosted Windows; unregistered COM memory only'},()=>run('com-memory'));
