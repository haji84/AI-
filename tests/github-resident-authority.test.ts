import assert from "node:assert/strict";
import test from "node:test";
import { createGitHubResidentExecutionAuthority } from "../scripts/goriq-github-resident-authority.ts";
import { sharedFixture, hash } from "./fixtures/resident-shared-authority.ts";
import { WorkStateContextSource } from "../src/orchestrator/work-state-integration.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

test("shared authority reconstructs canonical control/work/run from encrypted imported history",async()=>{
  const f=sharedFixture(),authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"});
  const a=await authority.read(f.goalId),next=structuredClone(a);next.run.phase="RUNNING";
  await authority.commit(a,next);
  const reconstructed=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"});
  assert.equal((await reconstructed.read(f.goalId)).run.phase,"RUNNING");
  assert.deepEqual((await reconstructed.read(f.goalId)).work,f.work);
  assert.equal(f.rootWrites,1);
  assert.ok(!f.files.get("state/coordinator.enc.json")!.toString().includes(f.goal.title));
});

for(const failure of ["missing","duplicate","unknown","digest","work","projection"] as const)test(`shared binding refuses ${failure} original authority`,async()=>{
  const f=sharedFixture(),c=structuredClone(f.checkpoint),event=c.events[0],r=event.record as Record<string,unknown>;
  if(failure==="missing")c.events.shift();
  if(failure==="duplicate")c.events.push({...event,eventId:"second-import"});
  if(failure==="unknown")r.kind="goriq-resident-authority-import-v2";
  if(failure==="digest")event.recordSha256="0".repeat(64);
  if(failure==="work")r.workState=null;
  if(failure==="projection")r.workState={...f.work,goalId:"wrong"};
  if(failure!=="digest")event.recordSha256=hash(r);
  f.replace(c);
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/AUTHORITY|CHECKPOINT|CIPHERTEXT_INVALID/);
  assert.equal(f.rootWrites,0);
});

test("shared runtime cannot weaken control or replace a later canonical stop",async()=>{
  const f=sharedFixture(),authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"});
  const a=await authority.read(f.goalId),next=structuredClone(a);next.control.blockers=["invented"];
  await assert.rejects(authority.commit(a,next),/CONTROL_IMMUTABLE/);
  const seen=await authority.read(f.goalId),c=await f.store().loadCheckpoint();
  const stopped={...seen,control:{...seen.control,status:"PAUSED",blockers:["owner_stop"]}};
  const record={kind:"goriq-resident-authority-update-v1",goalId:f.goalId,goalContractDigest:c.goalContractDigest,
    previousRecordSha256:c.events[0].recordSha256,snapshot:stopped};
  c.events.push({eventId:"owner-control-update",record,recordSha256:hash(record)});f.replace(c);
  await assert.rejects(authority.commit(seen,{...seen,run:{...seen.run,phase:"COMPLETED"}}),/STALE/);
  assert.equal((await authority.read(f.goalId)).control.status,"PAUSED");
});

test("shared conflicts and takeover cannot be retried with the old observation",async()=>{
  const f=sharedFixture(),authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"});
  const a=await authority.read(f.goalId);f.conflict();
  await assert.rejects(authority.commit(a,{...a,run:{...a.run,phase:"RUNNING"}}),/CONFLICT/);
  await assert.rejects(authority.commit(a,a),/READ_REQUIRED/);
  const g=sharedFixture(),other=await createGitHubResidentExecutionAuthority({stores:g.stores(),authorityPath:"/tmp/fixture-authority"});
  g.replace(g.checkpoint,{...g.lease,epoch:2,coordinatorId:"fixture-B",fencingToken:"new-fence"});
  await assert.rejects(other.read(g.goalId),/CLAIM|STALE/);
  assert.equal(g.rootWrites,0);
});

test("pending commit cannot be used to mutate already validated controls",async()=>{
  const f=sharedFixture(),stores=f.stores(),authority=await createGitHubResidentExecutionAuthority({stores,authorityPath:"/tmp/fixture-authority"});
  const before=await authority.read(f.goalId),next=structuredClone(before);next.run.phase="RUNNING";
  const original=stores.assertAuthoritative.bind(stores);let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  stores.assertAuthoritative=async()=>{await gate;await original();};
  const pending=authority.commit(before,next);next.control.status="PAUSED";next.control.active.push({invented:"control"});release();await pending;
  assert.equal((await authority.read(f.goalId)).control.status,before.control.status);
  assert.deepEqual((await authority.read(f.goalId)).control.active,before.control.active);
});

for(const field of ["projectId","phase","completed","decisions","deliverables","verificationSummary","updatedAt","nextAction"])
test(`shared import requires complete StateRecord ${field}`,async()=>{
  const f=sharedFixture(),c=structuredClone(f.checkpoint),record=c.events[0].record as {sourceState:Record<string,unknown>};
  delete record.sourceState[field];c.events[0].recordSha256=hash(record);f.replace(c);
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/AUTHORITY/);
});

