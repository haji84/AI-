import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { createDevelopmentChangeSet, type DevelopmentChangeSet } from '../src/orchestrator/development-change-set.ts';
import { JsonFileDevelopmentChangeSetStore } from '../src/orchestrator/development-change-set-store.ts';
import { GitHubChangeSetJournal, GitHubResidentChangeSetStore, createGitHubResidentPersistence } from '../scripts/goriq-github-change-set-journal.ts';
import type { GitHubGoalCheckpoint } from '../scripts/goriq-github-coordinator-store.ts';
import type { GitHubFencedCheckpointStores } from '../scripts/goriq-github-checkpoint-stores.ts';

const at = '2026-01-01T00:00:00.000Z';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function candidate(id='change-1', patch='b'): DevelopmentChangeSet {
  return createDevelopmentChangeSet({changeSetId:id, jobId:'job-1', workItemId:'job-1:implement',
    deviceId:'fixture-builder', baseRevision:'a'.repeat(40), candidateRevision:patch.repeat(64),
    changedPaths:['src/example.ts'], affectedSymbols:['example'], patchDigest:patch.repeat(64),
    artifactDigest:'c'.repeat(64), evidenceDigest:'d'.repeat(64), rollback:{kind:'git-base',reference:'a'.repeat(40)}},new Date(at));
}
function fixture(imported: DevelopmentChangeSet[] | null = []) {
  const goal = {title:'fixture only',description:'not the owner Goal',successCriteria:['preserve changes'],constraints:['no production'],createdAt:at,updatedAt:at};
  const record = {kind:'goriq-change-set-import-v1',goalId:'goal-fixture',goalContractDigest:hash(goal),changeSets:imported??[],snapshotSha256:hash(imported??[])};
  let current = {version:1,goalId:'goal-fixture',goalContractDigest:hash(goal),goal,
    workRun:{goalId:'goal-fixture',phase:'RUNNING'},tasks:{version:1,tasks:[],savedAt:at},attempts:[],
    developmentJobs:{version:1,savedAt:at,jobs:[{jobId:'job-1',goalId:'goal-fixture',baseRevision:'a'.repeat(40),workItems:[{id:'job-1:implement'},{id:'job-1:test'}]}]},
    events: imported===null ? [] : [{eventId:'import-1',record,recordSha256:hash(record)}]} as unknown as GitHubGoalCheckpoint;
  let writes=0; let reject=false; let denied=false;
  const port={
    load:async()=>structuredClone(current),
    commitTogether:async(expected:GitHubGoalCheckpoint,next:GitHubGoalCheckpoint)=>{
      if(denied)throw Error('GITHUB_COORDINATOR_CLAIM_INVALID');
      if(reject || !isDeepStrictEqual(expected,current))return false;
      current=structuredClone(next);writes++;return true;
    },
    developmentJobs: {get:async()=>null,getByGoal:async()=>[],list:async()=>[],put:async()=>{throw Error('not exercised');}},
  };
  return {port, get current(){return structuredClone(current);},get writes(){return writes;},
    conflict(){reject=true;},deny(){denied=true;},replace(v:GitHubGoalCheckpoint){current=structuredClone(v);}};
}

