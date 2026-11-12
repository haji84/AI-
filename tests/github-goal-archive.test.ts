import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { GitHubCoordinatorStore, type GitHubGoalCheckpoint } from '../scripts/goriq-github-coordinator-store.ts';
import type { WorkRunState } from '../src/orchestrator/work-run-state.ts';
import type { DurableTask } from '../src/gai/durable-task-runtime.ts';
import type { DevelopmentJob } from '../src/orchestrator/development-job.ts';
import { GitHubFencedCheckpointStores } from '../scripts/goriq-github-checkpoint-stores.ts';

const repository='fixture-owner/fixture-repo', stateBranch='goriq-state/fixture', clusterId='fixture-cluster';
const token='fixture-only-token-not-live', key=Buffer.alloc(32,0x42);
const rootPath='state/coordinator.enc.json';
const lease={clusterId,coordinatorId:'runner-A',epoch:1,fencingToken:'fixture-fence-1',issuedAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',leaseUntil:'2099-01-01T00:00:00.000Z'};
const claim={clusterId,coordinatorId:lease.coordinatorId,epoch:lease.epoch,fencingToken:lease.fencingToken,leaseUntil:lease.leaseUntil};
const goal={title:'fixture task',description:'fixture only',successCriteria:['test'],constraints:['no effects'],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const run:WorkRunState={runId:'run-goal-fixture',goalId:'goal-fixture',phase:'RUNNING',currentWork:'job-fixture',completedJobs:0,totalJobs:2,recoveryCount:0,blockers:[],nextAction:'verify',evidenceRefs:[],createdAt:goal.createdAt,updatedAt:goal.updatedAt};
const task:DurableTask={id:'job-fixture',idempotencyKey:'idem-1',type:'development',payload:{goalId:'goal-fixture'},status:'running',priority:'normal',requiredCapabilities:[],dependsOn:[],attempts:1,maxAttempts:3,migrationClass:'RESTARTABLE',executionEpoch:1,createdAt:goal.createdAt,updatedAt:goal.updatedAt,history:[{from:null,to:'queued',at:goal.createdAt,reason:'accepted'}]};
const checkpoint:GitHubGoalCheckpoint={version:1,goalId:'goal-fixture',goalContractDigest:digest(goal),goal,workRun:run,tasks:{version:1,tasks:[task],savedAt:goal.updatedAt},attempts:[{attemptId:'attempt-1',jobId:'job-fixture',record:{failure:'syntax'},recordSha256:digest({failure:'syntax'})}],events:[{eventId:'event-1',record:{state:'accepted'},recordSha256:digest({state:'accepted'})}]};
const blob=(bytes:Buffer)=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function seal(plain:unknown){const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(['goriq-coordinator-v1',repository,stateBranch,rootPath,clusterId])));const content=Buffer.concat([cipher.update(JSON.stringify(plain)),cipher.final()]);return Buffer.from(JSON.stringify({version:1,algorithm:'aes-256-gcm',nonce:iv.toString('base64'),ciphertext:content.toString('base64'),tag:cipher.getAuthTag().toString('base64')}));}
function fixture(originalCheckpoint:unknown=checkpoint, initialLease:typeof lease=lease){
 let root=seal({schema:2,lease:initialLease,checkpoint:originalCheckpoint}); const parts=new Map<string,Buffer>();
 let rootWrites=0, partWrites=0, failPartAt=-1, tamperPart:string|null=null, rootConflict=false, partDelayMs=0;
 const fetchImpl=async (urlRaw:string|URL|Request,init:RequestInit={})=>{
  const url=new URL(String(urlRaw)); assert.equal(url.origin,'https://api.github.com');assert.equal(init.redirect,'error');
  assert.equal(new Headers(init.headers).get('authorization'),`Bearer ${token}`);
  const path=url.pathname.split('/contents/')[1]; assert.ok(path,'must use GitHub Contents API');
  assert.equal(url.searchParams.get('ref'),init.method==='GET'?stateBranch:null);
  const bytes=path===rootPath?root:parts.get(path);
  if(init.method==='GET'){
   if(!bytes)return Response.json({}, {status:404});
   const sent=path===tamperPart?Buffer.from(bytes.toString().replace('ciphertext','cipherteXt')):bytes;
   return Response.json({type:'file',path,sha:blob(sent),encoding:'base64',content:sent.toString('base64')});
  }
  assert.equal(init.method,'PUT'); const data=JSON.parse(String(init.body));assert.equal(data.branch,stateBranch);
  if(path===rootPath){rootWrites++;if(rootConflict||data.sha!==blob(root))return Response.json({}, {status:409});root=Buffer.from(data.content,'base64');return Response.json({content:{sha:blob(root)},commit:{sha:'a'.repeat(40)}});}
  partWrites++; if(partDelayMs>0)await new Promise(resolve=>setTimeout(resolve,partDelayMs));
  if(failPartAt===partWrites)return Response.json({}, {status:503});
  assert.match(path,/^state\/history\/[a-f0-9]{64}\.enc\.json$/);
  assert.equal('sha' in data,false,'immutable history chunks are create-only');
  assert.equal(parts.has(path),false,'never replace an existing historical chunk');
  const value=Buffer.from(data.content,'base64');assert.equal(sha256(value),path.match(/([a-f0-9]{64})\.enc\.json$/)![1]);
  parts.set(path,value);return Response.json({content:{sha:blob(value)},commit:{sha:'b'.repeat(40)}},{status:201});
 };
 return {options:{repository,stateBranch,clusterId,token,key,minimumEpoch:1,fetchImpl:fetchImpl as typeof fetch},get rootWrites(){return rootWrites;},get partWrites(){return partWrites;},get partCount(){return parts.size;},get partPaths(){return [...parts.keys()];},get root(){return root;},corrupt(path:string){tamperPart=path;},failPartAt(n:number){failPartAt=n;},conflict(){rootConflict=true;},delayEachPart(ms:number){partDelayMs=ms;}};
}
function expand(n:number):GitHubGoalCheckpoint{const c=structuredClone(checkpoint);for(let i=2;i<=n;i++){const record={failure:'not a match',log:'e'.repeat(340),iteration:i};c.attempts.push({attemptId:`attempt-${i}`,jobId:'job-fixture',record,recordSha256:digest(record)});c.events.push({eventId:`event-${i}`,record:{at:i,status:'not verified'},recordSha256:digest({at:i,status:'not verified'})});}return c;}

