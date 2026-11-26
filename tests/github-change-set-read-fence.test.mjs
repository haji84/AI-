import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createDevelopmentChangeSet } from '../src/orchestrator/development-change-set.ts';
import { GitHubChangeSetJournal, GitHubResidentChangeSetStore, createGitHubResidentPersistence } from '../scripts/goriq-github-change-set-journal.ts';

const { structuredClone } = globalThis;
const date='2026-01-01T00:00:00.000Z';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function candidate(id='change-1',patch='b') {
 return createDevelopmentChangeSet({changeSetId:id,jobId:'job-1',workItemId:'job-1:implement',deviceId:'fixture-builder',
  baseRevision:'a'.repeat(40),candidateRevision:patch.repeat(64),changedPaths:['src/example.ts'],affectedSymbols:['example'],
  patchDigest:patch.repeat(64),artifactDigest:'c'.repeat(64),evidenceDigest:'d'.repeat(64),rollback:{kind:'git-base',reference:'a'.repeat(40)}},new Date(date));
}
const update=(row,status,second)=>({...row,status,updatedAt:`2026-01-01T00:00:0${second}.000Z`});
function fixture(imported=[candidate()]) {
 const goal={title:'test-only',description:'not a live Goal',successCriteria:['preserve writes'],constraints:['no network'],createdAt:date,updatedAt:date};
 const entry={kind:'goriq-change-set-import-v1',goalId:'goal-fixture',goalContractDigest:hash(goal),changeSets:imported,snapshotSha256:hash(imported)};
 let state={version:1,goalId:'goal-fixture',goalContractDigest:hash(goal),goal,
  workRun:{goalId:'goal-fixture',phase:'RUNNING'},tasks:{version:1,tasks:[],savedAt:date},attempts:[],
  developmentJobs:{version:1,savedAt:date,jobs:[{jobId:'job-1',goalId:'goal-fixture',baseRevision:'a'.repeat(40),workItems:[{id:'job-1:implement'}]}]},
  events:[{eventId:'import-1',record:entry,recordSha256:hash(entry)}]};
 let writes=0, conflict=false, throwNext=false, delayLoad=null, loadCount=0;
 const port={load:async()=>{loadCount++;const copy=structuredClone(state);if(delayLoad){const gate=delayLoad;delayLoad=null;await gate;}return copy;},
  commitTogether:async(expected,next)=>{if(throwNext){throwNext=false;throw Error('GITHUB_COORDINATOR_WRITE_OUTCOME_UNKNOWN');}
   if(conflict){conflict=false;return false;}if(!isDeepStrictEqual(expected,state))return false;state=structuredClone(next);writes++;return true;},
  developmentJobs:{get:async()=>null,getByGoal:async()=>[],list:async()=>[],put:async()=>{throw Error('not exercised');}}};
 return {port,get state(){return structuredClone(state);},get writes(){return writes;},get loadCount(){return loadCount;},
  replace(value){state=structuredClone(value);},conflict(){conflict=true;},unknown(){throwNext=true;},deferLoad(p){delayLoad=p;}};
}

for(const method of ['get','list']) test(`stale ${method} writer cannot overwrite a newer candidate even with a later timestamp`,async()=>{
 const f=fixture(),a=new GitHubChangeSetJournal(f.port),b=new GitHubChangeSetJournal(f.port);
 const old=method==='get'?await a.get('change-1'):(await a.list())[0];
 const other=await b.get('change-1');await b.put(update(other,'VERIFIED',1));
 const before=f.state;
 await assert.rejects(a.put(update(old,'READY_TO_PUBLISH',2)),/CHANGE_SET_(READ_STALE|READ_REQUIRED)/);
 assert.deepEqual(f.state,before);assert.equal(f.writes,1);
});

test('known absent identity cannot be adopted after a different writer creates it',async()=>{
 const f=fixture([]),a=new GitHubChangeSetJournal(f.port),b=new GitHubChangeSetJournal(f.port);
 assert.equal(await a.get('change-1'),null);await b.put(candidate());
 await assert.rejects(a.put(update(candidate(),'LOCAL',2)),/CHANGE_SET_(READ_STALE|READ_REQUIRED)/);
 assert.equal(f.writes,1);
});

test('an existing candidate cannot be changed without observing its current version',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port);
 await assert.rejects(s.put(update(candidate(),'VERIFIED',1)),/CHANGE_SET_READ_REQUIRED/);
 assert.equal(f.writes,0);
});

