import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sharedFixture, hash } from "./fixtures/resident-shared-authority.ts";
import { createGitHubResidentExecutionAuthority } from "../scripts/goriq-github-resident-authority.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import type { DevelopmentGoalRuntime } from "../src/orchestrator/compass-goal-execution-adapter.ts";

test("existing adapter consumes shared authority without constructing a fallback Compass",async t=>{
  const root=mkdtempSync(join(tmpdir(),"shared-adapter-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,"not-a-compass.db"),f=sharedFixture();
  const authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:path});
  let calls=0;
  const runtime:DevelopmentGoalRuntime={matches:()=>true,async run(input){calls++;await input.assertExecutionAuthority!();return {cycles:[],stopReason:"blocked"};}};
  const result=await new CompassGoalExecutionAdapter(path,{}, {},{runtime,authority}).run(f.goalId);
  assert.equal(result.stopReason,"blocked");assert.equal(calls,1);assert.equal(existsSync(path),false);
});

test("shared adapter checks canonical pause and changed requirements after awaited work",async t=>{
  const root=mkdtempSync(join(tmpdir(),"shared-stop-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,"authority"),f=sharedFixture();
  const authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:path});
  const runtime:DevelopmentGoalRuntime={matches:()=>true,async run(input){
    const c=await f.store().loadCheckpoint(),current=await authority.read(f.goalId);
    const record={kind:"goriq-resident-authority-update-v1",goalId:f.goalId,goalContractDigest:c.goalContractDigest,
      previousRecordSha256:c.events[0].recordSha256,snapshot:{...current,control:{...current.control,status:"PAUSED"}}};
    c.events.push({eventId:"owner-pause",record,recordSha256:hash(record)});f.replace(c);
    await input.assertExecutionAuthority!();throw Error("unreachable");
  }};
  assert.equal((await new CompassGoalExecutionAdapter(path,{}, {},{runtime,authority}).run(f.goalId)).stopReason,"paused");
  assert.equal((await authority.read(f.goalId)).control.status,"PAUSED");
});

test("an explicitly shared adapter never delegates an unmatched runtime to the Compass loop",async t=>{
  const root=mkdtempSync(join(tmpdir(),"shared-no-fallback-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const f=sharedFixture(),path=join(root,"not-compass"),authority=await createGitHubResidentExecutionAuthority({stores:f.stores(),authorityPath:path});
  const runtime:DevelopmentGoalRuntime={matches:()=>false,async run(){assert.fail("unmatched runtime cannot execute");}};
  await assert.rejects(new CompassGoalExecutionAdapter(path,{}, {},{runtime,authority}).run(f.goalId),/SHARED_AUTHORITY_REQUIRES_RESIDENT_RUNTIME/);
  assert.equal(existsSync(path),false);
});
