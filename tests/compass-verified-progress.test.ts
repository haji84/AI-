import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassStateStoreAdapter } from "../src/orchestrator/compass-state-store.ts";
import type { WriteBackRecord } from "../src/orchestrator/goal-loop.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { WorkStateWriteBackStore, goalWorkStateId, type WorkStateActionResult } from "../src/orchestrator/work-state-integration.ts";

test("Compass completed work requires a successful verification, not only Builder success", async () => {
  const compass = new CompassStore(":memory:");
  try {
    compass.setGoal({ title: "Persist verified progress", successCriteria: ["Output is verified"] });
    const adapter = new CompassStateStoreAdapter(compass);
    const record: WriteBackRecord = {
      goal: { title: "Persist verified progress", successCriteria: ["Output is verified"], constraints: [] },
      intent: { summary: "verify output", confidence: 1, evidence: [] },
      action: { id: "build", description: "Build output", capability: "code.builder", risk: "low" },
      result: { actionId: "build", ok: true, summary: "Builder returned successfully" },
      stopReason: "continue",
    };
    await adapter.writeBack(record);
    assert.deepEqual(compass.getState().completed, [], "missing verifier cannot complete work");
    await adapter.writeBack({ ...record, verification: { ok: false, summary: "Output differs", evidence: ["readback:mismatch"] } });
    assert.deepEqual(compass.getState().completed, [], "failed verification cannot complete work");
    await adapter.writeBack({ ...record, verification: { ok: true, summary: "Output matches", evidence: ["readback:matched"] } });
    assert.deepEqual(compass.getState().completed, ["Build output"]);
    await adapter.writeBack({ ...record, verification: { ok: true, summary: "Output matches", evidence: ["readback:matched"] } });
    assert.deepEqual(compass.getState().completed, ["Build output"], "verified replay is not a second completion");
  } finally {
    compass.close();
  }
});

test("Builder-supplied DoD passes cannot bypass a missing or failed independent verifier", async () => {
  for (const verification of [undefined, { ok: false, summary: "independent check failed", evidence: ["verifier:fail"] }]) {
    for (const claim of [{ passed: true }, { passed: false, waived: true }]) {
    const compass = new CompassStore(":memory:");
    try {
      const goal = { title: "Verify claimed requirement", successCriteria: ["Output matches contract"], constraints: [] };
      compass.setGoal(goal);
      const work = new CompassWorkStateStoreAdapter(compass);
      const store = new WorkStateWriteBackStore(new CompassStateStoreAdapter(compass), work);
      const result: WorkStateActionResult = {
        actionId: "build", ok: true, summary: "Builder claims success",
        definitionOfDoneResults: [{ itemId: "criterion-1", ...claim, evidence: "builder assertion" }],
      };
      await store.writeBack({ goal, intent: { summary: "verify", confidence: 1, evidence: [] },
        action: { id: "build", capability: "code.builder", description: "Build", risk: "low" },
        result, verification, stopReason: "continue" });
      const state = await work.get(goalWorkStateId(goal));
      assert.ok(state);
      assert.notEqual(state.status, "COMPLETED");
      assert.equal(state.verificationResults.some(item => item.passed || item.waived), false);
      assert.deepEqual(compass.getState().completed, []);
    } finally { compass.close(); }
    }
  }
});