for(const field of ["objective","status","riskClass","currentState","updatedAt"])
test(`shared import requires complete WorkState ${field}`,async()=>{
  const f=sharedFixture(),c=structuredClone(f.checkpoint),record=c.events[0].record as {workState:Record<string,unknown>;sourceState:{active:Array<Record<string,unknown>>}};
  delete record.workState[field];record.sourceState.active.find(item=>item.kind==="gai-work-state")!.state=record.workState;
  c.events[0].recordSha256=hash(record);f.replace(c);
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/AUTHORITY/);
});

for(const kind of ["constraints","status","risk","timestamp","nested","version","duplicate"])
test(`shared import rejects contradictory or malformed ${kind}`,async()=>{
  const f=sharedFixture(),c=structuredClone(f.checkpoint),record=c.events[0].record as {workState:Record<string,unknown>;sourceState:{active:Array<Record<string,unknown>>}};
  if(kind==="constraints")record.workState.constraints=[];
  if(kind==="status")record.workState.status="TRUST_ME";
  if(kind==="risk")record.workState.riskClass="R9";
  if(kind==="timestamp")record.workState.updatedAt="invalid";
  if(kind==="nested")record.workState.childWorkItems=[{id:"missing-contract"}];
  const envelope=record.sourceState.active.find(item=>item.kind==="gai-work-state")!;envelope.state=record.workState;
  if(kind==="version")envelope.version=2;
  if(kind==="duplicate")record.sourceState.active.push(structuredClone(envelope));
  c.events[0].recordSha256=hash(record);f.replace(c);
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/AUTHORITY/);
});

test("runtime cannot delete original WorkRun blockers or evidence",async()=>{
  for(const field of ["blockers","evidenceRefs"] as const){
    const f=sharedFixture();f.checkpoint.workRun[field]=["retained"];
    const record=f.checkpoint.events[0].record as {sourceState:{active:Array<{kind:string;runs?:unknown[]}>}};
    record.sourceState.active.find(item=>item.kind==="jarvis-work-runs")!.runs=[f.checkpoint.workRun];
    f.checkpoint.events[0].recordSha256=hash(record);f.replace(f.checkpoint);
    const authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),before=await authority.read(f.goalId),next=structuredClone(before);
    next.run[field]=[];await assert.rejects(authority.commit(before,next),/IMMUTABLE/);
  }
});

test("unknown successful commit invalidates the observation and preserves committed history",async()=>{
  const f=sharedFixture(),coordinator=f.store(),stores=f.stores(coordinator),authority=await createGitHubResidentExecutionAuthority({stores,authorityPath:"/tmp/fixture-authority"});
  const before=await authority.read(f.goalId),original=coordinator.compareAndSwapCheckpoint.bind(coordinator);
  coordinator.compareAndSwapCheckpoint=async(expected,next,claim)=>{await original(expected,next,claim);throw Error("fixture_unknown_outcome");};
  await assert.rejects(authority.commit(before,{...before,run:{...before.run,phase:"RUNNING"}}),/unknown_outcome/);
  await assert.rejects(authority.commit(before,before),/READ_REQUIRED/);
  assert.equal((await authority.read(f.goalId)).run.phase,"RUNNING");assert.equal(f.rootWrites,1);
});

test("expired authority, forged observations and terminal overwrite remain refused",async()=>{
  const f=sharedFixture();f.replace(f.checkpoint,{...f.lease,leaseUntil:"2026-01-02T00:00:00.000Z"});
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/CLAIM/);
  const g=sharedFixture(),authority=await createGitHubResidentExecutionAuthority({stores:g.stores(),authorityPath:"/tmp/fixture-authority"});
  const current=await authority.read(g.goalId);await assert.rejects(authority.commit(structuredClone(current),current),/READ_REQUIRED/);
  await authority.commit(current,{...current,run:{...current.run,phase:"BLOCKED",blockers:["retained-stop"]}});
  const terminal=await authority.read(g.goalId);
  await assert.rejects(authority.commit(terminal,{...terminal,run:{...terminal.run,phase:"RUNNING"}}),/IMMUTABLE/);
});

test("broken authority history cannot forget an imported record",async()=>{
  const f=sharedFixture(),authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),current=await authority.read(f.goalId);
  await authority.commit(current,{...current,run:{...current.run,phase:"RUNNING"}});
  const c=await f.store().loadCheckpoint(),event=c.events.at(-1)!,record=event.record as Record<string,unknown>;
  record.previousRecordSha256="0".repeat(64);event.recordSha256=hash(record);f.replace(c);
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/JOURNAL_INVALID/);
});

