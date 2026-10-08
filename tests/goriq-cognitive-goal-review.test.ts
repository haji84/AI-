import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CognitiveStateStore } from "../src/gai/cognitive-state.ts";
import { CognitiveLearningEngine, type CognitiveLearningExperience } from "../src/gai/cognitive-learning.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { createCognitiveGoalProxy } from "../src/orchestrator/cognitive-material-proxy.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "goriq-goal-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dbPath = join(root, "compass.sqlite"), dataRoot = join(root, "data"), stateRoot = join(root, "cognitive");
  await mkdir(dataRoot);
  const db = new CompassStore(dbPath);
  const record = db.setGoal({ title: "Preserve the supplied local material", description: "Owner's existing request", constraints: ["Local files only"] });
  db.close();
  const options = { stateRoot, materialIntake: { dataRoot } }, service = new CognitiveService(dbPath, options);
  const status = await service.status();
  const input = { goalId: status.goalId!, goalDigest: status.goalDigest!, successCriteria: ["The supplied bytes are available in the output"], acknowledgement: true as const };
  const read = () => { const c = new CompassStore(dbPath); try { return { goal: c.getGoal(), state: c.getState() }; } finally { c.close(); } };
  return { root, dbPath, dataRoot, stateRoot, record, options, service, status, input, read };
}
function workState(goalId: string): WorkState {
  return { goalId, objective: "Pending existing work", definitionOfDone: [], currentState: "awaiting execution", status: "IN_PROGRESS", riskClass: "R0",
    constraints: [], decisions: [], artifacts: [], verificationResults: [], childWorkItems: [], blockers: [], updatedAt: new Date().toISOString() };
}

test("restored empty Goal with an adoption receipt is not advertised as a fresh refinement", async t => {
  const f = await fixture(t);
  await f.service.refineGoal(f.input);
  const c = new CompassStore(f.dbPath); c.setGoal(f.record); c.close();
  const before = f.read();
  const restarted = new CognitiveService(f.dbPath, f.options);
  await assert.rejects(restarted.refineGoal(f.input), /review|existing/i);
  assert.deepEqual(f.read(), before);
  assert.equal((await restarted.status()).goalRefinementAvailable, false);
});

test("existing material receipt with restored empty criteria stays blocked in status and mutation", async t => {
  const f = await fixture(t);
  await f.service.refineGoal(f.input);
  const adopted = await f.service.status();
  await f.service.prepareMaterials({ goalId: adopted.goalId, goalDigest: adopted.goalDigest,
    materials: [{ format: "text", content: "42", criteria: ["criterion-1"] }], mappingAcknowledged: true });
  const c = new CompassStore(f.dbPath); c.setGoal(f.record); c.close();
  const before = f.read(), status = await f.service.status();
  await assert.rejects(f.service.refineGoal(f.input), /review|existing/i);
  assert.deepEqual(f.read(), before);
  assert.equal(status.mode, "DEGRADED");
  assert.equal(status.goalRefinementAvailable, false);
});

test("Goal refinement preserves standalone pending WorkState and standalone cognitive checkpoints", async t => {
  const first = await fixture(t), db = new CompassStore(first.dbPath);
  await new CompassWorkStateStoreAdapter(db).put(workState(first.input.goalId)); db.close();
  const firstBefore = first.read();
  await assert.rejects(first.service.refineGoal(first.input), /existing|pristine|review/i);
  assert.deepEqual(first.read(), firstBefore);
  assert.equal((await first.service.status()).goalRefinementAvailable, false);
  const second = await fixture(t);
  const state = new CognitiveStateStore(second.stateRoot, { tenantId: "local", principalId: "owner" });
  const checkpoint = await state.initialize(second.input.goalId, compassGoalToLoopGoal(second.record));
  const before = second.read();
  await assert.rejects(second.service.refineGoal(second.input), /existing|pristine|review/i);
  assert.deepEqual(second.read(), before);
  assert.deepEqual(await state.get(second.input.goalId), checkpoint);
  assert.equal((await second.service.status()).goalRefinementAvailable, false);
});

