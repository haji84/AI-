import { OwnerRequirementIntake } from "../src/orchestrator/owner-requirement-intake.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { createQueuedWorkRun, workRunProgress } from "../src/orchestrator/work-run-state.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { GoalDrivenLoop } from "../src/orchestrator/goal-loop.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

test("pending adopted requirement blocks final Goal completion even when explicit planner supersedes prior state",async()=>{
 const db=new CompassStore(":memory:");try{
  const goal=compassGoalToLoopGoal(db.setGoal({title:"JARVIS",successCriteria:["done"]}));
  const intake=new OwnerRequirementIntake(db);
  intake.capture(intake.prepare("adopt","gate",{decision:"accept",statement:"unsynced requirement"}),goalWorkStateId(goal),[]);
  const loop=new GoalDrivenLoop({supersedesPriorExecutionState:true,async inferIntent(){return {summary:"done",confidence:1,evidence:[]};},async proposeNextAction(){return null;}},[],{async execute(){throw Error("must not execute");}},{async verify(){return {ok:true,summary:"done"};}},new CompassStateStoreAdapter(db));
  const result=await loop.runCycle({goal});assert.equal(result.stopReason,"blocked");assert.match(result.nextAction??"",/spec_sync/);
 }finally{db.close();}
});

test("completed jobs cannot show goal completion while adopted requirements are unsynced",async()=>{
 const db=new CompassStore(":memory:");try{
  const intake=new OwnerRequirementIntake(db);intake.capture(intake.prepare("adopt","progress",{decision:"accept",statement:"unsynced requirement"}),"g",[]);
  const store=new CompassWorkRunStore(db),run=createQueuedWorkRun("g");run.phase="COMPLETED";run.completedJobs=2;run.totalJobs=2;await store.put(run);
  const restored=await new CompassWorkRunStore(db).getByGoal("g");assert.equal(restored?.phase,"BLOCKED");assert.equal(workRunProgress(restored!).value,null);
 }finally{db.close();}
});