test("shared authority accepts the existing WorkState constructor's empty initial currentState and opaque owner blockers",async()=>{
  const f=sharedFixture(),states:WorkState[]=[];
  await new WorkStateContextSource({async get(){return null;},async put(state){states.push(state);},async appendEvent(){}}).collect({goal:f.goal});
  assert.equal(states[0].currentState,"");
  const c=structuredClone(f.checkpoint),record=c.events[0].record as {workState:WorkState;sourceState:{blockers:unknown[];active:Array<Record<string,unknown>>}};
  record.workState=states[0];record.sourceState.active.find(item=>item.kind==="gai-work-state")!.state=states[0];
  record.sourceState.blockers=[{reason:"owner-stop"}];c.events[0].recordSha256=hash(record);f.replace(c);
  const authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),snapshot=await authority.read(f.goalId);
  assert.deepEqual(snapshot.control.blockers,[{reason:"owner-stop"}]);assert.equal(snapshot.work!.currentState,"");
});

test("shared WorkState objective remains bound to the original Goal objective",async()=>{
  const f=sharedFixture(),c=structuredClone(f.checkpoint),record=c.events[0].record as {workState:WorkState;sourceState:{active:Array<Record<string,unknown>>}};
  record.workState.objective="Unrelated accepted Goal";record.sourceState.active.find(item=>item.kind==="gai-work-state")!.state=record.workState;
  c.events[0].recordSha256=hash(record);f.replace(c);
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/AUTHORITY/);
});

for(const field of ["status","riskClass","childStatus","eventType"] as const)test(`array cannot impersonate the ${field} enum`,async()=>{
  const f=sharedFixture(),c=structuredClone(f.checkpoint),record=c.events[0].record as {workState:Record<string,unknown>;bridgeEvents:unknown[];sourceState:{active:Array<Record<string,unknown>>}};
  if(field==="status")record.workState.status=["NOT_STARTED"];
  if(field==="riskClass")record.workState.riskClass=["R1"];
  if(field==="childStatus")record.workState.childWorkItems=[{id:"child",objective:"fixture",definitionOfDone:[],affectedScope:[],executionApproach:"fixture",verificationMethod:"fixture",status:["NOT_STARTED"]}];
  if(field==="eventType"){
    record.bridgeEvents=[{id:"event",goalId:f.goalId,type:["IMPORTANT_UPDATE"],summary:"fixture",evidenceRefs:[],createdAt:"2026-01-01T00:00:00.000Z"}];
    record.sourceState.active.push({kind:"goriq-goal-bridge-events",version:1,events:record.bridgeEvents});
  }
  record.sourceState.active.find(item=>item.kind==="gai-work-state")!.state=record.workState;
  c.events[0].recordSha256=hash(record);f.replace(c);
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/AUTHORITY/);
});

test("a matching persisted lease and claim with the same elapsed expiry is rejected by time",async()=>{
  const f=sharedFixture();f.lease.leaseUntil="2026-01-02T00:00:00.000Z";f.replace(f.checkpoint);
  assert.equal((await f.store().load()).leaseUntil,f.lease.leaseUntil);
  assert.ok(Date.parse(f.lease.leaseUntil)<Date.now());
  await assert.rejects(createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"}),/CLAIM_INVALID/);
  assert.equal(f.rootWrites,0);
});

test("authority read cannot cross from a validated old lease to a new-epoch checkpoint",async()=>{
  const f=sharedFixture(),authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:"/tmp/fixture-authority"});
  let reads=0;f.interceptRootRead(()=>{if(++reads===2)f.replace(f.checkpoint,{...f.lease,epoch:2,coordinatorId:"fixture-B",fencingToken:"new-fence"});});
  await assert.rejects(authority.read(f.goalId),/CLAIM_INVALID/);assert.equal(f.rootWrites,0);
});

for(const operation of ["load","jobs","run","tasks","changes"] as const)test(`all fenced ${operation} reads bind the claim to the same checkpoint GET`,async()=>{
  const f=sharedFixture(),stores=f.stores();
  const authority=await createGitHubResidentExecutionAuthority({stores,authorityPath:"/tmp/fixture-authority"});
  let changed=false;f.interceptRootRead(()=>{if(!changed){changed=true;f.replace(f.checkpoint,{...f.lease,epoch:2,coordinatorId:"fixture-B",fencingToken:"new-fence"});}});
  const read=()=>operation==="load"?stores.load():operation==="jobs"?stores.developmentJobs.getByGoal(f.goalId):operation==="run"?stores.workRun.getByGoal(f.goalId):
    operation==="tasks"?stores.tasks.load():authority.persistence.changeSets.list();
  await assert.rejects(read(),/CLAIM_INVALID/);assert.equal(f.rootWrites,0);
});
