import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CognitiveMaterialIntake } from "../src/gai/cognitive-material-intake.ts";
import { cognitiveDigest } from "../src/gai/cognitive-state.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }, criteria = ["Source text is preserved"]) {
  const root = await mkdtemp(join(tmpdir(), "goriq-material-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, "data"), state = join(root, "state"), db = join(root, "compass.sqlite"); await mkdir(data); await mkdir(state);
  const compass = new CompassStore(db); const record = compass.setGoal({ title: "Preserve report", successCriteria: criteria }); compass.close();
  const goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
  const options = { stateRoot: state, partition: { tenantId: "review", principalId: "owner" }, materialIntake: { dataRoot: data } };
  const service = new CognitiveService(db, options);
  const input = { goalId, goalDigest: cognitiveDigest(goal), mappingAcknowledged: true,
    materials: [{ format: "text", content: "Source report text", criteria: ["criterion-1"] }] };
  return { root, data, state, db, goal, goalId, options, input, service,
    intake: new CognitiveMaterialIntake(state, data, options.partition) };
}

test("material staging refuses pre-existing symlink parent without writing outside root", async t => {
  const f = await fixture(t), outside = join(f.root, "outside"); await mkdir(outside);
  await symlink(outside, join(f.data, "goriq-materials"), "junction");
  await assert.rejects(f.service.prepareMaterials(f.input), /[Uu]nsafe/);
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await f.service.status()).materials, null);
});

test("material root or state symlink is refused before publishing source or receipt", async t => {
  const f = await fixture(t), outside = join(f.root, "outside"); await mkdir(outside);
  const linkedData = join(f.root, "linked-data"), linkedState = join(f.root, "linked-state");
  await symlink(outside, linkedData, "junction"); await symlink(outside, linkedState, "junction");
  for (const store of [new CognitiveMaterialIntake(f.state, linkedData, f.options.partition), new CognitiveMaterialIntake(linkedState, f.data, f.options.partition)]) {
    await assert.rejects(store.prepare(f.goalId, f.goal, f.input, async () => {}), /[Uu]nsafe/);
  }
  assert.deepEqual(await readdir(outside), []);
});

test("verified material download rejects modified output and modified source", async t => {
  const f = await fixture(t); const prepared = await f.service.prepareMaterials(f.input);
  assert.equal((await f.service.continue(f.goalId)).stopReason, "goal_complete");
  const bound = (await f.intake.load(f.goalId, f.goal))!;
  const source = join(f.data, bound.receipt.manifest.materials[0].path), output = join(f.data, bound.receipt.manifest.outcomes[0].path);
  const original = await readFile(output);
  await writeFile(output, "changed result");
  await assert.rejects(f.service.output(f.goalId, prepared.outputs[0].id), /verified|matches|changed/);
  await writeFile(output, original); await writeFile(source, "changed source");
  await assert.rejects(f.service.output(f.goalId, prepared.outputs[0].id), /verified|matches|changed/);
  await assert.rejects(f.service.prepareMaterials(f.input), /source changed/);
});

test("download cannot reuse previously verified IDs after root or Goal changes", async t => {
  const f = await fixture(t); const prepared = await f.service.prepareMaterials(f.input); await f.service.continue(f.goalId);
  const differentRoot = join(f.root, "other-data"); await mkdir(differentRoot);
  const changedRoot = new CognitiveService(f.db, { ...f.options, materialIntake: { dataRoot: differentRoot } });
  assert.equal((await changedRoot.status()).goalComplete, false);
  await assert.rejects(changedRoot.output(f.goalId, prepared.outputs[0].id), /root|verified|changed/i);
  const compass = new CompassStore(f.db); compass.setGoal({ title: "Preserve report", successCriteria: ["Additional rule"] }); compass.close();
  await assert.rejects(f.service.output(f.goalId, prepared.outputs[0].id), /Goal|goal/);
});

test("copying material for one criterion cannot complete another unsatisfied criterion", async t => {
  const f = await fixture(t, ["Source text is preserved", "Independent additional deliverable"]);
  await f.service.prepareMaterials(f.input); const report = await f.service.continue(f.goalId);
  assert.notEqual(report.stopReason, "goal_complete");
  assert.equal(report.goalEvaluation?.achieved, false);
  assert.equal((await f.service.status()).goalComplete, false);
});

test("material source and output symlinks remain blocked after a previously verified run", async t => {
  const f = await fixture(t); const prepared = await f.service.prepareMaterials(f.input); await f.service.continue(f.goalId);
  const bound = (await f.intake.load(f.goalId, f.goal))!;
  const output = join(f.data, bound.receipt.manifest.outcomes[0].path), outside = join(f.root, "outside");
  await mkdir(outside);
  const keyDirectory = join(f.data, "goriq-materials", (await readdir(join(f.data, "goriq-materials")))[0]);
  await rm(keyDirectory, { recursive: true, force: true });
  await symlink(outside, keyDirectory, "junction");
  await writeFile(join(outside, "source-1.txt"), f.input.materials[0].content);
  await writeFile(join(outside, "output-1.txt"), f.input.materials[0].content);
  assert.ok(output.includes("output-1.txt"));
  await assert.rejects(f.service.output(f.goalId, prepared.outputs[0].id), /verified|matches|[Ss]ymlink/);
});

test("service status does not create learning state through a symlink state root", async t => {
  const f = await fixture(t), outside = join(f.root, "outside-status"), linkedState = join(f.root, "linked-state-status");
  await mkdir(outside); await symlink(outside, linkedState, "junction");
  const service = new CognitiveService(f.db, { ...f.options, stateRoot: linkedState });
  await service.status().catch(() => undefined);
  assert.deepEqual(await readdir(outside), []);
});
