import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

async function fixture(path=":memory:") {
 const { CompassApprovedNextWork }=await import("../src/orchestrator/approved-next-work.ts");
 const compass=new CompassStore(path),states=new CompassWorkStateStoreAdapter(compass),runs=new CompassWorkRunStore(compass);
 const predecessor=compass.setGoal({title:"Issue1219 actual model candidate and checks completed",description:"Issue1219 actual model candidate and checks completed",successCriteria:["candidate verified"],constraints:["preserve Human Gates"]});
 const goalId=goalWorkStateId(compassGoalToLoopGoal(predecessor));
 const work:WorkState={goalId,objective:predecessor.description,definitionOfDone:[{id:"criterion-1",description:"candidate verified",required:true}],currentState:"verified",status:"COMPLETED",riskClass:"R1",constraints:["preserve Human Gates"],decisions:[],artifacts:[],verificationResults:[{itemId:"criterion-1",passed:true,evidence:{kind:"explicit-test-fixture"}}],childWorkItems:[],blockers:[],nextAction:null,updatedAt:new Date().toISOString()};
 await states.put(work);await runs.put({...createQueuedWorkRun(goalId),phase:"COMPLETED"});
 let now=Date.now();const next=new CompassApprovedNextWork(compass,()=>new Date(now));
 const request={afterGoalId:goalId,taskScopeId:"issue:1218",text:"Issue1218 Owner login recovery: inspect the authorized next work",goalContract:{successCriteria:["Owner utility acceptance independently verified"],constraints:["source/context inspection only","no credentials or production operations"]},idempotencyKey:"original-owner-next-key",expiresAt:new Date(now+3600000).toISOString()};
 return {compass,states,runs,predecessor,goalId,work,next,request,setNow:(value:number)=>{now=value;}};
}

test("approved next work atomically archives verified predecessor without inheriting completion",async()=>{
 const f=await fixture();try{
 const before=f.compass.getState().active.find((x:unknown)=>(x as {kind?:string;goalId?:string}).kind==="gai-work-state"&&(x as {goalId?:string}).goalId===f.goalId);
 const accepted=f.next.accept(f.request),promoted=f.next.promote(accepted.id);assert.ok(promoted);
 assert.notEqual(promoted.targetGoalId,f.goalId);assert.equal(f.compass.getGoal()?.title,f.request.text.slice(0,120));
 const archive=f.compass.getState().active.find((x:unknown)=>(x as {kind?:string}).kind==="gai-retired-goal") as {record:unknown;goalId:string;successorGoalId:string};
 assert.deepEqual(archive.record,f.predecessor);assert.equal(archive.goalId,f.goalId);assert.equal(archive.successorGoalId,promoted.targetGoalId);
 assert.deepEqual(f.compass.getState().active.find((x:unknown)=>(x as {kind?:string;goalId?:string}).kind==="gai-work-state"&&(x as {goalId?:string}).goalId===f.goalId),before);
 assert.equal((await f.runs.getByGoal(f.goalId))?.phase,"COMPLETED");assert.equal(await f.states.get(promoted.targetGoalId),null);
 assert.equal(f.compass.getState().verificationSummary,null);assert.notEqual(f.compass.getState().status,"COMPLETED");
 }finally{f.compass.close();}
});

test("accepted successor deduplicates exact requests and rejects altered bindings without storing raw keys",async()=>{
 const f=await fixture();try{
 const a=f.next.accept(f.request),b=f.next.accept({...f.request});assert.equal(a.id,b.id);assert.equal(f.next.list().length,1);
 assert.throws(()=>f.next.accept({...f.request,text:"different next request"}),/IDEMPOTENCY/);
 assert.equal(JSON.stringify(f.compass.getState().active).includes(f.request.idempotencyKey),false);
 assert.throws(()=>f.next.accept({...f.request,sourceContext:{afterGoalId:f.goalId}}),/INVALID/);
 }finally{f.compass.close();}
});

for(const kind of ["pause","global-blocker","unverified","waived","unfinished-child","human-gate","wrong-goal"]){
 test(`successor holds ${kind} without changing predecessor`,async()=>{
 const f=await fixture();try{const a=f.next.accept(f.request);
 if(kind==="pause")f.compass.updateState({status:"PAUSED"});
 if(kind==="global-blocker")f.compass.updateState({blockers:["owner stop"]});
 if(kind==="unverified")await f.states.put({...f.work,status:"VERIFYING",verificationResults:[]});
 if(kind==="waived")await f.states.put({...f.work,verificationResults:[{itemId:"criterion-1",passed:false,waived:true,evidence:{kind:"fixture"}}]});
 if(kind==="unfinished-child")await f.states.put({...f.work,childWorkItems:[{id:"child",objective:"pending",status:"IN_PROGRESS",affectedScope:["source"],definitionOfDone:[{id:"child-check",description:"pending",required:true}],executionApproach:"inspect",verificationMethod:"test"}]});
 if(kind==="human-gate")await f.runs.put({...createQueuedWorkRun(f.goalId),phase:"HUMAN_GATE"});
 if(kind==="wrong-goal")f.compass.setGoal({title:"other authorized active Goal",successCriteria:["pending"]});
 const original=f.compass.getGoal();assert.equal(f.next.promote(a.id),null);assert.deepEqual(f.compass.getGoal(),original);
 assert.equal(f.next.list()[0]?.status,"QUEUED");
 }finally{f.compass.close();}
 });
}