test('more than 6500 bytes of append-only attempts are stored without truncation and restored in a fresh instance',async()=>{
 const f=fixture(), s=new GitHubCoordinatorStore(f.options);
 const old=await s.loadCheckpoint(), next=expand(85);assert.ok(Buffer.byteLength(JSON.stringify(next))>6500);
 assert.equal(await s.compareAndSwapCheckpoint(old,next,claim),true);
 assert.ok(f.partCount>2);assert.equal(f.rootWrites,1);
 const fresh=new GitHubCoordinatorStore(f.options);
 assert.deepEqual(await fresh.loadCheckpoint(),next);
 assert.ok(!f.root.toString().includes(goal.title));
});

test('a failed append does not publish a truncated pointer or destroy the old Goal',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),old=await s.loadCheckpoint();
 f.failPartAt(2);
 await assert.rejects(s.compareAndSwapCheckpoint(old,expand(95),claim),/GITHUB_COORDINATOR_/);
 assert.equal(f.rootWrites,0);
 assert.deepEqual(await new GitHubCoordinatorStore(f.options).loadCheckpoint(),checkpoint);
});

test('an immutable history chunk cannot be tampered with without a HOLD',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),old=await s.loadCheckpoint();
 assert.equal(await s.compareAndSwapCheckpoint(old,expand(70),claim),true);
 f.corrupt(f.partPaths[0]);
 await assert.rejects(new GitHubCoordinatorStore(f.options).loadCheckpoint(),/GITHUB_COORDINATOR_/);
});

