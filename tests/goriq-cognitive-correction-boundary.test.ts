import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CognitiveStateStore, type CognitiveAttempt } from "../src/gai/cognitive-state.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";
import { acquireCognitiveLease } from "../src/gai/cognitive-lease.ts";

const partition = { tenantId: "local", principalId: "owner" };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "goriq-correction-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dbPath = join(root, "compass.sqlite"), stateRoot = join(root, "cognitive");
  const db = new CompassStore(dbPath);
  const record = db.setGoal({ title: "Correct a local strategy", successCriteria: ["The local result matches supplied evidence"] }); db.close();
  const goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
  const store = new CognitiveStateStore(stateRoot, partition), initial = await store.initialize(goalId, goal);
  const original: CognitiveAttempt = { id: "original-attempt", actionId: "original-action", strategyId: "strategy-a", environment: "local", source: "deterministic",
    expectedOutcome: "A correct local result", confidence: 0.5, observed: "Result did not match evidence", success: false, verified: false,
    evidenceRefs: ["verifier:failed-readback"], predictionError: 1, at: new Date().toISOString() };
  const replacement: CognitiveAttempt = { ...original, id: "replacement-attempt", actionId: "replacement-action", strategyId: "strategy-b",
    observed: "Independent readback matched evidence", success: true, verified: true, evidenceRefs: ["verifier:independent-readback"], predictionError: 0 };
  await store.save({ ...initial, attempts: [original, replacement] }, initial.revision);
  const service = new CognitiveService(dbPath, { stateRoot, partition });
  const learning = new CognitiveLearningEngine(join(stateRoot, "learning"));
  const correct = () => service.correct(goalId, original.id, replacement.id);
  const corrections = async () => (await learning.exportVerifiedData(partition)).corrections;
  return { root, dbPath, stateRoot, goal, goalId, store, service, correct, corrections };
}

test("correction rejects criteria drift under the same Goal ID before learning persistence", async t => {
  const f = await fixture(t);
  const db = new CompassStore(f.dbPath);
  const changed = db.setGoal({ title: f.goal.title, successCriteria: ["A different result must now be produced"] }); db.close();
  assert.equal(goalWorkStateId(compassGoalToLoopGoal(changed)), f.goalId);
  assert.ok((await f.service.status()).blockers.length > 0);
  await assert.rejects(f.correct(), /Goal|goal|contract|replan|changed/i);
  assert.equal((await f.corrections()).length, 0);
  assert.equal((await f.service.status()).busy, false);
});

test("correction respects the shared execution lease held by another runtime", async t => {
  const f = await fixture(t), release = await acquireCognitiveLease(f.dbPath + ".cognitive-run.lock");
  try { await assert.rejects(f.correct(), /EEXIST|lease|lock|running/i); }
  finally { await release(); }
  assert.equal((await f.corrections()).length, 0);
  assert.equal((await f.service.status()).busy, false);
});

test("correction fails closed when its persisted execution contract is no longer configured", async t => {
  const f = await fixture(t), checkpoint = (await f.store.get(f.goalId))!;
  await f.store.save({ ...checkpoint, execution_contract_digest: "a".repeat(64) }, checkpoint.revision);
  await assert.rejects(f.correct(), /contract|configuration|configured|replan|changed/i);
  assert.equal((await f.corrections()).length, 0);
});

test("correction of the current verified attempt is persisted once and releases its execution lease", async t => {
  const f = await fixture(t);
  const accepted = await f.correct(); assert.equal(accepted.accepted, true);
  assert.deepEqual(await f.correct(), accepted);
  const rows = await f.corrections(); assert.equal(rows.length, 1);
  assert.equal(rows[0].originalActionId, "original-action"); assert.equal(rows[0].replacementActionId, "replacement-action");
  assert.deepEqual(rows[0].evidenceRefs, ["verifier:independent-readback"]);
  const release = await acquireCognitiveLease(f.dbPath + ".cognitive-run.lock"); await release();
  assert.equal((await f.service.status()).busy, false);
});
