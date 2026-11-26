import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalDecisionStoreAdapter, CompassSharedContextStoreAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { CompassGoalBridgeEventStore } from "../src/orchestrator/compass-goal-bridge-event-store.ts";
import { CompassGoalExecutionContextStore } from "../src/orchestrator/compass-goal-execution-context-store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { CompassApprovedNextWork } from "../src/orchestrator/approved-next-work.ts";
import { normalizeIntake, type GoalControllerDecision } from "../src/orchestrator/goal-controller-runtime.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

const kinds=["work-run","decision","shared-context","event-append","event-delivery","execution-context"] as const;
type Kind=typeof kinds[number];
const decision=(id:string):GoalControllerDecision=>({action:"ANSWER",resolution:{kind:"NO_GOAL",intent:"QUESTION",reason:"fixture",intake:normalizeIntake({source:"jarvis",text:"fixture question "+id+"?",idempotencyKey:id})}});
const context=(id:string)=>({id,type:"INSPECTION" as const,source:"jarvis" as const,summary:id,status:"ACTIVE" as const,createdAt:new Date().toISOString()});
const event=(id:string,goalId:string)=>({id,goalId,type:"IMPORTANT_UPDATE" as const,summary:id,evidenceRefs:[],createdAt:new Date().toISOString()});
async function mutate(store:CompassStore,kind:Kind,goalId:string,peer=false){
 const id=peer?"peer":"writer";
 if(kind==="work-run")return new CompassWorkRunStore(store).put({...createQueuedWorkRun(peer?"peer-history":goalId),phase:"COMPLETED",currentWork:id});
 if(kind==="decision")return new CompassGoalDecisionStoreAdapter(store).put(id,decision(id));
 if(kind==="shared-context")return new CompassSharedContextStoreAdapter(store).put(context(id));
 if(kind==="event-append"||peer&&kind==="event-delivery")return new CompassGoalBridgeEventStore(store).append(event(id,goalId));
 if(kind==="event-delivery")return new CompassGoalBridgeEventStore(store).markDelivered("seed",new Date().toISOString());
 return new CompassGoalExecutionContextStore(store).put(peer?"peer-history":goalId,[{summary:id}]);
}
async function assertPeerHistory(store:CompassStore,kind:Kind,goalId:string){
 if(kind==="work-run")assert.equal((await new CompassWorkRunStore(store).getByGoal("peer-history"))?.currentWork,"peer");
 else if(kind==="decision")assert.equal((await new CompassGoalDecisionStoreAdapter(store).get("peer"))?.action,"ANSWER");
 else if(kind==="shared-context")assert.ok((await new CompassSharedContextStoreAdapter(store).list()).some(r=>r.id==="peer"));
 else if(kind==="event-append"||kind==="event-delivery"){
  const pending=await new CompassGoalBridgeEventStore(store).pending(goalId);assert.ok(pending.some(e=>e.id==="peer"));
  if(kind==="event-delivery")assert.ok(!pending.some(e=>e.id==="seed"));
 }else assert.deepEqual(new CompassGoalExecutionContextStore(store).get("peer-history"),[{summary:"peer"}]);
}

if(process.argv[2]==="--peer-writer"){
 const [, , ,path,kind,goalId]=process.argv;assert.ok(kinds.includes(kind as Kind));
 const store=new CompassStore(path!);
 try{
  await mutate(store,kind as Kind,goalId!,true);
  const queue=new CompassApprovedNextWork(store),accepted=queue.accept({afterGoalId:goalId!,taskScopeId:"issue:1218",text:"Inspect approved next source fixture",goalContract:{successCriteria:["source inspected"],constraints:["no credential or production operations"]},idempotencyKey:"peer-accepted-next",expiresAt:new Date(Date.now()+3600000).toISOString()});
  const promoted=queue.promote(accepted.id);assert.ok(promoted);
  store.updateState({status:"PAUSED"});
  process.stdout.write(JSON.stringify({targetGoalId:promoted.targetGoalId,handoffId:accepted.id}));
 }finally{store.close();}
}else{
 for(const kind of kinds)test(`${kind} preserves another process's next-work promotion and same-envelope history`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),"atomic-compass-writer-")),path=join(directory,"state.sqlite"),store=new CompassStore(path);
  try{
   const predecessor=store.setGoal({title:"Verified predecessor fixture",description:"Verified predecessor fixture",successCriteria:["fixture checked"],constraints:[]});
   const goalId=goalWorkStateId(compassGoalToLoopGoal(predecessor));
   const work:WorkState={goalId,objective:predecessor.description,definitionOfDone:[{id:"criterion-1",description:"fixture checked",required:true}],currentState:"checked",status:"COMPLETED",riskClass:"R1",constraints:[],decisions:[],artifacts:[],verificationResults:[{itemId:"criterion-1",passed:true,evidence:{kind:"explicit-test-fixture"}}],childWorkItems:[],blockers:[],nextAction:null,updatedAt:new Date().toISOString()};
   await new CompassWorkStateStoreAdapter(store).put(work);await new CompassWorkRunStore(store).put({...createQueuedWorkRun(goalId),phase:"COMPLETED"});
   if(kind==="event-delivery")await new CompassGoalBridgeEventStore(store).append(event("seed",goalId));
   let peer:{targetGoalId:string;handoffId:string}|undefined;
   // A real second process commits immediately before this writer's mutation
   // boundary. Atomic writers read their envelope only after taking that lock;
   // stale read/modify/write adapters erase the just-committed peer data.
   const beforeMutation=()=>{
    if(peer)return;
    const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url),"--peer-writer",path,kind,goalId],{encoding:"utf8",timeout:15000});
    assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);peer=JSON.parse(run.stdout);
   };
   const stateUpdate=store.updateState.bind(store),activeUpdate=store.updateActive.bind(store);
   store.updateState=input=>{beforeMutation();return stateUpdate(input);};
   store.updateActive=transform=>{beforeMutation();return activeUpdate(transform);};
   await mutate(store,kind,goalId);
   assert.ok(peer);assert.equal(goalWorkStateId(compassGoalToLoopGoal(store.getGoal()!)),peer.targetGoalId);
   assert.equal(store.getState().status,"PAUSED");
   const queue=new CompassApprovedNextWork(store);assert.equal(queue.list().length,1,"Accepted next-work metadata must survive ordinary state writes");assert.equal(queue.list()[0]?.id,peer.handoffId);
   const archive=store.getState().active.find(v=>!!v&&typeof v==="object"&&(v as {kind?:string}).kind==="gai-retired-goal") as {record:unknown}|undefined;
   assert.deepEqual(archive?.record,predecessor,"Retired Goal metadata cannot be erased by a late normal writer");
   assert.deepEqual(await new CompassWorkStateStoreAdapter(store).get(goalId),work);
   assert.equal(await new CompassWorkStateStoreAdapter(store).get(peer.targetGoalId),null);
   await assertPeerHistory(store,kind,goalId);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
 });
}
