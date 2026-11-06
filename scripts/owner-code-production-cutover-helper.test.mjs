import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const helper=resolve('scripts/owner-code-production-cutover-1218.ps1'),fixture=resolve('tests/owner-code-production-cutover.fixture.ps1');
function run(file,args=[]){const env={...process.env};delete env.PSModulePath;const r=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',file,...args],{env,encoding:'utf8',timeout:30000,maxBuffer:131072,windowsHide:true});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stderr,'');return JSON.parse(r.stdout.trim());}
test('production fixed-task adapter defaults inert before actual native admission exists',()=>{
 assert.ok(existsSync(helper),'new production helper feature is absent');assert.deepEqual(run(helper),{schemaVersion:1,operation:'production-fixed-task-action-migration',mode:'PLAN_ONLY',complete:false,nativeCalls:0});
});
test('fixed-task adapter binds real identity-shaped observations and refuses forged/replayed/raced effects using only CLR fakes',()=>{
 const r=run(fixture,['-Scenario','matrix']);assert.equal(r.pass,true);assert.equal(r.unwiredAdmissionRefused,true);assert.equal(r.realTaskCredentialCalls,0);assert.deepEqual(r.cases,['forged-admission','forged-binding','success-enumerable','wrong-path','wrong-sid','wrong-logon','wrong-level','wrong-count','wrong-type','source-revoked','session-changed','clock-expired','journal-failure','prewrite-race','nonaction-tamper','post-security','post-context','throw-old','throw-new','postguard-expired','one-write','reminted-admission','parameters','vector','hash-abi','empty-envelope','journal-after-create','remint-after-prewrite','reload']);
});
test('fixed real adapter arguments marshal user/password/SDDL as VT_EMPTY in Windows memory', {skip:process.platform!=='win32'},()=>{assert.deepEqual(run(fixture,['-Scenario','native-variant']),{scenario:'native-variant',pass:true,realTaskCredentialCalls:0});});

test('unexpected preloaded CLR binding cannot replace the reviewed fixed updater',()=>{assert.deepEqual(run(fixture,['-Scenario','preloaded-type']),{scenario:'preloaded-type',pass:true,realTaskCredentialCalls:0});});

test('invalid or inconsistent original-clock observations fail closed and cannot revive the same clock',()=>{const r=run(fixture,['-Scenario','clock-boundary']);assert.equal(r.pass,true);assert.equal(r.realTaskCredentialCalls,0);assert.equal(r.cases.length,16);});
test('unconfirmed or wrongly bound writeahead receipts consume the original attempt without native effects or retries',()=>{const r=run(fixture,['-Scenario','journal-boundary']);assert.equal(r.pass,true);assert.equal(r.realTaskCredentialCalls,0);assert.equal(r.cases.length,12);});

test('every task snapshot binds XML leaves Id and Context to actual COM getters before mutation and on readonly reconciliation',()=>{const r=run(fixture,['-Scenario','xml-boundary']);assert.equal(r.pass,true);assert.equal(r.realTaskCredentialCalls,0);assert.equal(r.cases.length,24);});

test('kernel observation crossing the original deadline cannot enter the next protected API or revive the attempt',()=>{const r=run(fixture,['-Scenario','clock-kernel-expiry']);assert.equal(r.pass,true);assert.equal(r.realTaskCredentialCalls,0);assert.equal(r.cases.length,3);});
