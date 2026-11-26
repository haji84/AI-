import assert from "node:assert/strict";import test from "node:test";import{createQueuedWorkRun,workRunProgress,nextGoalContinuation,goalExecutionPhase,MAX_GOAL_CONTINUATION_SLICES,GOAL_CONTINUATION_DELAY_MS}from "../src/orchestrator/work-run-state.ts";
test("Work Run progress never invents percentage when plan size is unknown",()=>{const s=createQueuedWorkRun("goal-1","2026-01-01T00:00:00.000Z");assert.equal(s.phase,"QUEUED");assert.deepEqual(workRunProgress(s),{determinate:false,value:null});s.phase="RUNNING";s.totalJobs=4;s.completedJobs=1;assert.deepEqual(workRunProgress(s),{determinate:true,value:.25});s.phase="COMPLETED";assert.deepEqual(workRunProgress(s),{determinate:true,value:1});});

test("a bounded Goal execution chunk is resumable but never a completed or blocked Goal",()=>{
  assert.equal(goalExecutionPhase("goal_continuation_budget_exhausted"),"RUNNING");
  assert.equal(goalExecutionPhase("blocked"),"BLOCKED");
  assert.equal(goalExecutionPhase("retry_exhausted"),"BLOCKED");
  assert.equal(goalExecutionPhase("human_gate"),"HUMAN_GATE");
  assert.equal(goalExecutionPhase("goal_complete"),"COMPLETED");
  assert.equal(goalExecutionPhase("verification_wait"),"RUNNING");
});
test("Goal chunk checkpoint persists a bounded due time without consuming a resource retry",()=>{
 const now=new Date("2026-11-11T00:00:00.000Z");
 const first=nextGoalContinuation(undefined,now);
 assert.equal(first?.slices,1);
 assert.equal(Date.parse(first!.retryAt)-now.getTime(),GOAL_CONTINUATION_DELAY_MS);
 const second=nextGoalContinuation(first,new Date(now.getTime()+GOAL_CONTINUATION_DELAY_MS));
 assert.equal(second?.slices,2);
 const final={retryAt:new Date(now.getTime()+GOAL_CONTINUATION_DELAY_MS).toISOString(),slices:MAX_GOAL_CONTINUATION_SLICES};
 assert.equal(nextGoalContinuation(final,now),null,"the finite ceiling is a real stop, not an infinite spin");
 assert.throws(()=>nextGoalContinuation({retryAt:"invalid",slices:1},now),/invalid goal continuation/i);
});