test('a root conflict never publishes an apparently completed Goal change',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),old=await s.loadCheckpoint();
 f.conflict();assert.equal(await s.compareAndSwapCheckpoint(old,expand(70),claim),false);
 assert.equal(f.rootWrites,1);
 assert.deepEqual(await new GitHubCoordinatorStore(f.options).loadCheckpoint(),checkpoint);
});

test('a prior revision remains retrievable after an appended checkpoint',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),old=await s.loadCheckpoint();
 assert.equal(await s.compareAndSwapCheckpoint(old,expand(45),claim),true);
 const larger=expand(80);const last=await s.loadCheckpoint();
 assert.equal(await s.compareAndSwapCheckpoint(last,larger,claim),true);
 assert.equal(f.rootWrites,2);assert.deepEqual(await new GitHubCoordinatorStore(f.options).loadCheckpoint(),larger);
 assert.ok(f.partCount>2,'old immutable history remains on branch');
});


test('archived Goal survives a coordinator lease renewal without rewriting immutable parts',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),old=await s.loadCheckpoint();
 assert.equal(await s.compareAndSwapCheckpoint(old,expand(50),claim),true);
 const archivedCount=f.partCount;
 const newer={...lease,updatedAt:'2026-02-01T00:00:00.000Z'};
 assert.deepEqual(await s.load(),lease);
 assert.equal(await s.compareAndSwap(lease,newer),true);
 assert.equal(f.partCount,archivedCount);
 assert.deepEqual(await new GitHubCoordinatorStore(f.options).loadCheckpoint(),expand(50));
});

test('stale original coordinator is refused after a takeover while history is archived',async()=>{
 const f=fixture(),a=new GitHubCoordinatorStore(f.options),old=await a.loadCheckpoint();
 assert.equal(await a.compareAndSwapCheckpoint(old,expand(50),claim),true);
 const b=new GitHubCoordinatorStore(f.options);await b.load();
 const takeover={...lease,coordinatorId:'runner-B',epoch:2,fencingToken:'fixture-fence-2',
  issuedAt:'2026-03-01T00:00:00.000Z',updatedAt:'2026-03-01T00:00:00.000Z'};
 assert.equal(await b.compareAndSwap(lease,takeover),true);
 assert.equal(await a.compareAndSwapCheckpoint(old,expand(51),claim),false);
 assert.deepEqual(await new GitHubCoordinatorStore(f.options).loadCheckpoint(),expand(50));
});

test('large checkpoint spanning many response-sized parts survives on a fresh runner',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),old=await s.loadCheckpoint();
 const next=expand(220);assert.ok(Buffer.byteLength(JSON.stringify(next))>65536);
 assert.equal(await s.compareAndSwapCheckpoint(old,next,claim),true);
 assert.ok(f.partCount>20);assert.deepEqual(await new GitHubCoordinatorStore(f.options).loadCheckpoint(),next);
});


test('existing WorkRunStore and DurableTaskStore interfaces share the encrypted checkpoint',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),adapters=new GitHubFencedCheckpointStores(s,()=>claim);
 const run=await adapters.workRun.getByGoal('goal-fixture');assert.deepEqual(run,checkpoint.workRun);
 const jobs=await adapters.tasks.load();assert.deepEqual(jobs,checkpoint.tasks);
 const updatedRun={...run!,phase:'VERIFYING' as const,updatedAt:'2026-03-01T00:00:00.000Z'};
 await adapters.workRun.put(updatedRun);
 assert.deepEqual((await new GitHubCoordinatorStore(f.options).loadCheckpoint()).workRun,updatedRun);
 assert.equal(f.rootWrites,1);
});

