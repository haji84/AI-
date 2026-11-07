import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,openSync,readSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {grant,environment,encode,now} from '../tests/fixtures/owner-code-production-proof.fixture.mjs';
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const progressPhases=new Set(['BATCH_BEGIN','BATCH_DONE',...['kernel','scope','clock','default','denials','stage','node','archive','configuration','validator-child','journal','entry','kernel-producers','startup-policy','compiled-policy'].flatMap(name=>['BEGIN','DONE'].map(edge=>'SCENARIO_'+name.toUpperCase().replaceAll('-','_')+'_'+edge)), 'STDIN_PROBE_BEGIN','STDIN_PROBE_DONE',...['SUCCESS','STDERR','OVERSIZE','EXIT'].flatMap(mode=>['BEGIN','DONE'].map(edge=>'VALIDATOR_'+mode+'_'+edge))]);
function readPublicProgress(path){let fd;try{fd=openSync(path,'r');const bytes=Buffer.alloc(8193);let total=0;while(total<bytes.length){const count=readSync(fd,bytes,total,bytes.length-total,null);if(count===0)break;total+=count;}if(total>8192)return ['PROGRESS_REJECTED'];const rows=bytes.subarray(0,total).toString('utf8').split('\n').filter(Boolean);if(rows.length>64||rows.some(row=>!progressPhases.has(row)))return ['PROGRESS_REJECTED'];return rows.length?rows:['PROGRESS_EMPTY'];}catch{return ['PROGRESS_UNAVAILABLE'];}finally{if(fd!==undefined)try{closeSync(fd);}catch{}}}
let batch,batchFailure;
function run(scenario){if(batchFailure)throw batchFailure;if(!batch){const progressDirectory=mkdtempSync(join(tmpdir(),'goriq-public-cutover-phase-'));const progressFile=join(progressDirectory,'phase.txt');writeFileSync(progressFile,'',{flag:'wx',mode:0o600});try{const g=grant();for(const path of Object.keys(g.sourceHashes))g.sourceHashes[path]=createHash('sha256').update(readFileSync(path)).digest('hex');const p=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File','tests/owner-code-cutover-private-bootstrap.fixture.ps1','-Scenario','all'],{input:JSON.stringify({encoded:encode(g),environment,now:new Date(now).toISOString(),nodeExecutable:process.execPath}),encoding:'utf8',timeout:30000,maxBuffer:131072,env:{...process.env,GORIQ_PUBLIC_CUTOVER_PROGRESS:progressFile}});assert.equal(p.error,undefined);assert.equal(p.status,0,p.stdout+p.stderr);assert.equal(p.stderr,'');batch=JSON.parse(p.stdout);}catch(error){error.publicFixtureProgress=readPublicProgress(progressFile);error.message+='\nPUBLIC_FIXTURE_PROGRESS:'+error.publicFixtureProgress.join(',');batchFailure=error;throw error;}finally{try{rmSync(progressDirectory,{recursive:true,force:true});}catch{}}}const r=batch[scenario];assert.equal(r.actualNativeCalls,0);assert.equal(r.pass,true);return r;}
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

test('unrecognized compiled-default Node policy blocks every new-profile child and DPAPI handoff before exposure',()=>{const r=run('startup-policy');assert.equal(r.defaultPolicyBlocksBeforeDecrypt,true);assert.equal(r.defaultPolicyBlocksBeforeChild,true);});

test('actual fixed compiled-default observer enforces scoped platform ancestry, exact absence and original identity without widening generic trust',()=>{assert.equal(run('compiled-policy').compiledCases.length,43);});