test('existing local Change Set storage still persists and reads a real JSON file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'goriq-change-local-'));
 try{const path=join(dir,'changes.json');const s=new JsonFileDevelopmentChangeSetStore(path);await s.put(candidate());
  assert.deepEqual(await new JsonFileDevelopmentChangeSetStore(path).get('change-1'),candidate());
  assert.equal(JSON.parse(await readFile(path,'utf8')).changeSets.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('existing concrete host store can delegate without touching a local path',async()=>{
 const f=fixture();
 const s=new GitHubResidentChangeSetStore(f.port);
 await s.put(candidate());assert.deepEqual(await s.get('change-1'),candidate());assert.equal(f.writes,1);
});

test('fresh journal and host store restore the same failed and repaired candidates',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port);await s.put(candidate());
 const failed={...candidate(),status:'REJECTED' as const,updatedAt:'2026-01-01T00:00:01.000Z'};
 await s.put(failed);const repaired=candidate('change-2','e');await s.put(repaired);
 const next=new GitHubResidentChangeSetStore(f.port);
 assert.deepEqual(await next.list(),[failed,repaired]);assert.equal(f.current.events.length,4);
 assert.equal((f.current.events[1].record as {value:DevelopmentChangeSet}).value.status,'LOCAL');
});

test('missing imported original history is HOLD and never assumed empty',async()=>{
 const f=fixture(null),s=new GitHubChangeSetJournal(f.port);
 await assert.rejects(s.list(),/CHANGE_SET_IMPORT_REQUIRED/);
 await assert.rejects(s.put(candidate()),/CHANGE_SET_IMPORT_REQUIRED/);assert.equal(f.writes,0);
});

test('imported original candidates are recovered and returned by copy',async()=>{
 const f=fixture([candidate()]),s=new GitHubChangeSetJournal(f.port);
 const rows=await s.list();rows[0].status='PUBLISHED';
 assert.equal((await s.get('change-1'))?.status,'LOCAL');assert.equal(f.writes,0);
});

test('wrong Goal or digest in an imported journal is refused',async()=>{
 for(const field of ['goalId','goalContractDigest']){
  const f=fixture();const c=f.current;const r=c.events[0].record as Record<string,unknown>;r[field]='wrong';c.events[0].recordSha256=hash(r);f.replace(c);
  await assert.rejects(new GitHubChangeSetJournal(f.port).list(),/CHANGE_SET_JOURNAL_INVALID/);
 }
});

test('missing canonical Jobs and unbound candidates cannot be imported or appended',async()=>{
 const f=fixture();const c=f.current;delete c.developmentJobs;f.replace(c);
 await assert.rejects(new GitHubChangeSetJournal(f.port).list(),/CHANGE_SET_JOBS_NOT_IMPORTED/);
 for(const invalid of [{...candidate(),jobId:'other-job'},{...candidate(),workItemId:'other-work'}, {...candidate(),baseRevision:'f'.repeat(40)}]){
  const g=fixture();await assert.rejects(new GitHubChangeSetJournal(g.port).put(invalid),/CHANGE_SET_BINDING_INVALID/);assert.equal(g.writes,0);
 }
});

test('a changed candidate identity cannot overwrite the prior candidate',async()=>{
 for(const property of ['candidateRevision','patchDigest','artifactDigest','deviceId','createdAt'] as const){
  const f=fixture([candidate()]);const v={...candidate(),updatedAt:'2026-01-01T00:00:01.000Z'};
  if(property==='createdAt')v.createdAt='2025-01-01T00:00:00.000Z';else if(property==='deviceId')v.deviceId='other';else v[property]='e'.repeat(64);
  if(property==='artifactDigest')v.artifactRef='sha256:'+v.artifactDigest;
  await assert.rejects(new GitHubChangeSetJournal(f.port).put(v),/CHANGE_SET_IDENTITY_CONFLICT/);assert.equal(f.writes,0);
 }
});

test('rejected or published candidates cannot be reanimated',async()=>{
 for(const status of ['REJECTED','PUBLISHED'] as const){const old={...candidate(),status};const f=fixture([old]);
  await assert.rejects(new GitHubChangeSetJournal(f.port).put({...old,status:'LOCAL',updatedAt:'2026-01-01T00:00:01.000Z'}),/CHANGE_SET_TERMINAL/);assert.equal(f.writes,0);
 }
});

test('stale timestamp is rejected; an exact replay is idempotent',async()=>{
 const f=fixture([candidate()]),s=new GitHubChangeSetJournal(f.port);await s.put(candidate());assert.equal(f.writes,0);
 await assert.rejects(s.put({...candidate(),status:'VERIFIED'}),/CHANGE_SET_STALE/);
 const newer={...candidate(),updatedAt:'2026-01-01T00:00:02.000Z'};
 const older={...candidate(),updatedAt:'2026-01-01T00:00:01.000Z'};
 await assert.rejects(new GitHubChangeSetJournal(fixture([newer]).port).put(older),/CHANGE_SET_STALE/);
});

test('changed evidence metadata is retained as conflict, not overwritten',async()=>{
 const f=fixture([candidate()]);await assert.rejects(new GitHubChangeSetJournal(f.port).put({...candidate(),evidenceDigest:'e'.repeat(64),updatedAt:'2026-01-01T00:00:01.000Z'}),/CHANGE_SET_IDENTITY_CONFLICT/);assert.equal(f.writes,0);
});

test('root CAS conflict does not save, retry or lose the imported record',async()=>{
 const f=fixture([candidate()]);f.conflict();const before=f.current;
 await assert.rejects(new GitHubChangeSetJournal(f.port).put(candidate('change-2','e')),/CHANGE_SET_CONFLICT/);
 assert.equal(f.writes,0);assert.deepEqual(f.current,before);
});

test('expired or stale coordinator rejection is preserved without local fallback',async()=>{
 const f=fixture();f.deny();await assert.rejects(new GitHubChangeSetJournal(f.port).put(candidate()),/GITHUB_COORDINATOR_CLAIM_INVALID/);assert.equal(f.writes,0);
});

test('event digest tampering and broken previous-record binding are rejected on restore',async()=>{
 for(const tamper of ['digest','previous'] as const){
  const f=fixture(),s=new GitHubChangeSetJournal(f.port);await s.put(candidate());const c=f.current;
  if(tamper==='digest')c.events[1].recordSha256='0'.repeat(64);
  else{const r=c.events[1].record as Record<string,unknown>;r.previousRecordSha256='a'.repeat(64);c.events[1].recordSha256=hash(r);}
  f.replace(c);await assert.rejects(new GitHubChangeSetJournal(f.port).list(),/CHANGE_SET_JOURNAL_INVALID/);
 }
});

test('second import and update-before-import cannot reset original history',async()=>{
 const f=fixture();const c=f.current;c.events.push({...c.events[0],eventId:'import-2'});f.replace(c);
 await assert.rejects(new GitHubChangeSetJournal(f.port).list(),/CHANGE_SET_JOURNAL_INVALID/);
 const g=fixture(),s=new GitHubChangeSetJournal(g.port);await s.put(candidate());const out=g.current;out.events.reverse();g.replace(out);
 await assert.rejects(new GitHubChangeSetJournal(g.port).list(),/CHANGE_SET_JOURNAL_INVALID/);
});

test('bad status, unsafe metadata and invalid artifact references are refused without writing',async()=>{
 for(const bad of [{...candidate(),status:'SKIPPED' as never},{...candidate(),artifactRef:'sha256:'+'e'.repeat(64)}, {...candidate(),deviceId:'token=secret-value'}]){
  const f=fixture();await assert.rejects(new GitHubChangeSetJournal(f.port).put(bad),/CHANGE_SET_INVALID/);assert.equal(f.writes,0);
 }
});

test('verified red TDD candidate can be the first journaled record without accepting an implementation',async()=>{
 const f=fixture();const red={...candidate(),workItemId:'job-1:test',tddPhase:'red' as const,tddEvidenceDigest:'e'.repeat(64),status:'VERIFIED' as const};
 const s=new GitHubChangeSetJournal(f.port);await s.put(red);assert.deepEqual(await s.get(red.changeSetId),red);
});

test('unknown first VERIFIED implementation or PUBLISHED candidate is refused',async()=>{
 for(const status of ['VERIFIED','PUBLISHED','READY_TO_PUBLISH'] as const){const f=fixture();
  await assert.rejects(new GitHubChangeSetJournal(f.port).put({...candidate(),status}),/CHANGE_SET_INITIAL_STATUS/);assert.equal(f.writes,0);}
});

test('existing ready-to-publish candidate can return to LOCAL for missing verification reconciliation',async()=>{
 const old={...candidate(),status:'READY_TO_PUBLISH' as const};const f=fixture([old]);const s=new GitHubChangeSetJournal(f.port);
 await s.get(old.changeSetId); // Observe the version being intentionally reconciled.
 await s.put({...old,status:'LOCAL',updatedAt:'2026-01-01T00:00:01.000Z'});assert.equal((await s.get(old.changeSetId))?.status,'LOCAL');assert.equal(f.current.events.length,2);
});

test('resident persistence factory binds Jobs and Change Sets to the same supplied checkpoint port',async()=>{
 const f=fixture();const p=await createGitHubResidentPersistence(f.port as unknown as GitHubFencedCheckpointStores);
 assert.equal(p.jobs,f.port.developmentJobs);assert.ok(p.changeSets instanceof JsonFileDevelopmentChangeSetStore);
 await p.changeSets.put(candidate());assert.equal(f.writes,1);assert.deepEqual(await p.changeSets.list(),[candidate()]);
});

test('resident persistence factory rejects an unimported original before returning a host store',async()=>{
 const f=fixture(null);await assert.rejects(createGitHubResidentPersistence(f.port as unknown as GitHubFencedCheckpointStores),/CHANGE_SET_IMPORT_REQUIRED/);
});


test('concurrent journal writers cannot both publish from the same checkpoint',async()=>{
 const f=fixture();const a=new GitHubChangeSetJournal(f.port),b=new GitHubChangeSetJournal(f.port);
 const result=await Promise.allSettled([a.put(candidate('change-A','e')),b.put(candidate('change-B','f'))]);
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(result.filter(x=>x.status==='rejected').length,1);
 assert.equal(f.writes,1);assert.equal((await new GitHubChangeSetJournal(f.port).list()).length,1);
});

test('unknown journal version is refused instead of silently forgetting a candidate',async()=>{
 const f=fixture();const c=f.current;const record={kind:'goriq-change-set-update-v2',goalId:c.goalId};
 c.events.push({eventId:'future-1',record,recordSha256:hash(record)});f.replace(c);
 await assert.rejects(new GitHubChangeSetJournal(f.port).list(),/CHANGE_SET_JOURNAL_INVALID/);
});

test('invalid shared backend is rejected at construction',()=>{
 assert.throws(()=>new GitHubResidentChangeSetStore({} as never),/CHANGE_SET_PORT_INVALID/);
});

test('two distinct Node processes recover rejected metadata before recording a different candidate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'goriq-journal-process-'));
 try{
  const file=join(dir,'fixture.json');await writeFile(file,JSON.stringify(fixture().current));
  const moduleUrl=new URL('../scripts/goriq-github-change-set-journal.ts',import.meta.url).href;
  const child=`import {readFileSync,writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import process from 'node:process';
import {GitHubChangeSetJournal} from ${JSON.stringify(moduleUrl)};
const path=process.argv[1],value=JSON.parse(process.argv[2]);
const load=async()=>JSON.parse(readFileSync(path,'utf8'));
const port={load,commitTogether:async(expected,next)=>{if(!isDeepStrictEqual(await load(),expected))return false;writeFileSync(path,JSON.stringify(next));return true;}};
const store=new GitHubChangeSetJournal(port);
const before=await store.list();await store.put(value);
console.log(JSON.stringify({before,after:await store.list()}));`;
  const rejected={...candidate(),status:'REJECTED' as const};
  const call=(value:DevelopmentChangeSet)=>JSON.parse(execFileSync(process.execPath,
   ['--experimental-strip-types','--input-type=module','-e',child,file,JSON.stringify(value)],
   {encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}));
  assert.deepEqual(call(rejected).before,[]);
  const later=call(candidate('change-next','e'));
  assert.deepEqual(later.before,[rejected]);assert.equal(later.after.length,2);
  const data=JSON.parse(await readFile(file,'utf8'));assert.equal(data.events.length,3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