test("expiry and same derived Goal identity never create a successor",async()=>{
 const f=await fixture();try{const a=f.next.accept(f.request);f.setNow(Date.parse(f.request.expiresAt));assert.equal(f.next.promote(a.id),null);
 assert.throws(()=>f.next.accept({...f.request,idempotencyKey:"expired"}),/EXPIRED/);
 const g=await fixture();try{assert.throws(()=>g.next.accept({...g.request,text:g.predecessor.description,goalContract:{successCriteria:["candidate verified"],constraints:["preserve Human Gates"]},idempotencyKey:"same"}),/SAME_GOAL|INVALID/);}finally{g.compass.close();}
 }finally{f.compass.close();}
});

test("promotion-before-intake survives process replacement without a second Goal or lost evidence",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"approved-next-restart-")),path=join(dir,"compass.sqlite");
 try{const f=await fixture(path),a=f.next.accept(f.request),first=f.next.promote(a.id);assert.ok(first);f.compass.close();
 const { CompassApprovedNextWork }=await import("../src/orchestrator/approved-next-work.ts");const c=new CompassStore(path);try{const next=new CompassApprovedNextWork(c),again=next.promote(a.id);assert.equal(again?.targetGoalId,first.targetGoalId);assert.equal(next.pending().length,1);assert.equal(c.getState().active.filter((x:unknown)=>(x as {kind?:string}).kind==="gai-retired-goal").length,1);
 next.started(a.id,first.targetGoalId);next.started(a.id,first.targetGoalId);assert.equal(next.pending().length,0);assert.equal(next.list()[0]?.status,"STARTED");
 }finally{c.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});

test("a stop committed on another SQLite connection immediately before promotion wins",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"approved-next-stop-")),path=join(dir,"compass.sqlite");
 try{const f=await fixture(path),a=f.next.accept(f.request),peer=new CompassStore(path);try{
 const original=f.compass.promoteGoal.bind(f.compass);f.compass.promoteGoal=(transform)=>{peer.updateState({status:"PAUSED"});return original(transform);};
 assert.equal(f.next.promote(a.id),null);assert.deepEqual(f.compass.getGoal(),f.predecessor);assert.equal(f.next.list()[0]?.status,"QUEUED");
 }finally{peer.close();f.compass.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});

test("a promoted but not yet submitted next instruction honors an owner pause",async()=>{
 const f=await fixture();try{const a=f.next.accept(f.request);assert.ok(f.next.promote(a.id));f.compass.updateState({status:"PAUSED"});assert.equal(f.next.promote(a.id),null);}finally{f.compass.close();}
});

test("equivalent criterion objects remain verified regardless of JSON property order",async()=>{
 const f=await fixture();try{await f.states.put({...f.work,definitionOfDone:[{required:true,description:"candidate verified",id:"criterion-1"}]});const a=f.next.accept(f.request);assert.ok(f.next.promote(a.id));}finally{f.compass.close();}
});

test("a historical target WorkRun cannot be inherited even when its WorkState is absent",async()=>{
 const f=await fixture();try{const a=f.next.accept(f.request);await f.runs.put({...createQueuedWorkRun(a.targetGoalId),phase:"COMPLETED"});assert.throws(()=>f.next.promote(a.id),/TARGET_ALREADY_EXISTS/);assert.deepEqual(f.compass.getGoal(),f.predecessor);}finally{f.compass.close();}
});

test("blocked, Human-required and unknown global control states never promote",async()=>{
 for(const status of ["BLOCKED","HUMAN_REQUIRED","unknown-control-state"]){const f=await fixture();try{const a=f.next.accept(f.request);f.compass.updateState({status});assert.equal(f.next.promote(a.id),null,status);}finally{f.compass.close();}}
});

test("new predecessor constraints and unknown evidence envelope versions stay unverified",async()=>{
 for(const change of ["constraints","work-version","run-version"]){const f=await fixture();try{const a=f.next.accept(f.request);
  if(change==="constraints")f.compass.setGoal({...f.predecessor,constraints:[...f.predecessor.constraints,"new owner condition"]});
  else f.compass.updateActive(active=>active.map(v=>v&&typeof v==="object"&&(v as {kind?:string}).kind===(change==="work-version"?"gai-work-state":"jarvis-work-runs")?{...v,version:2}:v));
  assert.equal(f.next.promote(a.id),null,change);
 }finally{f.compass.close();}}
});

test("the normal GoalLoop goal_complete write-back permits an already verified successor",async()=>{
 const f=await fixture();try{f.compass.writeBack({status:"goal_complete",summary:"Normal GoalLoop terminal record"});const a=f.next.accept(f.request);assert.ok(f.next.promote(a.id));}finally{f.compass.close();}
});

test("conflicting duplicate criterion results cannot trigger the next Goal",async()=>{
 const f=await fixture();try{const a=f.next.accept(f.request),work={...f.work,verificationResults:[{itemId:"criterion-1",passed:false,evidence:{kind:"failed-fixture"}},{itemId:"criterion-1",passed:true,evidence:{kind:"later-fixture"}}]};await f.states.put(work);assert.equal((await import("../src/orchestrator/work-state.ts")).canCompleteWorkState(work),false);assert.equal(f.next.promote(a.id),null);}finally{f.compass.close();}
});
test("an empty proof array cannot certify predecessor completion",async()=>{
 const f=await fixture();try{const a=f.next.accept(f.request);await f.states.put({...f.work,verificationResults:[{itemId:"criterion-1",passed:true,evidence:[]}]});assert.equal(f.next.promote(a.id),null);}finally{f.compass.close();}
});
test("outstanding WorkRun Human Gate blockers override its completed phase",async()=>{
 const f=await fixture();try{const a=f.next.accept(f.request);await f.runs.put({...createQueuedWorkRun(f.goalId),phase:"COMPLETED",blockers:["human_gate_required"]});assert.equal(f.next.promote(a.id),null);}finally{f.compass.close();}
});
