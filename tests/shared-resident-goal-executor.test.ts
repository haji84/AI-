import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sharedFixture, hash } from "./fixtures/resident-shared-authority.ts";
import { createGitHubResidentExecutionAuthority } from "../scripts/goriq-github-resident-authority.ts";
import { executeGoal } from "../src/orchestrator/resident-goal-executor.ts";
import { ResidentDevelopmentGoalHost, type ResidentDevelopmentStages } from "../src/orchestrator/resident-development-goal-host.ts";
import { residentDevelopmentGoalDigest } from "../src/orchestrator/resident-development-sequence.ts";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import type { DevelopmentGoalRuntime } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { nextResourceWait } from "../src/orchestrator/development-resource-wait.ts";
import type { WorkRunState } from "../src/orchestrator/work-run-state.ts";
import { ResourceWaitError } from "../src/gai/development-resource-admission.ts";

function fixture(t:import("node:test").TestContext) {
  const root=mkdtempSync(join(tmpdir(),"shared-executor-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const shared=sharedFixture(),path=join(root,"authority"),builds:string[]=[];
  const sequence={version:1 as const,goalDigest:residentDevelopmentGoalDigest(shared.goal),taskScopeId:"issue:1219",maxRisk:"low" as const,
    expiresAt:new Date(Date.now()+600000).toISOString(),completionMode:"verified-local-artifact" as const,jobs:["first","second"].map((key,i)=>
      ({key,objective:"Implement fixture "+key,criterionIds:[`criterion-${i+1}`],targetFiles:[`docs/${key}.txt`],baseRevision:"a".repeat(40)}))};
  let ready=false;
  const stages:ResidentDevelopmentStages={deferMissingVerification:true,async build({job,workItemId,beforeWrite}){
    await beforeWrite?.();builds.push(workItemId);const identity=hash(workItemId),red=workItemId.endsWith(":test");
    return createDevelopmentChangeSet({changeSetId:workItemId,jobId:job.jobId,workItemId,deviceId:"fixture-builder",baseRevision:job.baseRevision,
      candidateRevision:identity,changedPaths:[job.definitionOfDone[0].id==="criterion-1"?"docs/first.txt":"docs/second.txt"],affectedSymbols:[],
      patchDigest:identity,artifactDigest:identity,artifactRef:`sha256:${identity}`,evidenceDigest:identity,rollback:{kind:"git-base",reference:job.baseRevision},
      ...(red?{tddPhase:"red",tddEvidenceDigest:identity}:{})});
  },async verifyRed(){return {digest:"b".repeat(64),issuer:"fixture-verifier"};},
  async verify({plan}){return ready?plan.requiredChecks.map(check=>({check,verifierId:"fixture-verifier",sourceRevision:plan.sourceRevision,
    artifactDigest:plan.artifactDigest,status:"passed",recordedAt:new Date().toISOString()})):[];},
  async acceptanceEvidence({job,plan}){return job.definitionOfDone.map(criterion=>({id:job.jobId+criterion.id,criterionId:criterion.id,kind:"acceptance:file-exact:fixture",
    issuer:"fixture-verifier",verified:true,sourceRevision:plan.sourceRevision,artifactDigest:plan.artifactDigest,recordedAt:new Date().toISOString()}));},
  async releaseState(){return {connected:false,taskScopeId:"issue:1219",protectedConditions:[],classifications:{destructiveChangeAbsent:true,privilegedChangeAbsent:true},pullRequest:null,mainCi:null,deployment:null,postDeploymentEvidence:null};}};
  const bind=async()=>{
    const authority=await createGitHubResidentExecutionAuthority({stores:shared.stores(),authorityPath:path});
    const runtime=new ResidentDevelopmentGoalHost({...authority.persistence,stages,planning:{requirementIds:["CORE-014"],baseRevision:"a".repeat(40),
      taskScopeId:"issue:1219",maxRisk:"low",targetFiles:["docs/first.txt"],contextDigest:sequence.goalDigest,sequence}});
    return {authority,runtime};
  };
  return {...shared,get rootWrites(){return shared.rootWrites;},root,path,builds,stages,bind,setReady(){ready=true;}};
}

test("actual executor and existing bridge/host resume shared history and automatically execute the successor",async t=>{
  const f=fixture(t),a=await f.bind();
  const first=await executeGoal({goalId:f.goalId,context:[],...a});
  assert.equal(first.reason,"verification_wait");assert.equal(f.builds.length,2);
  assert.equal((await a.authority.persistence.jobs.getByGoal(f.goalId))[0].phase,"VERIFYING");
  // Reconstruct every store/authority/runtime; metadata is solely in encrypted shared storage.
  f.setReady();const b=await f.bind();
  const second=await executeGoal({goalId:f.goalId,context:[],...b});
  assert.equal(second.reason,"goal_complete");assert.equal(f.builds.length,4);
  const snapshot=await b.authority.read(f.goalId),jobs=await b.authority.persistence.jobs.getByGoal(f.goalId);
  assert.equal(jobs.length,2);assert.ok(jobs.every(job=>job.phase==="COMPLETED"));
  assert.equal(snapshot.run.phase,"COMPLETED");assert.equal(snapshot.work?.status,"COMPLETED");
  assert.equal(snapshot.work?.verificationResults.length,2);assert.equal(snapshot.events.at(-1)?.type,"GOAL_COMPLETED");
  assert.equal(existsSync(f.path),false);assert.equal(existsSync(join(f.root,"self-development/jobs.json")),false);
  assert.equal(existsSync(join(f.root,"self-development/change-sets.json")),false);
});

function setRun(f:ReturnType<typeof fixture>,patch:Partial<WorkRunState>){
  const c=structuredClone(f.checkpoint);Object.assign(c.workRun,patch);
  const record=c.events[0].record as {sourceState:{active:Array<{kind:string;runs?:WorkRunState[]}>}};
  record.sourceState.active.find(item=>item.kind==="jarvis-work-runs")!.runs=[c.workRun];
  c.events[0].recordSha256=hash(record);f.replace(c);
}

test("shared executor honors future retry and exhausted resource/continuation budgets",async t=>{
  const f=fixture(t);setRun(f,{continuationWait:{slices:1,retryAt:new Date(Date.now()+60000).toISOString()}});
  const a=await f.bind();assert.equal((await executeGoal({goalId:f.goalId,context:[],...a})).executed,false);assert.equal(f.builds.length,0);
  const g=fixture(t);let wait=nextResourceWait(undefined,{status:"WAITING_FOR_RESOURCE",reason:"fixture",retryAfterMs:1000,observedAt:new Date().toISOString()},new Date());
  for(let i=1;i<20;i++)wait=nextResourceWait(wait,{status:"WAITING_FOR_RESOURCE",reason:"fixture",retryAfterMs:1000,observedAt:new Date().toISOString()},new Date());
  setRun(g,{resourceWait:wait});const b=await g.bind();
  await executeGoal({goalId:g.goalId,context:[],...b});assert.equal((await b.authority.read(g.goalId)).run.phase,"BLOCKED");assert.equal(g.builds.length,0);
  const h=fixture(t);setRun(h,{continuationWait:{slices:20,retryAt:"2026-01-01T00:00:00.000Z"}});const c=await h.bind();
  const pending:DevelopmentGoalRuntime={matches:()=>true,async run(){return {cycles:[],stopReason:"cycle_budget_exhausted"};}};
  await executeGoal({goalId:h.goalId,context:[],authority:c.authority,runtime:pending,maxRuns:1});
  assert.deepEqual((await c.authority.read(h.goalId)).run.blockers,["goal_continuation_slice_limit"]);
});

test("takeover during a stage cannot write stale candidate, progress, final or catch state",async t=>{
  const f=fixture(t),a=await f.bind();let writes=0;
  const runtime:DevelopmentGoalRuntime={matches:()=>true,async run(input){
    const current=await f.store().loadCheckpoint();
    f.replace(current,{...f.lease,coordinatorId:"fixture-B",epoch:2,fencingToken:"different"});
    await input.assertExecutionAuthority!();writes++;throw Error("unreachable");
  }};
  await assert.rejects(executeGoal({goalId:f.goalId,context:[],authority:a.authority,runtime}),/CLAIM/);
  assert.equal(writes,0);
  assert.equal((await f.store().loadCheckpoint()).workRun.phase,"RUNNING");
});

test("a pause at awaited runtime return cannot publish a completed Goal",async t=>{
  const f=fixture(t),a=await f.bind();
  const runtime:DevelopmentGoalRuntime={matches:()=>true,async run(){
    const c=await f.store().loadCheckpoint(),current=await a.authority.read(f.goalId);
    const head=c.events.filter(event=>(event.record as {kind?:string})?.kind?.startsWith("goriq-resident-authority-")).at(-1)!;
    const record={kind:"goriq-resident-authority-update-v1",goalId:f.goalId,goalContractDigest:c.goalContractDigest,previousRecordSha256:head.recordSha256,
      snapshot:{...current,control:{...current.control,status:"PAUSED"}}};
    c.events.push({eventId:"late-owner-pause",record,recordSha256:hash(record)});f.replace(c);
    return {cycles:[],stopReason:"goal_complete"};
  }};
  const result=await executeGoal({goalId:f.goalId,context:[],authority:a.authority,runtime});
  assert.equal(result.reason,"paused");
  const final=await a.authority.read(f.goalId);assert.equal(final.run.phase,"RUNNING");assert.equal(final.events.some(event=>event.type==="GOAL_COMPLETED"),false);
});

test("shared completion requires the canonical verified WorkState projection",async t=>{
  const f=fixture(t),a=await f.bind(),runtime:DevelopmentGoalRuntime={matches:()=>true,async run(){return {cycles:[],stopReason:"goal_complete"};}};
  await assert.rejects(executeGoal({goalId:f.goalId,context:[],authority:a.authority,runtime}),/PROGRESS_UNVERIFIED/);
  const final=await a.authority.read(f.goalId);assert.equal(final.run.phase,"RUNNING");assert.equal(final.work!.status,"NOT_STARTED");
  assert.equal(final.events.some(event=>event.type==="GOAL_COMPLETED"),false);
});

for(const outcome of ["conflict","unknown","unknown-pressure"] as const)
test(`shared executor performs no catch writeback after an authority ${outcome}`,async t=>{
  const f=fixture(t),coordinator=f.store(),stores=f.stores(coordinator),authority=await createGitHubResidentExecutionAuthority({stores,authorityPath:f.path});
  const original=coordinator.compareAndSwapCheckpoint.bind(coordinator);let calls=0,runtimeCalls=0;
  const transport=outcome==="unknown-pressure"?new ResourceWaitError({status:"WAITING_FOR_RESOURCE",reason:"fixture transport pressure",retryAfterMs:1000,observedAt:new Date().toISOString()}):new Error("arbitrary fixture transport lost its receipt");
  coordinator.compareAndSwapCheckpoint=async(expected,next,claim)=>{
    calls++;
    if(calls===1){
      if(outcome==="conflict")return false;
      assert.equal(await original(expected,next,claim),true);throw transport;
    }
    return original(expected,next,claim);
  };
  const runtime:DevelopmentGoalRuntime={matches:()=>true,async run(){runtimeCalls++;return {cycles:[],stopReason:"blocked"};}};
  await assert.rejects(executeGoal({goalId:f.goalId,context:[],authority,runtime}),outcome==="conflict"?/AUTHORITY_CONFLICT/:error=>error===transport);
  assert.equal(calls,1);assert.equal(runtimeCalls,0);assert.equal(f.rootWrites,outcome==="conflict"?0:1);
  const checkpoint=await f.store().loadCheckpoint();assert.equal(checkpoint.workRun.phase,outcome==="conflict"?"QUEUED":"RUNNING");
  assert.equal((await authority.read(f.goalId)).events.some(event=>event.type==="GOAL_BLOCKED"),false);
});

test("definitive shared Resident resource wait still commits through the normal report path",async t=>{
  const f=fixture(t);let builds=0;
  f.stages.build=async()=>{builds++;throw new ResourceWaitError({status:"WAITING_FOR_RESOURCE",reason:"fixture builder lane busy",retryAfterMs:30000,observedAt:new Date().toISOString()});};
  const a=await f.bind(),result=await executeGoal({goalId:f.goalId,context:[],...a});
  assert.equal(result.reason,"resource_wait");
  const current=await a.authority.read(f.goalId);
  assert.equal(current.run.phase,"RUNNING");assert.equal(current.run.resourceWait?.reason,"fixture builder lane busy");
  assert.equal((await a.authority.persistence.jobs.getByGoal(f.goalId))[0].phase,"WAITING_FOR_RESOURCE");
  assert.equal((await executeGoal({goalId:f.goalId,context:[],...await f.bind()})).executed,false);assert.equal(builds,1);
});

async function pauseThroughOwnerCas(f:ReturnType<typeof fixture>,authority:Awaited<ReturnType<typeof createGitHubResidentExecutionAuthority>>){
  const owner=f.store(),current=await owner.loadCheckpoint(),snapshot=await authority.read(f.goalId);
  const head=current.events.filter(event=>(event.record as {kind?:string})?.kind?.startsWith("goriq-resident-authority-")).at(-1)!;
  const record={kind:"goriq-resident-authority-update-v1",goalId:f.goalId,goalContractDigest:current.goalContractDigest,previousRecordSha256:head.recordSha256,
    snapshot:{...snapshot,control:{...snapshot.control,status:"PAUSED"}}};
  const next=structuredClone(current);next.events.push({eventId:"authenticated-owner-pause",record,recordSha256:hash(record)});
  assert.equal(await owner.compareAndSwapCheckpoint(current,next,f.lease),true);
  return next;
}

for(const point of ["change-set","job-transition","new-job","change-set-cas"] as const)
test(`selected persistence rejects ${point} mutation after an independent owner pause CAS`,async t=>{
  const f=fixture(t),a=await f.bind();let paused=false,pauseCheckpoint:Awaited<ReturnType<typeof pauseThroughOwnerCas>>|undefined;
  if(point.startsWith("change-set")){
    const original=a.authority.persistence.changeSets.put.bind(a.authority.persistence.changeSets);
    a.authority.persistence.changeSets.put=async(value,now)=>{
      if(!paused){paused=true;
        if(point==="change-set-cas"){
          let reads=0;f.interceptRootRead(async()=>{if(++reads===3)pauseCheckpoint=await pauseThroughOwnerCas(f,a.authority);});
        }else pauseCheckpoint=await pauseThroughOwnerCas(f,a.authority);
      }
      return original(value,now);
    };
  }else{
    const original=a.authority.persistence.jobs.put.bind(a.authority.persistence.jobs);
    a.authority.persistence.jobs.put=async(job,now)=>{
      if(!paused&&(point==="new-job"||job.history.at(-1)!.transitionId.endsWith(":tdd-red"))){paused=true;pauseCheckpoint=await pauseThroughOwnerCas(f,a.authority);}
      return original(job,now);
    };
  }
  if(point==="change-set-cas")await assert.rejects(executeGoal({goalId:f.goalId,context:[],...a}),/CONFLICT/);
  else assert.equal((await executeGoal({goalId:f.goalId,context:[],...a})).reason,"paused");
  assert.ok(paused&&pauseCheckpoint);
  const final=await f.store().loadCheckpoint();
  assert.deepEqual(final,pauseCheckpoint);
});
