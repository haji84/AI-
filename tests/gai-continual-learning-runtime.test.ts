import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinualLearningRuntime, type ContinualLearningCandidate } from "../src/gai/continual-learning-runtime.ts";

async function runtime() {
  const dir = await mkdtemp(join(tmpdir(), "gai-cl-"));
  return { file: join(dir, "ledger.json"), runtime: new ContinualLearningRuntime(join(dir, "ledger.json")) };
}

const base: ContinualLearningCandidate = {
  id: "c1", sourceOutcomeIds: ["o1", "o2"], verified: true, split: "train",
  baselinePassRate: 0.7, candidatePassRate: 0.8, transferDelta: 0.1,
  forgettingDelta: 0, safetyRegression: false, humanInterventionDelta: 0,
  additionalApiCostUsd: 0,
};

test("promotes only verified measurable zero-cost gain", async () => {
  const { runtime: r } = await runtime();
  assert.equal((await r.evaluate(base)).decision, "promote");
});

test("heldout evidence is recorded but never trains", async () => {
  const { runtime: r } = await runtime();
  assert.equal((await r.evaluate({ ...base, id: "h", split: "heldout" })).decision, "record-only");
});

test("regression or forgetting forces rollback", async () => {
  const { runtime: r } = await runtime();
  assert.equal((await r.evaluate({ ...base, id: "r", candidatePassRate: 0.6 })).decision, "rollback");
  assert.equal((await r.evaluate({ ...base, id: "f", forgettingDelta: 0.01 })).decision, "rollback");
});

test("learning cannot weaken Human Gate or risk ceiling", async () => {
  const { runtime: r } = await runtime();
  const result = await r.evaluate({ ...base, id: "g", weakensHumanGate: true });
  assert.equal(result.decision, "reject");
  assert.ok(result.reasons.includes("governance_weakening_forbidden"));
});

test("ledger survives restart and preserves provenance", async () => {
  const { file, runtime: r } = await runtime();
  await r.evaluate(base);
  const restarted = new ContinualLearningRuntime(file);
  const records = await restarted.list();
  assert.equal(records.length, 1);
  assert.deepEqual(records[0]?.provenance, ["o1", "o2"]);
});
