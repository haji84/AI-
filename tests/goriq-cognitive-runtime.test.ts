import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CognitiveLocalWorkCatalog } from "../src/gai/cognitive-local-work.ts";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
test("actual Compass factory completes local artifact through Core, persistence, verifier and learning without external AI", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-factory-"));
  try {
    const dbPath = join(root, "compass.db"), dataRoot = join(root, "data"), manifestPath = join(root, "plan.json");
    await mkdir(dataRoot);
    const compass = new CompassStore(dbPath);
    const record = compass.setGoal({ title: "Create the local result", successCriteria: ["Result file contains 42"], constraints: ["External AI disabled"] });
    const goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
    compass.close();
    await writeFile(manifestPath, JSON.stringify({ version: 1, goalId, steps: [{ id: "save-result", operation: "create", path: "result.txt", text: "42", expectedSha256: digest("42"), criteria: ["criterion-1"] }] }));
    const service = new CognitiveService(dbPath, { localWork: { manifestPath, dataRoot } });
    assert.equal((await service.status()).externalAIEnabled, false);
    const result = await service.continue(goalId);
    assert.equal(result.goalEvaluation?.achieved, true);
    assert.equal(result.stopReason, "goal_complete");
    assert.equal(await readFile(join(dataRoot, "result.txt"), "utf8"), "42");
    const restored = await new CognitiveService(dbPath).status();
    assert.equal(restored.attempts, 1);
    assert.equal(restored.metrics.completedGoals, 1);
    assert.equal(restored.metrics.externalAiCallsPerGoal, 0);
    assert.equal((await service.trainingCandidate()).train.length + (await service.trainingCandidate()).validation.length, 1);
    const second = await service.continue(goalId);
    assert.equal(second.stopReason, "goal_complete");
    assert.equal((await service.status()).attempts, 1);
    await assert.rejects(service.continue("goal-0000000000000000"), /mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("host catalog rejects escaping paths, secrets, invalid Goal criteria and model-defined tools", () => {
  const goal = { title: "Local result", successCriteria: ["42"], constraints: [] };
  const step = { id: "one", operation: "create" as const, path: "result.txt", text: "42", expectedSha256: digest("42"), criteria: ["criterion-1"] };
  for (const bad of [{ path: "../outside.txt" }, { path: ".env" }, { text: "secret=forbidden" }, { operation: "shell" }, { criteria: ["criterion-2"] }, { dependsOn: ["one"] }]) {
    assert.throws(() => new CognitiveLocalWorkCatalog(tmpdir(), { version: 1, goalId: "g", steps: [{ ...step, ...bad } as typeof step] }, "g", goal));
  }
});
test("shared execution lease fails visibly and never overwrites a foreign result", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-lease-"));
  try {
    const dbPath = join(root, "compass.db");
    const db = new CompassStore(dbPath);
    const record = db.setGoal({ title: "bounded observation", successCriteria: ["need evidence"] }); db.close();
    const goalId = goalWorkStateId(compassGoalToLoopGoal(record));
    await writeFile(dbPath + ".cognitive-run.lock", "existing-writer");
    const service = new CognitiveService(dbPath);
    await assert.rejects(service.continue(goalId), /EEXIST/);
    assert.equal(await readFile(dbPath + ".cognitive-run.lock", "utf8"), "existing-writer");
    assert.equal((await service.status()).busy, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("learning outage commits WorkState then replays the exact outbox without repeating the file action", async () => {
  const { CompassGoalExecutionAdapter } = await import("../src/orchestrator/compass-goal-execution-adapter.ts");
  const { CognitiveLearningEngine } = await import("../src/gai/cognitive-learning.ts");
  const { CognitiveStateStore } = await import("../src/gai/cognitive-state.ts");
  const root = await mkdtemp(join(tmpdir(), "goriq-outbox-"));
  try {
    const dbPath = join(root, "compass.db"), dataRoot = join(root, "data"), manifestPath = join(root, "plan.json"), stateRoot = join(root, "state");
    await mkdir(dataRoot);
    const db = new CompassStore(dbPath);
    const record = db.setGoal({ title: "Save a verified result despite learning outage", successCriteria: ["42 is saved"] }); db.close();
    const goalId = goalWorkStateId(compassGoalToLoopGoal(record)), partition = { tenantId: "local", principalId: "owner" };
    await writeFile(manifestPath, JSON.stringify({ version: 1, goalId, steps: [{ id: "save", operation: "create", path: "value.txt", text: "42", expectedSha256: digest("42"), criteria: ["criterion-1"] }] }));
    const learner = new CognitiveLearningEngine(join(stateRoot, "learning"));
    let unavailable = true;
    const bridge = { recall: learner.recall.bind(learner), complete: learner.complete.bind(learner),
      async observe(e: Parameters<typeof learner.observe>[0]) { if (unavailable) throw Error("temporary storage failure"); await learner.observe(e); } };
    const options = { stateRoot, learning: bridge, localWork: { manifestPath, dataRoot } };
    const first = await new CompassGoalExecutionAdapter(dbPath, {}, options).run(goalId, { maxCycles: 1 });
    assert.equal(first.goalEvaluation?.achieved, false);
    assert.ok(first.goalEvaluation?.blockers.includes("learning_write_pending"));
    const store = new CognitiveStateStore(stateRoot, partition);
    const pending = await store.get(goalId);
    assert.ok(pending?.learning_outbox);
    assert.ok(pending?.blockers.includes("learning_write_pending"));
    unavailable = false;
    const resumed = await new CompassGoalExecutionAdapter(dbPath, {}, options).run(goalId, { maxCycles: 2 });
    assert.equal(resumed.stopReason, "goal_complete");
    const flushed = await store.get(goalId);
    assert.equal(flushed?.learning_outbox, null);
    assert.equal(flushed?.attempts.length, 1);
    assert.equal((await learner.metrics(partition)).completedGoals, 1);
    assert.equal((await learner.exportVerifiedData(partition)).experiences[0].id, pending?.learning_outbox?.id);
  } finally { await rm(root, { recursive: true, force: true }); }
});
