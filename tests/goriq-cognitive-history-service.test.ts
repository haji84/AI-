import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";

const partition = { tenantId: "local", principalId: "owner" };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "goriq-history-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dbPath = join(root, "compass.sqlite"), stateRoot = join(root, "cognitive"), dataRoot = join(root, "approved-history");
  await mkdir(dataRoot);
  const manifestPath = join(root, "history-manifest.json");
  const descriptor = { id: "decision-v1", path: "prior-decision.md", kind: "decision", familyId: "validation", classification: "internal", scope: "owner" };
  const content = "Historical claim: validate before changing a document.";
  await writeFile(join(dataRoot, descriptor.path), content);
  await writeFile(manifestPath, JSON.stringify({ version: 1, sources: [descriptor] }));
  const compass = new CompassStore(dbPath); const goal = compass.setGoal({ title: "Produce a verified local report", successCriteria: ["Report verified"] }); compass.close();
  const options = { stateRoot, partition, historyImport: { manifestPath, dataRoot } };
  return { root, dbPath, stateRoot, dataRoot, manifestPath, descriptor, content, goal, options, service: new CognitiveService(dbPath, options) };
}

test("history service requires explicit configuration and never imports while reading status", async t => {
  const f = await fixture(t);
  const disabled = new CognitiveService(f.dbPath, { stateRoot: f.stateRoot, partition });
  assert.equal((await disabled.status()).historyImportEnabled, false);
  await assert.rejects(disabled.importHistory(), /not configured/);
  assert.equal((await f.service.status()).historyImportEnabled, true);
  assert.equal((await f.service.status()).history.total, 0);
  await writeFile(f.manifestPath, "invalid manifest that status must never parse");
  assert.equal((await f.service.status()).history.total, 0);
  await assert.rejects(f.service.importHistory(), /JSON|Unexpected/);
  assert.equal((await f.service.status()).busy, false);
});

test("explicit history import survives service restart and exposes only counts in status", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.importHistory(), { imported: 1, existing: 0, total: 1 });
  const restarted = new CognitiveService(f.dbPath, f.options);
  const status = await restarted.status();
  assert.deepEqual(status.history, { total: 1, unverified: 1, verified: 0, sourceKinds: { decision: 1 } });
  for (const forbidden of [f.content, f.dataRoot, f.manifestPath, f.descriptor.path]) assert.equal(JSON.stringify(status).includes(forbidden), false);
  assert.deepEqual(await restarted.importHistory(), { imported: 0, existing: 1, total: 1 });
  assert.equal(status.goalComplete, false); assert.equal(status.attempts, 0); assert.equal(status.metrics.completedGoals, 0);
  const compass = new CompassStore(f.dbPath);
  try { assert.deepEqual(compass.getGoal(), f.goal); } finally { compass.close(); }
});

test("history service keeps unverified claims out of training while retaining real verified live examples", async t => {
  const f = await fixture(t); await f.service.importHistory();
  const initial = await f.service.trainingCandidate();
  assert.equal(initial.train.length + initial.validation.length + initial.heldout.length, 0);
  assert.deepEqual(initial.rejected, [{ id: "historical:decision-v1", reason: "independent_verification_required" }]);
  const learning = new CognitiveLearningEngine(join(f.stateRoot, "learning"));
  await learning.observe({ id: "live-check", partition, goalId: "goal-local", task: "Validate report output", actionId: "readback", strategyId: "independent-read", environment: "local",
    prediction: { expectedOutcome: "correct output", confidence: 0.8 }, observation: { summary: "readback passed", success: true }, verified: true,
    evidenceRefs: ["verifier:independent-artifact"], source: "deterministic", durationMs: 1, externalCalls: 0 });
  const merged = await new CognitiveService(f.dbPath, f.options).trainingCandidate();
  assert.equal(merged.train.length + merged.validation.length, 1);
  assert.equal([...merged.train, ...merged.validation][0].sourceKind, "verified-experience");
  assert.deepEqual(merged.rejected, initial.rejected);
  assert.equal(merged.training.automaticTraining, false);
  assert.equal((await f.service.status()).history.verified, 0);
});

test("failed history refresh preserves previous candidates and releases the service busy state", async t => {
  const f = await fixture(t); await f.service.importHistory();
  await writeFile(join(f.dataRoot, f.descriptor.path), "password=must-not-be-persisted");
  await assert.rejects(f.service.importHistory(), /credential/);
  const status = await f.service.status();
  assert.equal(status.busy, false); assert.equal(status.history.total, 1);
  assert.equal((await f.service.trainingCandidate()).rejected.length, 1);
  await writeFile(join(f.dataRoot, f.descriptor.path), f.content);
  assert.deepEqual(await f.service.importHistory(), { imported: 0, existing: 1, total: 1 });
});

test("history service uses host-bound principal isolation for status and training", async t => {
  const f = await fixture(t); await f.service.importHistory();
  const tester = new CognitiveService(f.dbPath, { ...f.options, partition: { tenantId: "local", principalId: "tester" } });
  assert.equal((await tester.status()).history.total, 0);
  assert.equal((await tester.trainingCandidate()).rejected.length, 0);
  await tester.importHistory();
  assert.equal((await tester.status()).history.total, 1);
  assert.equal((await f.service.status()).history.total, 1);
  const otherTenant = new CognitiveService(f.dbPath, { ...f.options, partition: { tenantId: "other", principalId: "owner" } });
  assert.equal((await otherTenant.status()).history.total, 0);
});