test('a CAS conflict requires a new read instead of silently rebasing a second put',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port),old=await s.get('change-1');
 f.conflict();await assert.rejects(s.put(update(old,'VERIFIED',1)),/CHANGE_SET_CONFLICT/);
 await assert.rejects(s.put(update(old,'VERIFIED',1)),/CHANGE_SET_READ_REQUIRED/);
 assert.equal(f.writes,0);
 const fresh=await s.get('change-1');await s.put(update(fresh,'VERIFIED',1));assert.equal(f.writes,1);
});

test('uncertain commit requires readback before retrying the candidate update',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port),old=await s.get('change-1');
 f.unknown();await assert.rejects(s.put(update(old,'VERIFIED',1)),/WRITE_OUTCOME_UNKNOWN/);
 await assert.rejects(s.put(update(old,'VERIFIED',1)),/CHANGE_SET_READ_REQUIRED/);
 assert.equal(f.writes,0);
 await s.list();await s.put(update(old,'VERIFIED',1));assert.equal(f.writes,1);
});

test('a fresh read after rejection permits an intentional update of that new version',async()=>{
 const f=fixture(),a=new GitHubChangeSetJournal(f.port),b=new GitHubChangeSetJournal(f.port);
 const old=await a.get('change-1');const second=await b.get('change-1');await b.put(update(second,'VERIFIED',1));
 await assert.rejects(a.put(update(old,'LOCAL',2)),/CHANGE_SET_(READ_STALE|READ_REQUIRED)/);
 const fresh=await a.get('change-1');await a.put(update(fresh,'READY_TO_PUBLISH',2));
 assert.equal((await b.get('change-1')).status,'READY_TO_PUBLISH');assert.equal(f.writes,2);
});

test('read snapshots are private copies and caller mutation does not change the fence',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port),old=await s.get('change-1');old.status='VERIFIED';
 await s.put(update(old,'VERIFIED',1));assert.equal(f.writes,1);
});

test('successful writes permit a subsequent ordered write without extra local reread',async()=>{
 const f=fixture([]),s=new GitHubChangeSetJournal(f.port);await s.put(candidate());
 await s.put(update(candidate(),'VERIFIED',1));await s.put(update(candidate(),'READY_TO_PUBLISH',2));
 assert.equal(f.writes,3);assert.equal((await s.list())[0].status,'READY_TO_PUBLISH');
});

test('exact idempotent metadata is a no-op, never an execution lease',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port);await s.put(candidate());assert.equal(f.writes,0);
 await assert.rejects(s.put(update(candidate(),'VERIFIED',1)),/CHANGE_SET_READ_REQUIRED/);
});

test('resident host adapter inherits the same read fence',async()=>{
 const f=fixture(),a=new GitHubResidentChangeSetStore(f.port),b=new GitHubResidentChangeSetStore(f.port);
 const old=(await a.list())[0];const recent=await b.get(old.changeSetId);await b.put(update(recent,'VERIFIED',1));
 await assert.rejects(a.put(update(old,'LOCAL',2)),/CHANGE_SET_(READ_STALE|READ_REQUIRED)/);
 assert.equal(f.writes,1);
});

test('factory initial read is version-bound rather than unconditional permission',async()=>{
 const f=fixture(),p=await createGitHubResidentPersistence(f.port),b=new GitHubChangeSetJournal(f.port);
 const old=candidate(),other=await b.get(old.changeSetId);await b.put(update(other,'VERIFIED',1));
 await assert.rejects(p.changeSets.put(update(old,'LOCAL',2)),/CHANGE_SET_(READ_STALE|READ_REQUIRED)/);
 assert.equal(f.writes,1);
});

test('re-reading one candidate cannot clear the stale observation of another',async()=>{
 const f=fixture([candidate(),candidate('change-2','e')]),a=new GitHubChangeSetJournal(f.port),b=new GitHubChangeSetJournal(f.port);
 const rows=await a.list();await b.get('change-1');await b.put(update(rows[0],'VERIFIED',1));
 await a.get('change-2');await assert.rejects(a.put(update(rows[0],'LOCAL',2)),/CHANGE_SET_(READ_STALE|READ_REQUIRED)/);
 assert.equal(f.writes,1);
});

test('unrelated candidate append does not invalidate a matching record observation',async()=>{
 const f=fixture(),a=new GitHubChangeSetJournal(f.port),b=new GitHubChangeSetJournal(f.port);
 const old=await a.get('change-1');await b.put(candidate('change-2','e'));await a.put(update(old,'VERIFIED',1));
 assert.equal(f.writes,2);assert.equal((await a.list()).length,2);
});