test('WorkRun write requires a prior exact read and refuses stale ownership',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),adapters=new GitHubFencedCheckpointStores(s,()=>claim);
 await assert.rejects(adapters.workRun.put(checkpoint.workRun),/GITHUB_COORDINATOR_/);
 await adapters.workRun.getByGoal('goal-fixture');
 const stale=new GitHubFencedCheckpointStores(s,()=>({...claim,epoch:3}));await stale.workRun.getByGoal('goal-fixture');
 await assert.rejects(stale.workRun.put({...checkpoint.workRun,updatedAt:'2026-04-01T00:00:00.000Z'}),/GITHUB_COORDINATOR_/);
 assert.equal(f.rootWrites,0);
});

test('DurableTaskStore refuses blind save and CAS loses to another executor',async()=>{
 const f=fixture(),a=new GitHubFencedCheckpointStores(new GitHubCoordinatorStore(f.options),()=>claim),
   b=new GitHubFencedCheckpointStores(new GitHubCoordinatorStore(f.options),()=>claim);
 const original=await a.tasks.load();const second=await b.tasks.load();
 await assert.rejects(a.tasks.save(original!),/GITHUB_COORDINATOR_/);
 const next=structuredClone(original!);next.tasks[0].history.push({from:'queued',to:'running',reason:'run',at:goal.createdAt});
 assert.equal(await a.tasks.compareAndSwap!(original,next),true);
 assert.equal(await b.tasks.compareAndSwap!(second,next),false);
 assert.deepEqual((await new GitHubCoordinatorStore(f.options).loadCheckpoint()).tasks,next);
});

test('one transaction commits WorkRun and durable Job history in one conditional root write',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),a=new GitHubFencedCheckpointStores(s,()=>claim);
 const before=await a.load();const next=structuredClone(before);
 next.workRun={...next.workRun,phase:'VERIFYING',updatedAt:'2026-05-01T00:00:00.000Z'};
 next.tasks.tasks[0].history.push({from:'queued',to:'running',reason:'started',at:goal.createdAt});
 next.attempts.push({attemptId:'attempt-2',jobId:'job-fixture',record:{failure:'real'},recordSha256:digest({failure:'real'})});
 assert.equal(await a.commitTogether(before,next),true);assert.equal(f.rootWrites,1);
 assert.deepEqual(await new GitHubCoordinatorStore(f.options).loadCheckpoint(),next);
});


const developmentJob:DevelopmentJob={version:1,jobId:'job-fixture',goalId:'goal-fixture',requirementIds:['r1'],acceptanceCriteria:['passes'],
  definitionOfDone:[{id:'dod',description:'verify bytes',required:true}],baseRevision:'a'.repeat(40),
  approvalScope:{taskScopeId:'fixture-only',maxRisk:'low'},workItems:[{id:'w1',objective:'fixture',dependsOn:[],requiredCapabilities:[]}],
  phase:'QUEUED',evidence:[],attempts:[],failureSignatures:[],rejectedStrategyIds:[],blockers:[],
  createdAt:goal.createdAt,updatedAt:goal.updatedAt,
  history:[{transitionId:'create:job-fixture',from:null,to:'QUEUED',actor:'state-controller',reason:'fixture accepted',at:goal.createdAt,evidenceIds:[]}]};
const checkpointWithDev:GitHubGoalCheckpoint={...checkpoint,developmentJobs:{version:1,jobs:[developmentJob],savedAt:goal.updatedAt}};

test('a verified existing DevelopmentJobSnapshot is included in the encrypted canonical readback',async()=>{
 const f=fixture(checkpointWithDev),s=new GitHubCoordinatorStore(f.options);
 assert.deepEqual(await s.loadCheckpoint(),checkpointWithDev);
 const a=new GitHubFencedCheckpointStores(s,()=>claim);
 assert.deepEqual(await a.developmentJobs.get('job-fixture'),developmentJob);
 assert.equal((await a.developmentJobs.getByGoal('goal-fixture')).length,1);
});

