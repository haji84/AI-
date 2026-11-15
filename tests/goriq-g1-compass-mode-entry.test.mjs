import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const module=await import('../scripts/goriq-g1-compass-mode-entry.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
test('entry resolves only the two approved labels and mirrors the existing owner config fallback',()=>{
 assert.equal(typeof module.selectRepairCandidates,'function');
 assert.deepEqual(module.selectRepairCandidates({home:'/Users/owner',ownerConfig:{JARVIS_DB_PATH:'/Users/owner/state/jarvis.db',JARVIS_COMPASS_DB_PATH:'/Users/owner/state/compass.db'}}),[
  {label:'owner-config-file',path:'/Users/owner/state/compass.db'},
  {label:'mac-canonical-repo-default',path:'/Users/owner/JARVIS-AI-/.jarvis/compass.db'},
 ]);
 assert.equal(module.selectRepairCandidates({home:'/Users/owner',ownerConfig:{JARVIS_DB_PATH:'/Users/owner/state/jarvis.db'}})[0].path,'/Users/owner/state/jarvis.db.compass.sqlite');
});
for(const [name,config] of [['missing',{}],['outside',{JARVIS_DB_PATH:'/Users/other/a'}],['relative',{JARVIS_DB_PATH:'relative'}],['alias',{JARVIS_DB_PATH:'/Users/owner/a/../b'}],['nul',{JARVIS_DB_PATH:'/Users/owner/a\0b'}]])test('target selection rejects '+name+' without inventing a replacement',()=>{
 assert.equal(typeof module.selectRepairCandidates,'function');assert.throws(()=>module.selectRepairCandidates({home:'/Users/owner',ownerConfig:config}));
});
test('duplicate resolution retains both labels for native identity deduplication',()=>{
 assert.equal(typeof module.selectRepairCandidates,'function');
 const rows=module.selectRepairCandidates({home:'/Users/owner',ownerConfig:{JARVIS_DB_PATH:'/Users/owner/JARVIS-AI-/.jarvis/jarvis.db',JARVIS_COMPASS_DB_PATH:'/Users/owner/JARVIS-AI-/.jarvis/compass.db'}});
 assert.equal(rows.length,2);assert.equal(rows[0].path,rows[1].path);assert.notEqual(rows[0].label,rows[1].label);
});
test('public repair result never exposes opaque handles or private exceptions and never claims original recovery',()=>{
 assert.equal(typeof module.publicModeResult,'function');
 const value=module.publicModeResult({status:'APPLIED',reason:'MODES_NARROWED',targetCount:1,changedCount:1,restoredCount:0,recoveryRequired:false,handle:{privatePath:'/Users/PRIVATE'},originalGoalRecovered:true,source:'PRIVATE'});
 assert.equal(value.originalGoalRecovered,false);assert.equal(value.productionAcceptance,false);assert.equal(value.changedCount,1);
 assert.equal(JSON.stringify(value).includes('PRIVATE'),false);assert.equal('handle' in value,false);
 const refused=module.publicModeResult({status:'PRIVATE_STATUS',reason:'private error'});
 assert.equal(refused.status,'HOLD');assert.equal(refused.reason,'MODE_ENTRY_UNAVAILABLE');
});
test('dedicated workflow cannot dispatch, run PR code, request secrets or expand token scopes',()=>{
 const text=readFileSync('.github/workflows/goriq-g1-compass-mode-repair.yml','utf8');
 assert.match(text,/workflow_run:/);assert.match(text,/workflows: \["CI"\]/);assert.match(text,/branches: \[main\]/);
 assert.doesNotMatch(text,/workflow_dispatch|pull_request_target|secrets\.|actions:\s*(?:read|write)|contents:\s*write|id-token:|schedule:/);
 assert.match(text,/permissions:\n {2}contents: read/);assert.match(text,/cancel-in-progress: false/);
 assert.match(text,/needs: authorize/);assert.match(text,/runs-on: \[self-hosted, macOS, ARM64\]/);
 assert.equal((text.match(/persist-credentials: false/g)??[]).length,2);
 assert.match(text,/node scripts\/goriq-g1-compass-mode-entry.mjs authorize/);
 assert.match(text,/node scripts\/goriq-g1-compass-mode-entry.mjs apply/);
});
test('entry composition can import the existing literal config reader and bounded inspector',async()=>{
 const source=await import('../scripts/goriq-g1-backup-inventory.mjs');
 assert.equal(typeof source.ownerFileConfiguredPaths,'function');assert.equal(typeof source.inspectCandidate,'function');
});
test('source lease forces a fresh observation at admission and never redates failed reads',async()=>{
 assert.equal(typeof module.createModeSourceLease,'function');
 let clock=1000,reads=0,localChecks=0,available=true;
 const revision='a'.repeat(40);
 const lease=module.createModeSourceLease({revision,now:()=>clock,verifyLocal:()=>{localChecks++;},readMain:async()=>{
  reads++;if(!available)throw Error('unavailable');return {object:{type:'commit',sha:revision}};
 }});
 assert.throws(lease.assertFresh);await lease.verify();assert.equal(reads,1);lease.assertFresh();
 clock+=100;await lease.verify();assert.equal(reads,1);assert.equal(localChecks,2);
 clock+=5000;available=false;await assert.rejects(lease.verify());assert.equal(reads,2);
 clock=47000;assert.throws(lease.assertFresh);
});
test('source lease rejects different currentmain and backward clock before native effects',async()=>{
 assert.equal(typeof module.createModeSourceLease,'function');let clock=1000,revision='a'.repeat(40),observed=revision;
 const lease=module.createModeSourceLease({revision,now:()=>clock,verifyLocal:()=>{},readMain:async()=>({object:{type:'commit',sha:observed}})});
 await lease.verify();clock=999;assert.throws(lease.assertFresh);clock=7000;observed='b'.repeat(40);await assert.rejects(lease.verify());
});
