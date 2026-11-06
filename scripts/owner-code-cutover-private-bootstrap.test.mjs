import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {grant,environment,encode,now} from '../tests/fixtures/owner-code-production-proof.fixture.mjs';
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
let batch;
function run(scenario){if(!batch){const g=grant();for(const path of Object.keys(g.sourceHashes))g.sourceHashes[path]=createHash('sha256').update(readFileSync(path)).digest('hex');const p=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File','tests/owner-code-cutover-private-bootstrap.fixture.ps1','-Scenario','all'],{input:JSON.stringify({encoded:encode(g),environment,now:new Date(now).toISOString(),nodeExecutable:process.execPath}),encoding:'utf8',timeout:30000,maxBuffer:131072});assert.equal(p.error,undefined);assert.equal(p.status,0,p.stdout+p.stderr);assert.equal(p.stderr,'');batch=JSON.parse(p.stdout);}const r=batch[scenario];assert.equal(r.actualNativeCalls,0);assert.equal(r.pass,true);return r;}
test('private kernel backend observes actual-adapter shape and terminates after an Owner mismatch without minting effects',()=>{const r=run('kernel');assert.equal(r.observedOwnerBound,true);assert.equal(r.mismatchTerminal,true);});
test('returned private module and UI closure retain the original PS CWT and monotonic lifetime after nested factory returns',()=>{const r=run('scope');assert.equal(r.closureRetainsOriginal,true);assert.equal(r.noRemint,true);});
test('private kernel observation crossing original expiry prevents all subsequent OS observations',()=>{const r=run('clock');assert.deepEqual(r.kernelCalls,['platform']);});
test('real default private kernel adapter refuses unsupported platform before native observations',{skip:process.platform==='win32'},()=>{assert.equal(run('default').defaultRejected,true);});

test('private kernel rejects System, session zero, noninteractive, invalid signature, known-folder mismatch and numeric strings',()=>{assert.deepEqual(run('denials').denied,['system','session','interactive','signature','folder','typed']);});

test('private source staging holds exactly fifteen immutable files and refuses unsafe ancestry, hardlinks, byte drift and ambiguous claim replay',()=>{assert.deepEqual(run('stage').sourceCases,['success','writer','reparse','links','bytes','claimthrow']);});

test('fixed protected Node admission requires original source claim, exact image identity and normal WinTrust signer observations',()=>{assert.deepEqual(run('node').nodeCases,['success','hash','size','architecture','magic','signature','certificate','publisher','typed']);});

test('actual fixed public Node downloader stops CLR transport reads at original expiry and refuses redirect, oversize and short bodies',()=>{assert.deepEqual(run('archive').archiveCases,['read-expiry','response-expiry','redirect','oversize','short-body']);});

test('consumer-only configuration binds actual releaseRoot, manifest, build, DB-sidecars and ciphertext drift without claiming target environment',()=>{assert.deepEqual(run('configuration').configurationCases,['success','decrypt','validator','manifest','build-missing','sidecar','config-change']);});

test('actual owned Node validation child uses bounded async pipes, a minimal child environment and closed failures',()=>{const r=run('validator-child');assert.equal(r.ownedNodeChildren,4);assert.deepEqual(r.validatorCases,['success','stderr','oversize','exit']);});

test('original durable journal is protected and reference-bound, never reissued after successful or ambiguous creation',()=>{assert.deepEqual(run('journal').journalCases,['success','journalthrow']);});

test('actual readonly bootstrap connects genuine private prerequisites but cannot mint task authority or replay writes',()=>{const r=run('entry');assert.equal(r.readonlyEntryConnected,true);assert.equal(r.taskAdmissionRefused,true);});

test('actual kernel producers stop process and known-folder getters at the same original expiry',()=>{assert.deepEqual(run('kernel-producers').leafCases,['process','folders']);});
