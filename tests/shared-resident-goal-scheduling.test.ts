import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedFixture, hash } from "./fixtures/resident-shared-authority.ts";
import { createGitHubResidentExecutionAuthority } from "../scripts/goriq-github-resident-authority.ts";
import { createBrokerResidentGoalScheduling } from "../src/orchestrator/resident-goal-scheduling.ts";
import { residentExecutorDecision } from "../src/orchestrator/resident-goal-executor.ts";
import type { DevelopmentGoalRuntime } from "../src/orchestrator/compass-goal-execution-adapter.ts";

test("existing Broker composition selects shared runner exclusively and deduplicates before awaited dispatch",async t=>{
  const root=mkdtempSync(join(tmpdir(),"shared-scheduling-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const f=sharedFixture(),authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:join(root,"authority")});
  let local=0,calls=0,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const runtime:DevelopmentGoalRuntime={matches:()=>true,async run(input){calls++;await gate;await input.assertExecutionAuthority!();return {cycles:[],stopReason:"blocked"};}};
  const scheduling=createBrokerResidentGoalScheduling({authority,dispatchLocal:async()=>{local++;}});
  assert.throws(()=>scheduling.schedule(residentExecutorDecision(f.goalId)),/SHARED_BINDING_REQUIRED/);
  scheduling.bindShared({authority,runtimeFor:async()=>runtime});
  const first=scheduling.schedule(residentExecutorDecision(f.goalId));
  const duplicate=await scheduling.schedule(residentExecutorDecision(f.goalId));
  assert.equal(duplicate,false);release();assert.equal(await first,true);
  assert.equal(calls,1);assert.equal(local,0);assert.equal((await authority.read(f.goalId)).run.phase,"BLOCKED");
});

for(const stop of ["pause","human","blocker","future","exhausted"] as const)
test(`shared Broker scheduling respects canonical ${stop} without local fallback`,async t=>{
  const root=mkdtempSync(join(tmpdir(),"shared-scheduling-stop-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const f=sharedFixture(),c=structuredClone(f.checkpoint),record=c.events[0].record as {sourceState:{status:string;blockers:string[];active:Array<{kind:string;runs?:unknown[]}>}};
  if(stop==="pause")record.sourceState.status="PAUSED";
  if(stop==="human")c.workRun.phase="HUMAN_GATE";
  if(stop==="blocker")record.sourceState.blockers=["owner-stop"];
  if(stop==="future")c.workRun.continuationWait={slices:1,retryAt:new Date(Date.now()+60000).toISOString()};
  if(stop==="exhausted")c.workRun.continuationWait={slices:20,retryAt:"2026-01-01T00:00:00.000Z"};
  record.sourceState.active.find(item=>item.kind==="jarvis-work-runs")!.runs=[c.workRun];
  c.events[0].recordSha256=hash(record);f.replace(c);
  const authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:join(root,"authority")});let local=0,calls=0;
  const scheduling=createBrokerResidentGoalScheduling({authority,dispatchLocal:async()=>{local++;}});
  scheduling.bindShared({authority,runtimeFor:async()=>({matches:()=>true,async run(){calls++;return {cycles:[],stopReason:"cycle_budget_exhausted"};}}),maxRuns:1});
  await scheduling.schedule(residentExecutorDecision(f.goalId));assert.equal(local,0);
  assert.equal(calls,stop==="exhausted"?1:0);
  if(stop==="exhausted")assert.deepEqual((await authority.read(f.goalId)).run.blockers,["goal_continuation_slice_limit"]);
});
