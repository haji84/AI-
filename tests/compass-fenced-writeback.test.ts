import assert from "node:assert/strict";
import { test } from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassStateStoreAdapter } from "../src/orchestrator/compass-state-store.ts";

test("adapter commits only the current owner and rejects stale ownership", async () => {
  const store = new CompassStore(":memory:");
  try {
    const lease = store.executionLease();
    const old = lease.claim("goal", "mac", 100, 1000);
    const current = lease.claim("goal", "zbook", 100, 1100);
    const record = {
      goal: { title: "test", successCriteria: [], constraints: [] },
      intent: { summary: "verified", confidence: 1, evidence: [] },
      action: { id: "a", description: "done", capability: "test", risk: "low" as const },
      result: { actionId: "a", ok: true, summary: "done" },
      stopReason: "continue" as const,
    };
    const stale = new CompassStateStoreAdapter(store, undefined, () => lease.assertCurrent(old, 1101));
    await assert.rejects(stale.writeBack(record), /STALE_CLAIM/);
    assert.equal(store.getHistory().length, 0);
    const valid = new CompassStateStoreAdapter(store, undefined, () => lease.assertCurrent(current, 1101));
    await valid.writeBack(record);
    assert.equal(store.getHistory().length, 1);
    assert.deepEqual(store.getState().completed, ["done"]);
  } finally {
    store.close();
  }
});