test("simultaneous distinct owner criteria choose one immutable adoption and keep original identity", async t => {
  const f = await fixture(t), other = new CognitiveService(f.dbPath, f.options);
  const second = { ...f.input, successCriteria: ["An independently chosen alternate explicit criterion"] };
  const results = await Promise.allSettled([f.service.refineGoal(f.input), other.refineGoal(second)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const final = f.read();
  assert.equal(final.goal!.id, f.record.id); assert.equal(final.goal!.title, f.record.title);
  assert.equal(final.goal!.description, f.record.description); assert.deepEqual(final.goal!.constraints, f.record.constraints);
  assert.equal(final.state.decisions.filter(v => v && typeof v === "object" && (v as { kind?: unknown }).kind === "goriq-cognitive-goal-refinement").length, 1);
  assert.deepEqual(final.goal!.successCriteria, results[0].status === "fulfilled" ? f.input.successCriteria : second.successCriteria);
});

test("a concurrent Compass work write between service inspection and CAS is retained and aborts adoption", async t => {
  const f = await fixture(t), original = CompassStore.prototype.adoptPristineGoalCriteria;
  let intervened = false;
  CompassStore.prototype.adoptPristineGoalCriteria = function (goal, state, criteria, receipt) {
    intervened = true;
    const other = new CompassStore(f.dbPath);
    other.updateState({ active: [...state.active, { kind: "concurrent-work", goalId: f.input.goalId, pending: true }] }); other.close();
    return original.call(this, goal, state, criteria, receipt);
  };
  try { await assert.rejects(f.service.refineGoal(f.input), /changed/i); }
  finally { CompassStore.prototype.adoptPristineGoalCriteria = original; }
  assert.equal(intervened, true);
  assert.deepEqual(f.read().goal, f.record);
  assert.equal(f.read().state.active.some(v => v && typeof v === "object" && (v as { kind?: unknown }).kind === "concurrent-work"), true);
  assert.equal(f.read().state.decisions.length, 0);
  assert.equal((await f.service.status()).busy, false);
});

test("Goal proxy authenticates before input access, bounds input, and never silently retries a mutation", async () => {
  let calls = 0;
  const broker = async () => { calls++; throw Error("simulated ambiguous transport failure"); };
  const denied = createCognitiveGoalProxy(async () => false, broker);
  const unreadable = new Request("http://localhost/api/jarvis/cognitive/goal");
  Object.defineProperty(unreadable, "body", { get() { throw Error("unauthenticated body was read"); } });
  assert.equal((await denied(unreadable)).status, 401); assert.equal(calls, 0);
  const proxy = createCognitiveGoalProxy(async () => true, broker);
  const input = { goalId: "goal-0123456789abcdef", goalDigest: "a".repeat(64), successCriteria: ["Explicit output"], acknowledgement: true };
  const request = (body: unknown) => new Request("http://localhost/api/jarvis/cognitive/goal", { method: "POST", body: JSON.stringify(body) });
  for (const extra of [{ root: "/" }, { permissions: ["all"] }, { receipt: {} }, { verified: true }]) assert.equal((await proxy(request({ ...input, ...extra }))).status, 400);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(32_001)); }, cancel() { cancelled = true; } });
  assert.equal((await proxy(new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit))).status, 400);
  assert.equal(cancelled, true); assert.equal(calls, 0);
  assert.equal((await proxy(request(input))).status, 503); assert.equal(calls, 1);
});

const learningPartition = { tenantId: "local", principalId: "owner" };
function orphanExperience(goalId: string, success: boolean, verified: boolean): CognitiveLearningExperience {
  return { id: "orphan-experience", partition: learningPartition, goalId, task: "Preserve local report", actionId: "attempted-local-work", strategyId: "local-strategy",
    environment: "local", prediction: { expectedOutcome: "Preserved source", confidence: 0.6 }, observation: { summary: "Earlier attempt remains on disk", success },
    verified, evidenceRefs: verified ? ["independent:previous-readback"] : [], source: "local-experiment", durationMs: 10, externalCalls: 0 };
}

for (const kind of ["successful", "failed", "unverified", "correction"] as const) test(`orphan ${kind} learning blocks criteria adoption without a checkpoint`, async t => {
  const f = await fixture(t), learning = new CognitiveLearningEngine(join(f.stateRoot, "learning"));
  if (kind === "correction") await learning.recordCorrection({ id: "orphan-correction", partition: learningPartition, goalId: f.input.goalId, task: "Preserve local report",
    environment: "local", originalActionId: "old-action", replacementActionId: "corrected-action", evidenceRefs: ["independent:correction-readback"], verified: true, scope: "preference" });
  else await learning.observe(orphanExperience(f.input.goalId, kind !== "failed", kind !== "unverified"));
  const path = learning.partitionPath(learningPartition, "experience.json"), bytes = await readFile(path), before = f.read();
  assert.equal(await new CognitiveStateStore(f.stateRoot, learningPartition).get(f.input.goalId), null);
  const restarted = new CognitiveService(f.dbPath, f.options);
  await assert.rejects(restarted.refineGoal(f.input), /existing|history|pristine|review/i);
  assert.deepEqual(f.read(), before);
  assert.deepEqual(await readFile(path), bytes);
  assert.equal((await restarted.status()).goalRefinementAvailable, false);
});

test("unrelated Goal and private tester learning do not block pristine owner criteria", async t => {
  const f = await fixture(t), learning = new CognitiveLearningEngine(join(f.stateRoot, "learning"));
  await learning.observe(orphanExperience("goal-0000000000000000", false, false));
  await learning.observe({ ...orphanExperience(f.input.goalId, true, true), partition: { tenantId: "local", principalId: "tester" } });
  assert.equal((await f.service.status()).goalRefinementAvailable, true);
  const result = await f.service.refineGoal(f.input);
  assert.equal(result.adopted, true);
  assert.deepEqual(f.read().goal!.successCriteria, f.input.successCriteria);
});

test("malformed orphan learning cannot be treated as absence during criteria adoption", async t => {
  const f = await fixture(t), learning = new CognitiveLearningEngine(join(f.stateRoot, "learning"));
  await learning.observe(orphanExperience(f.input.goalId, false, false));
  const path = learning.partitionPath(learningPartition, "experience.json");
  const corrupted = JSON.parse(await readFile(path, "utf8")); corrupted.experiences[0].partition.principalId = "different-principal";
  await writeFile(path, JSON.stringify(corrupted));
  const before = f.read(), bytes = await readFile(path);
  await assert.rejects(f.service.refineGoal(f.input), /partition|storage|learning/i);
  assert.deepEqual(f.read(), before);
  assert.deepEqual(await readFile(path), bytes);
});
