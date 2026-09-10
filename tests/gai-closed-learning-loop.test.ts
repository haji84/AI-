import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PersistentBenchmarkHistory } from "../src/gai/benchmark-history.ts";
import { ClosedLearningLoop } from "../src/gai/closed-learning-loop.ts";
import { PersistentMemoryStore } from "../src/gai/memory-store.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import { PersistentWorldModel } from "../src/gai/world-model.ts";

async function withLoop(run: (input: {
  loop: ClosedLearningLoop;
  benchmark: PersistentBenchmarkHistory;
  memory: PersistentMemoryStore;
  world: PersistentWorldModel;
  skills: PersistentSkillLibrary;
  dir: string;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "gai-g4-"));
  try {
    const memory = new PersistentMemoryStore(join(dir, "memory.json"));
    const benchmark = new PersistentBenchmarkHistory(join(dir, "benchmark.json"));
    const skills = new PersistentSkillLibrary(join(dir, "skills.json"));
    const world = new PersistentWorldModel(join(dir, "world.json"), memory);
    const loop = new ClosedLearningLoop({ benchmark, memory, world, skills });
    await run({ loop, benchmark, memory, world, skills, dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function baseInput() {
  return {
    id: "run-1",
    taskId: "task-1",
    task: "fix responsive mobile layout",
    attempt: 1,
    split: "train" as const,
    actionId: "action-1",
    prediction: { action: "run responsive regression test", expectedOutcome: "layout passes", confidence: 0.8 },
    actualOutcome: "layout passes",
    success: true,
    evidence: ["visual regression passed"],
    verificationPassed: true,
    humanInterventionCount: 0,
    durationMs: 120,
    transferTask: true,
  };
}

test("verified success updates benchmark, world model and reusable memory", async () => {
  await withLoop(async ({ loop, benchmark, memory, world }) => {
    const result = await loop.process(baseInput());
    assert.equal(result.accepted, true);
    assert.equal(result.trainingApplied, true);
    assert.equal((await benchmark.list()).length, 1);
    assert.equal((await world.list()).length, 1);
    assert.ok(await memory.get("world:run-1:episodic"));
    assert.ok(await memory.get("world:run-1:semantic"));
    assert.ok(await memory.get("world:run-1:procedural"));
  });
});

test("verified failure is learned as evidence but not promoted as reusable rule", async () => {
  await withLoop(async ({ loop, memory, world }) => {
    const input = { ...baseInput(), id: "run-fail", success: false, actualOutcome: "layout still overflows" };
    const result = await loop.process(input);
    assert.equal(result.trainingApplied, true);
    assert.equal((await world.list()).length, 1);
    assert.ok(await memory.get("world:run-fail:episodic"));
    assert.equal(await memory.get("world:run-fail:semantic"), null);
    assert.equal(await memory.get("world:run-fail:procedural"), null);
  });
});

test("unverified or human-rejected outcomes never enter the learning stores", async () => {
  await withLoop(async ({ loop, benchmark, world }) => {
    assert.equal((await loop.process({ ...baseInput(), verificationPassed: false })).accepted, false);
    assert.equal((await loop.process({ ...baseInput(), id: "run-2", humanRejected: true })).accepted, false);
    assert.equal((await benchmark.list()).length, 0);
    assert.equal((await world.list()).length, 0);
  });
});

test("held-out outcomes are benchmarked but cannot train memory, world model, or skills", async () => {
  await withLoop(async ({ loop, benchmark, memory, world, skills }) => {
    await skills.upsert({
      id: "skill-1",
      name: "responsive regression",
      description: "verify responsive layout",
      procedure: "run responsive regression test",
      provenance: ["verified"],
      applicability: ["responsive", "mobile"],
      confidence: 0.8,
      successes: 0,
      failures: 0,
      status: "active",
    });
    const result = await loop.process({ ...baseInput(), split: "heldout", selectedSkillId: "skill-1" });
    assert.equal(result.reason, "heldout_recorded_only");
    assert.equal((await benchmark.list("heldout")).length, 1);
    assert.equal((await world.list()).length, 0);
    assert.equal((await skills.get("skill-1"))?.successes, 0);
    assert.equal((await memory.query()).length, 0);
  });
});

test("verified skill outcomes update skill confidence and counters", async () => {
  await withLoop(async ({ loop, skills }) => {
    await skills.upsert({
      id: "skill-1",
      name: "responsive regression",
      description: "verify responsive layout",
      procedure: "run responsive regression test",
      provenance: ["verified"],
      applicability: ["responsive"],
      confidence: 0.7,
      successes: 0,
      failures: 0,
      status: "active",
    });
    const result = await loop.process({ ...baseInput(), selectedSkillId: "skill-1" });
    assert.equal(result.skillUpdated, true);
    assert.equal((await skills.get("skill-1"))?.successes, 1);
  });
});

test("benchmark history persists and measures second-attempt improvement", async () => {
  await withLoop(async ({ loop, benchmark, dir }) => {
    await loop.process({ ...baseInput(), id: "attempt-1", success: false, actualOutcome: "failed" });
    await loop.process({ ...baseInput(), id: "attempt-2", attempt: 2, success: true, actualOutcome: "passed" });
    const improvement = await benchmark.attemptImprovement("task-1");
    assert.equal(improvement.improved, true);
    assert.equal(await benchmark.secondAttemptImprovementRate(), 1);

    const restarted = new PersistentBenchmarkHistory(join(dir, "benchmark.json"));
    assert.equal((await restarted.list()).length, 2);
    assert.equal((await restarted.summary()).successRate, 0.5);
  });
});