test('existing DevelopmentJobStore can append a genuine state transition without losing earlier attempts',async()=>{
 const f=fixture(checkpointWithDev),s=new GitHubCoordinatorStore(f.options),a=new GitHubFencedCheckpointStores(s,()=>claim);
 const first=await a.developmentJobs.get('job-fixture');assert.ok(first);
 const next=structuredClone(first!);next.phase='PLANNING';next.updatedAt='2026-02-02T00:00:00.000Z';
 next.history.push({transitionId:'plan:job-fixture',from:'QUEUED',to:'PLANNING',actor:'state-controller',reason:'plan',at:next.updatedAt,evidenceIds:[]});
 await a.developmentJobs.put(next);
 const loaded=await new GitHubCoordinatorStore(f.options).loadCheckpoint();
 assert.deepEqual(loaded.developmentJobs?.jobs[0],next);
 assert.deepEqual(loaded.attempts,checkpoint.attempts);
});

test('DevelopmentJobStore never creates a missing canonical Goal or silently imports missing history',async()=>{
 const f=fixture(),s=new GitHubCoordinatorStore(f.options),a=new GitHubFencedCheckpointStores(s,()=>claim);
 await assert.rejects(a.developmentJobs.put(developmentJob),/GITHUB_COORDINATOR_/);
 assert.equal(f.rootWrites,0);
});

test('DevelopmentJob attempt history deletion is rejected even when WorkRun progresses',async()=>{
 const past=structuredClone(developmentJob);
 past.attempts=[{signature:'sig',strategyId:'strategy',hypothesis:'failed',recordedAt:goal.updatedAt}];
 past.history.push({transitionId:'rec:job-fixture',from:'QUEUED',to:'RECOVERING',actor:'state-controller',reason:'recovery',at:goal.updatedAt,evidenceIds:[]});
 past.phase='RECOVERING';
 const seed:GitHubGoalCheckpoint={...checkpointWithDev,developmentJobs:{version:1,savedAt:goal.updatedAt,jobs:[past]}};
 const f=fixture(seed),s=new GitHubCoordinatorStore(f.options),a=new GitHubFencedCheckpointStores(s,()=>claim);
 const before=await a.load(),next=structuredClone(before);
 next.developmentJobs!.jobs[0].attempts=[];
 await assert.rejects(a.commitTogether(before,next),/GITHUB_COORDINATOR_/);
 assert.equal(f.rootWrites,0);
});


test('a fence that expires while archiving cannot publish even if its initial check passed',async()=>{
  const expiresAt=new Date(Date.now()+200).toISOString();
  const shortLease={...lease,leaseUntil:expiresAt};
  const f=fixture(checkpoint,shortLease), s=new GitHubCoordinatorStore(f.options), old=await s.loadCheckpoint();
  f.delayEachPart(280);
  await assert.rejects(s.compareAndSwapCheckpoint(old,expand(55),{...claim,leaseUntil:expiresAt}),/GITHUB_COORDINATOR_/);
  assert.equal(f.rootWrites,0,'an expired claim must never publish the coordinator root');
  assert.deepEqual(await new GitHubCoordinatorStore(f.options).loadCheckpoint(),checkpoint);
});

// Real ResidentDevelopmentGoalHost calls DevelopmentJobStore.put() when it
// plans the next Job. Before this gate, an unrecognized Job is always refused.
const successorJob:DevelopmentJob = {
  ...structuredClone(developmentJob),
  jobId:'job-successor',
  createdAt:'2026-03-01T00:00:00.000Z',
  updatedAt:'2026-03-01T00:00:00.000Z',
  history:[{transitionId:'create:job-successor',from:null,to:'QUEUED',actor:'state-controller',reason:'development job created',at:'2026-03-01T00:00:00.000Z',evidenceIds:[]}],
};

