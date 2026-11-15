import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { createCompassResidentExecutionAuthority } from "../src/orchestrator/compass-resident-execution-authority.ts";

test("Compass authority commits observed progress without changing canonical controls", async t => {
  const dir = mkdtempSync(join(tmpdir(), "resident-authority-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "compass.db"), db = new CompassStore(path);
  db.setGoal({ title: "fixture", description: "source only", successCriteria: ["verified"], constraints: [] });
  const goalId = goalWorkStateId(compassGoalToLoopGoal(db.getGoal()!));
  await new CompassWorkRunStore(db).put(createQueuedWorkRun(goalId));
  const authority = createCompassResidentExecutionAuthority({ compassPath: path });
  const before = await authority.read(goalId), next = structuredClone(before);
  next.run.phase = "RUNNING";
  await authority.commit(before, next);
  assert.equal((await authority.read(goalId)).run.phase, "RUNNING");
  const seen = await authority.read(goalId), weakened = structuredClone(seen);
  weakened.control.active = [{ invented: "authority" }];
  await assert.rejects(authority.commit(seen, weakened), /CONTROL_IMMUTABLE/);
  const stale = await authority.read(goalId);
  db.updateState({ status: "PAUSED", blockers: ["owner_stop"] });
  await assert.rejects(authority.commit(stale, { ...stale, run: { ...stale.run, phase: "COMPLETED" } }), /STALE|paused|project_paused/);
  assert.equal(db.getState().status, "PAUSED");
  assert.equal((await new CompassWorkRunStore(db).getByGoal(goalId))?.phase, "RUNNING");
  db.close();
});

test("Compass runtime cannot delete canonical WorkRun blockers or evidence",async t=>{
  const dir=mkdtempSync(join(tmpdir(),"resident-run-preserve-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,"compass.db"),db=new CompassStore(path);
  db.setGoal({title:"fixture",description:"source only",successCriteria:["verified"],constraints:[]});
  const goalId=goalWorkStateId(compassGoalToLoopGoal(db.getGoal()!)),runs=new CompassWorkRunStore(db);
  await runs.put({...createQueuedWorkRun(goalId),blockers:["owner-stop"],evidenceRefs:["retained-proof"]});
  const authority=createCompassResidentExecutionAuthority({compassPath:path});
  for(const field of ["blockers","evidenceRefs"] as const){const before=await authority.read(goalId),next=structuredClone(before);next.run[field]=[];
    await assert.rejects(authority.commit(before,next),/IMMUTABLE/);}
  assert.deepEqual((await runs.getByGoal(goalId))?.blockers,["owner-stop"]);
  assert.deepEqual((await runs.getByGoal(goalId))?.evidenceRefs,["retained-proof"]);db.close();
});