test('two fresh candidate inserts racing on one root keep exactly one winner',async()=>{
 const f=fixture([]),a=new GitHubChangeSetJournal(f.port),b=new GitHubChangeSetJournal(f.port);
 const out=await Promise.allSettled([a.put(candidate()),b.put(candidate('change-2','e'))]);
 assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.writes,1);
});

for(const method of ['get','list']) test(`a failed ${method} refresh cannot leave the earlier version usable`,async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port);const old=await s.get('change-1');
 const load=f.port.load;f.port.load=async()=>{throw Error('fixture read unavailable');};
 await assert.rejects(method==='get'?s.get('change-1'):s.list(),/fixture read unavailable/);
 f.port.load=load;
 await assert.rejects(s.put(update(old,'VERIFIED',1)),/CHANGE_SET_READ_REQUIRED/);assert.equal(f.writes,0);
});

test('an existing observation is bound to the Goal identity as well as candidate bytes',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port),old=await s.get('change-1');
 const next=f.state;next.goalId='another-goal';next.workRun.goalId=next.goalId;
 next.developmentJobs.jobs[0].goalId=next.goalId;next.events[0].record.goalId=next.goalId;
 next.events[0].recordSha256=hash(next.events[0].record);f.replace(next);
 await assert.rejects(s.put(update(old,'VERIFIED',1)),/CHANGE_SET_READ_STALE/);assert.equal(f.writes,0);
});

test('an existing observation is bound to the Goal contract digest',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port),old=await s.get('change-1');
 const next=f.state;next.goalContractDigest='f'.repeat(64);
 next.events[0].record.goalContractDigest=next.goalContractDigest;next.events[0].recordSha256=hash(next.events[0].record);f.replace(next);
 await assert.rejects(s.put(update(old,'VERIFIED',1)),/CHANGE_SET_READ_STALE/);assert.equal(f.writes,0);
});

test('a concurrent same-instance get cannot rebase an already-started stale update',async()=>{
 const f=fixture(),a=new GitHubChangeSetJournal(f.port),b=new GitHubChangeSetJournal(f.port),old=await a.get('change-1');
 await b.get('change-1');await b.put(update(old,'VERIFIED',1));
 let unblock;const barrier=new Promise(resolve=>{unblock=resolve;});const load=f.port.load;let hold=true;
 f.port.load=async()=>{if(hold){hold=false;await barrier;}return load();};
 const pending=a.put(update(old,'READY_TO_PUBLISH',2));
 assert.equal((await a.get('change-1')).status,'VERIFIED');unblock();
 await assert.rejects(pending,/CHANGE_SET_READ_STALE/);assert.equal(f.writes,1);
});

test('new candidate retry after a root conflict requires a fresh absence observation',async()=>{
 const f=fixture([]),s=new GitHubChangeSetJournal(f.port);f.conflict();
 await assert.rejects(s.put(candidate()),/CHANGE_SET_CONFLICT/);
 await assert.rejects(s.put(candidate()),/CHANGE_SET_READ_REQUIRED/);assert.equal(f.writes,0);
 assert.equal(await s.get('change-1'),null);await s.put(candidate());assert.equal(f.writes,1);
});

test('lost write acknowledgement allows only an exact no-op until readback',async()=>{
 const f=fixture(),s=new GitHubChangeSetJournal(f.port),old=await s.get('change-1');
 const commit=f.port.commitTogether;f.port.commitTogether=async(a,b)=>{await commit(a,b);throw Error('GITHUB_COORDINATOR_WRITE_OUTCOME_UNKNOWN');};
 const written=update(old,'VERIFIED',1);
 await assert.rejects(s.put(written),/WRITE_OUTCOME_UNKNOWN/);assert.equal(f.writes,1);
 f.port.commitTogether=commit;await s.put(written);assert.equal(f.writes,1);
 await assert.rejects(s.put(update(written,'READY_TO_PUBLISH',2)),/CHANGE_SET_READ_REQUIRED/);
 await s.get('change-1');await s.put(update(written,'READY_TO_PUBLISH',2));assert.equal(f.writes,2);
});

test('a new process-style instance must read an existing candidate before altering it',async()=>{
 const f=fixture([]);await new GitHubChangeSetJournal(f.port).put(candidate());
 const resumed=new GitHubChangeSetJournal(f.port);
 await assert.rejects(resumed.put(update(candidate(),'VERIFIED',1)),/CHANGE_SET_READ_REQUIRED/);
 const restored=(await resumed.list())[0];await resumed.put(update(restored,'VERIFIED',1));assert.equal(f.writes,2);
});
