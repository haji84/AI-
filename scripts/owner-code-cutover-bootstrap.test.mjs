import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {grant,environment,encode,now} from '../tests/fixtures/owner-code-production-proof.fixture.mjs';
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
function run(scenario){const g=grant();for(const path of Object.keys(g.sourceHashes))g.sourceHashes[path]=createHash('sha256').update(readFileSync(path)).digest('hex');const p=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File','tests/owner-code-cutover-bootstrap.fixture.ps1','-Scenario',scenario],{input:JSON.stringify({encoded:encode(g),environment,now:new Date(now).toISOString()}),encoding:'utf8',timeout:30000,maxBuffer:131072});assert.equal(p.error,undefined);assert.equal(p.status,0,p.stdout+p.stderr);assert.equal(p.stderr,'');return JSON.parse(p.stdout);}
test('original PS source/job bootstrap binds real source consumers through fixed public fakes without native readiness',()=>{const r=run('source');assert.equal(r.pass,true);assert.equal(r.sourceFilesVerified,15);assert.equal(r.phase,'PUBLIC_SOURCE_BOUND');assert.equal(r.effectCapability,false);assert.equal(r.actualApiNativeCalls,0);assert.equal(r.deniedCases.length,14);});
test('same allocated job retains one original monotonic clock and terminal state across recompilation and forged tokens',()=>{const r=run('clock');assert.equal(r.pass,true);assert.equal(r.originalRemainingMs,880000);assert.equal(r.after500sRemainingMs,380000);assert.equal(r.sameOriginalToken,true);assert.equal(r.invalidClockCannotRevive,true);assert.equal(r.changedWireRefused,true);assert.equal(r.actualApiNativeCalls,0);});

test('invalid clock readings during constructor reentry permanently invalidate the same original lifetime',()=>{const r=run('invalid-recompile');assert.equal(r.pass,true);assert.equal(r.invalidConstructorReadingCannotRevive,true);assert.equal(r.cases,3);assert.equal(r.actualApiNativeCalls,0);});

test('official job metadata may tighten but never extend the original PS provisional hard end',()=>{const r=run('provisional');assert.equal(r.pass,true);assert.equal(r.remainingHardMs,896000);assert.equal(r.phase,'PUBLIC_SOURCE_BOUND');assert.equal(r.actualApiNativeCalls,0);});

test('actual new-profile public transport clamps body timeouts and stops owned CLR streams before any read after original expiry',()=>{const r=run('transport');assert.equal(r.pass,true);assert.deepEqual(r.cases,['forward-read','hard-read','response','unsupported-timeout']);assert.equal(r.actualApiNativeCalls,0);});
