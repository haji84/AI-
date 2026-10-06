import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CompassGoalExecutionAdapter, type CognitiveRuntimeOptions } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";
import { CognitiveStateStore } from "../src/gai/cognitive-state.ts";
import { loadCognitiveLocalOutcomes } from "../src/gai/cognitive-local-outcomes.ts";
import { createEvaluationMeasurement } from "../src/gai/cognitive-evaluation.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { LocalFileCapability } from "../src/orchestrator/local-file-capability.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";

const partition = { tenantId: "local", principalId: "owner" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "goriq-evaluation-"));
  const dbPath = join(root, "compass.db"), stateRoot = join(root, "state"), dataRoot = join(root, "data"), manifestPath = join(root, "outcomes.json");
  await mkdir(dataRoot);
  const db = new CompassStore(dbPath);
  const record = db.setGoal({ title: "Copy independently evaluated material", successCriteria: ["Copy equals source"], constraints: ["No external AI"] }); db.close();
  const goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
  const manifest = { version: 1, goalId, materials: [{ id: "input", path: "input.txt", format: "text", sha256: sha("42") }],
    outcomes: [{ id: "copy", materialId: "input", path: "output.txt", domain: "file", criteria: ["criterion-1"] }] };
  await writeFile(join(dataRoot, "input.txt"), "42"); await writeFile(manifestPath, JSON.stringify(manifest));
  const learning = new CognitiveLearningEngine(join(stateRoot, "learning"));
  const options: CognitiveRuntimeOptions = { useCore: true, stateRoot, partition, learning, environment: "evaluation-local", localOutcomes: { manifestPath, dataRoot }, evaluation: { id: "trial-one" } };
  const run = (opts = options, maxCycles = 3) => new CompassGoalExecutionAdapter(dbPath, {}, opts).run(goalId, { maxCycles });
  const ledger = async () => JSON.parse(await readFile(learning.partitionPath(partition, "experience.json"), "utf8"));
  const state = new CognitiveStateStore(stateRoot, partition);
  return { root, dbPath, dataRoot, manifestPath, goal, goalId, learning, options, run, ledger, state };
}
const ordinary = (options: CognitiveRuntimeOptions) => { const copy = { ...options }; delete copy.evaluation; return copy; };