test('new development job is admitted only by a separately authorized canonical controller gate',async()=>{
 const f=fixture(checkpointWithDev),s=new GitHubCoordinatorStore(f.options);
 let calls=0;
 const a=new GitHubFencedCheckpointStores(s,()=>claim,{admitDevelopmentJob: async (job, current)=>{
  calls++;
  assert.equal(job.jobId,'job-successor');assert.equal(current.goalId,'goal-fixture');
  assert.equal(current.goalContractDigest,checkpoint.goalContractDigest);
  return true;
 }});
 await a.developmentJobs.put(successorJob);
 assert.equal(calls,1);assert.equal(f.rootWrites,1);
 const fresh=new GitHubCoordinatorStore(f.options);
 const recovered=await fresh.loadCheckpoint();
 assert.deepEqual(recovered.developmentJobs?.jobs,[developmentJob,successorJob]);
 assert.deepEqual(recovered.attempts,checkpoint.attempts);
 assert.deepEqual(recovered.events,checkpoint.events);
});

test('new development job defaults to HOLD even if there is a current lease',async()=>{
 const f=fixture(checkpointWithDev),a=new GitHubFencedCheckpointStores(new GitHubCoordinatorStore(f.options),()=>claim);
 await assert.rejects(a.developmentJobs.put(successorJob),/GITHUB_COORDINATOR_DEVELOPMENT_JOB_NOT_ADMITTED/);
 assert.equal(f.rootWrites,0);
});

test('denied successor authorization cannot create a new Job or change previous history',async()=>{
 const f=fixture(checkpointWithDev),a=new GitHubFencedCheckpointStores(new GitHubCoordinatorStore(f.options),()=>claim,
  {admitDevelopmentJob: async()=>false});
 await assert.rejects(a.developmentJobs.put(successorJob),/GITHUB_COORDINATOR_DEVELOPMENT_JOB_NOT_ADMITTED/);
 assert.equal(f.rootWrites,0);
 assert.deepEqual((await new GitHubCoordinatorStore(f.options).loadCheckpoint()).developmentJobs?.jobs,[developmentJob]);
});

test('current HUMAN_GATE or terminal Goal rejects a new Job before any authorizer call',async()=>{
 for(const phase of ['HUMAN_GATE','COMPLETED','FAILED','BLOCKED'] as const){
  const seed={...checkpointWithDev,workRun:{...run,phase}};
  const f=fixture(seed);let calls=0;
  const a=new GitHubFencedCheckpointStores(new GitHubCoordinatorStore(f.options),()=>claim,
   {admitDevelopmentJob:async()=>{calls++;return true;}});
  await assert.rejects(a.developmentJobs.put(successorJob),/GITHUB_COORDINATOR_DEVELOPMENT_JOB_NOT_ADMITTED/);
  assert.equal(calls,0);assert.equal(f.rootWrites,0);
 }
});

test('authorized successor admission fails closed on stale execution claim',async()=>{
 const f=fixture(checkpointWithDev);
 const a=new GitHubFencedCheckpointStores(new GitHubCoordinatorStore(f.options),()=>({...claim,epoch:2}),
  {admitDevelopmentJob:async()=>true});
 await assert.rejects(a.developmentJobs.put(successorJob),/GITHUB_COORDINATOR_/);
 assert.equal(f.rootWrites,0);
});

test('successor admission rejects a phase that does not match its initial state-controller history',async()=>{
 for (const malformed of [
   {...successorJob,phase:'PLANNING' as const},
   {...successorJob,history:[...successorJob.history,{transitionId:'fake-planning',from:'QUEUED' as const,to:'PLANNING' as const,actor:'state-controller' as const,reason:'fake',at:successorJob.updatedAt,evidenceIds:[]}]},
 ]) {
  const f=fixture(checkpointWithDev),a=new GitHubFencedCheckpointStores(new GitHubCoordinatorStore(f.options),()=>claim,{admitDevelopmentJob:async()=>true});
  await assert.rejects(a.developmentJobs.put(malformed),/GITHUB_COORDINATOR_DEVELOPMENT_JOB_NOT_ADMITTED/);
  assert.equal(f.rootWrites,0);
 }
});
