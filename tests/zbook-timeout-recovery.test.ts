import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";
import { recoverTimedOutGoal } from "../src/orchestrator/zbook-timeout-recovery.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

function state(goalId: string, blockers: string[]): WorkState {
  return { goalId, objective: "continue", definitionOfDone: [{ id: "criterion-1", description: "finish", required: true }], currentState: "", status: "BLOCKED", riskClass: "R1", constraints: [], decisions: [], artifacts: [], verificationResults: [], childWorkItems: [], blockers, nextAction: "retry", updatedAt: new Date().toISOString() };
}

test("confirmed coding timeout resumes the same durable run while preserving completion checks", async () => {
  const db = new CompassStore(":memory:");
  try {
    const runs = new CompassWorkRunStore(db);
    const work = new CompassWorkStateStoreAdapter(db);
    const run = { ...createQueuedWorkRun("goal-a"), phase: "BLOCKED" as const, blockers: ["blocked"] };
    await runs.put(run);
    await work.put(state("goal-a", ["http_code_builder_error"]));
    db.updateState({ blockers: ["http_code_builder_error"], nextAction: "Builder timed out" });
    const result = await recoverTimedOutGoal(db, "goal-a", { timeoutConfirmed: true });
    assert.equal(result, "RECOVERED");
    assert.equal((await runs.getByGoal("goal-a"))?.runId, run.runId);
    assert.equal((await runs.getByGoal("goal-a"))?.phase, "QUEUED");
    assert.equal((await work.get("goal-a"))?.definitionOfDone.length, 1);
    assert.equal((await work.get("goal-a"))?.status, "IN_PROGRESS");
    assert.deepEqual(db.getState().blockers, []);
    assert.equal(await recoverTimedOutGoal(db, "goal-a", { timeoutConfirmed: true }), "ALREADY_QUEUED");
  } finally { db.close(); }
});

test("missing timeout proof and human/security blockers remain stopped", async () => {
  for (const [blockers, confirmed] of [[ ["http_code_builder_error"], false ], [ ["http_code_builder_error", "human_required"], true ], [ ["spec_sync_pending"], true ]] as const) {
    const db = new CompassStore(":memory:");
    try {
      const runs = new CompassWorkRunStore(db);
      const work = new CompassWorkStateStoreAdapter(db);
      await runs.put({ ...createQueuedWorkRun("goal-a"), phase: "BLOCKED", blockers: ["blocked"] });
      await work.put(state("goal-a", [...blockers]));
      db.updateState({ blockers: [...blockers] });
      await assert.rejects(recoverTimedOutGoal(db, "goal-a", { timeoutConfirmed: confirmed }));
      assert.equal((await runs.getByGoal("goal-a"))?.phase, "BLOCKED");
      assert.equal((await work.get("goal-a"))?.status, "BLOCKED");
      assert.deepEqual(db.getState().blockers, [...blockers]);
    } finally { db.close(); }
  }
});

test("partially recovered timeout clears only the stale Compass blocker and keeps the same run", async () => {
  const db = new CompassStore(":memory:");
  try {
    const runs = new CompassWorkRunStore(db);
    const work = new CompassWorkStateStoreAdapter(db);
    await runs.put({ ...createQueuedWorkRun("goal-a"), phase: "BLOCKED", blockers: ["blocked"] });
    await work.put({ ...state("goal-a", []), status: "IN_PROGRESS" });
    db.updateState({ blockers: ["http_code_builder_error"] });
    assert.equal(await recoverTimedOutGoal(db, "goal-a", { timeoutConfirmed: true }), "RECOVERED");
    assert.equal((await runs.getByGoal("goal-a"))?.phase, "QUEUED");
    assert.deepEqual(db.getState().blockers, []);
  } finally { db.close(); }
});

test("orphaned RUNNING work resumes on Broker startup without creating another run", async () => {
  const db = new CompassStore(":memory:");
  try {
    const runs = new CompassWorkRunStore(db);
    const work = new CompassWorkStateStoreAdapter(db);
    const existing = { ...createQueuedWorkRun("goal-a"), phase: "RUNNING" as const };
    await runs.put(existing);
    await work.put({ ...state("goal-a", []), status: "IN_PROGRESS" });
    assert.equal(await recoverTimedOutGoal(db, "goal-a", { timeoutConfirmed: true }), "RESUME_ON_STARTUP");
    assert.deepEqual(await runs.getByGoal("goal-a"), existing);
  } finally { db.close(); }
});