test("actual Core allocates before effects and resumes immutable heldout observations", async () => {
  const f = await fixture(); try {
    await f.run(f.options, 1); const before = await f.state.get(f.goalId), data = await f.ledger();
    assert.match(before?.evaluation_plan_digest ?? "", /^[a-f0-9]{64}$/); assert.equal(data.evaluations.length, 1);
    await assert.rejects(readFile(join(f.dataRoot, "output.txt")), /ENOENT/);
    assert.equal((await new CognitiveService(f.dbPath, f.options).continue(f.goalId)).goalEvaluation?.achieved, true);
    assert.equal(await readFile(join(f.dataRoot, "output.txt"), "utf8"), "42");
    const after = await f.ledger(); assert.deepEqual(after.evaluations, data.evaluations); assert.equal(after.experiences.length, 2);
    for (const e of after.experiences) { assert.equal(e.split, "heldout"); assert.equal(e.verified, true); assert.equal(e.evaluation.planDigest, before?.evaluation_plan_digest); assert.deepEqual(e.materialSha256, [sha("42")]); }
    assert.deepEqual((await f.learning.recall({ partition, goalId: "new-goal", task: f.goal.title, environment: "evaluation-local" })).memories, []);
    await f.run(); assert.equal((await f.ledger()).experiences.length, 2);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("late allocation and changed or removed host plans are refused before output", async () => {
  for (const late of [true, false]) {
    const f = await fixture(); try {
      await f.run(late ? ordinary(f.options) : f.options, 1);
      if (late) await assert.rejects(f.run(), /evaluation.*history/i);
      else {
        await assert.rejects(f.run(ordinary(f.options)), /evaluation.*required/i);
        await assert.rejects(f.run({ ...f.options, evaluation: { id: "other-trial" } }), /evaluation.*conflict/i);
        const s = (await f.state.get(f.goalId))!;
        await assert.rejects(f.state.save({ ...s, evaluation_plan_digest: sha("changed") }, s.revision), /evaluation.*immutable/i);
        const removed = { ...s }; delete removed.evaluation_plan_digest;
        await assert.rejects(f.state.save(removed, s.revision), /evaluation.*immutable/i);
      }
      await assert.rejects(readFile(join(f.dataRoot, "output.txt")), /ENOENT/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
test("conflicting real output is a measured heldout failure and retains its actual failed hash", async () => {
  const f = await fixture(); try {
    await writeFile(join(f.dataRoot, "output.txt"), "owner existing content");
    assert.equal((await f.run()).goalEvaluation?.achieved, false);
    const failure = (await f.ledger()).experiences.find((e: { observation: { success: boolean } }) => !e.observation.success);
    assert.equal(failure.verified, true); assert.equal(failure.split, "heldout"); assert.equal(failure.evaluation.verifierOk, false);
    assert.equal(failure.evaluation.artifacts[1].actualSha256, sha("owner existing content"));
    assert.deepEqual(failure.evaluation.artifacts[1].checks, { persisted: true, hash: false, semantic: false });
    assert.equal(await readFile(join(f.dataRoot, "output.txt"), "utf8"), "owner existing content");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("receipt agrees with actual oracle bytes and rejects changed measured outcomes", async () => {
  const f = await fixture(); try {
    await f.run(); const data = await f.ledger(), e = data.experiences[1];
    const catalog = await loadCognitiveLocalOutcomes(f.manifestPath, f.dataRoot, f.goalId, f.goal);
    const action = catalog.evaluationDescriptor().candidates.find(c => c.id === e.actionId)!.action;
    const verifier = catalog.verifier({ async verify() { throw Error("unexpected fallback"); } }, true);
    const input = { goal: f.goal, action, result: { actionId: action.id, ok: true, summary: "untrusted claim" }, context: [] };
    assert.deepEqual(e.evaluation, createEvaluationMeasurement(data.evaluations[0], e.evaluation.actionFingerprint, true, await verifier.verify(input)));
    await writeFile(join(f.dataRoot, "output.txt"), "drift");
    assert.equal((await verifier.verify(input)).ok, false);
    e.observation.success = false;
    await writeFile(f.learning.partitionPath(partition, "experience.json"), JSON.stringify(data));
    await assert.rejects(new CognitiveLearningEngine(f.learning.directory).recall({ partition, goalId: "new", task: f.goal.title, environment: "evaluation-local" }), /evaluation.*receipt/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("review regression: failed oracle outcome cannot become success with an unchanged receipt", async () => {
  const f = await fixture(); try {
    await writeFile(join(f.dataRoot, "output.txt"), "occupied"); await f.run();
    const data = await f.ledger(), e = data.experiences.find((x: { observation: { success: boolean } }) => !x.observation.success);
    assert.ok(e.evaluation); e.observation.success = true;
    await writeFile(f.learning.partitionPath(partition, "experience.json"), JSON.stringify(data));
    await assert.rejects(new CognitiveLearningEngine(f.learning.directory).evaluationReservation(partition, f.goalId), /evaluation.*receipt/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("review regression: crash between reservation and state binding cannot revert to train execution", async () => {
  const f = await fixture(), save = CognitiveStateStore.prototype.save; try {
    let failed = false;
    CognitiveStateStore.prototype.save = async function(s, rev) { if (!failed && s.evaluation_plan_digest) { failed = true; throw Error("injected allocation crash"); } return save.call(this, s, rev); };
    await assert.rejects(f.run(), /injected allocation crash/);
    CognitiveStateStore.prototype.save = save;
    assert.equal((await f.ledger()).evaluations.length, 1); assert.equal((await f.state.get(f.goalId))?.attempts.length, 0);
    await assert.rejects(f.run(ordinary(f.options)), /evaluation.*required/i);
    await assert.rejects(readFile(join(f.dataRoot, "output.txt")), /ENOENT/);
    assert.equal((await f.run()).goalEvaluation?.achieved, true);
    assert.ok((await f.ledger()).experiences.every((e: { split: string }) => e.split === "heldout"));
  } finally { CognitiveStateStore.prototype.save = save; await rm(f.root, { recursive: true, force: true }); }
});
test("material/evidence reservations reject leakage, bad action receipts and legacy unknown sources", async () => {
  const f = await fixture(); try {
    await f.run(); const data = await f.ledger(), [e] = data.experiences;
    const train = { ...e, id: "train-copy", goalId: "another-goal", split: "train" }; delete train.evaluation;
    await assert.rejects(f.learning.observe(train), /heldout.*material/i);
    await assert.rejects(f.learning.observe({ ...train, materialSha256: [sha("other source")] }), /evaluation.*overlap/i);
    await assert.rejects(f.learning.observe({ ...e, id: "bad-action", evaluation: { ...e.evaluation, actionFingerprint: sha("fake") } }), /evaluation.*receipt/i);
    await assert.rejects(f.learning.allocateEvaluation({ ...data.evaluations[0], id: "new-trial", goalId: "new-goal" }), /evaluation.*overlap/i);
    const legacy = { ...train, evidenceRefs: ["legacy:oracle"] }; delete legacy.materialSha256;
    await f.learning.observe(legacy);
    await assert.rejects(f.learning.allocateEvaluation({ ...data.evaluations[0], id: "new-trial", goalId: "new-goal", materialSha256: [sha("new material")] }), /inconclusive legacy/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("authority crash recovers evaluated output by readback without repeated creation", async () => {
  const f = await fixture(), put = CompassWorkStateStoreAdapter.prototype.put, create = LocalFileCapability.prototype.createBytes;
  try {
    await f.run(f.options, 1); let creates = 0, injected = false;
    LocalFileCapability.prototype.createBytes = async function(...args) { creates++; return create.apply(this, args); };
    CompassWorkStateStoreAdapter.prototype.put = async function(state) { if (!injected && state.verificationResults.length) { injected = true; throw Error("injected authority crash"); } return put.call(this, state); };
    await assert.rejects(f.run(), /injected authority/); assert.ok((await f.state.get(f.goalId))?.pending_action);
    CompassWorkStateStoreAdapter.prototype.put = put;
    assert.equal((await f.run()).goalEvaluation?.achieved, true); assert.equal(creates, 1);
    assert.equal((await f.ledger()).experiences[1].split, "heldout");
  } finally { CompassWorkStateStoreAdapter.prototype.put = put; LocalFileCapability.prototype.createBytes = create; await rm(f.root, { recursive: true, force: true }); }
});
test("unmeasurable source drift and exhausted catalog cannot fabricate samples or leave an outbox", async () => {
  const f = await fixture(); try {
    await writeFile(join(f.dataRoot, "input.txt"), "source drift"); await f.run(); await f.run();
    assert.equal((await f.ledger()).experiences.filter((e: { verified: boolean }) => e.verified).length, 0);
    assert.equal((await f.state.get(f.goalId))?.learning_outbox, null);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
