import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PersistentMemoryStore } from "../src/gai/memory-store.ts";
import { calculatePredictionError, PersistentWorldModel } from "../src/gai/world-model.ts";

async function withWorld(run: (world: PersistentWorldModel, memory: PersistentMemoryStore, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "gai-world-"));
  const memory = new PersistentMemoryStore(join(dir, "memory.json"));
  const world = new PersistentWorldModel(join(dir, "world.json"), memory);
  try {
    await run(world, memory, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("computes confidence-sensitive prediction error", () => {
  assert.equal(calculatePredictionError(
    { action: "deploy", expectedOutcome: "works", confidence: 0.9 },
    { actualOutcome: "failed", success: false, evidence: ["test"] },
  ), 0.9);
  assert.ok(Math.abs(calculatePredictionError(
    { action: "test", expectedOutcome: "passes", confidence: 0.8 },
    { actualOutcome: "passed", success: true, evidence: ["ci"] },
  ) - 0.2) < 1e-9);
});

test("persists prediction/observation events across restart", async () => {
  await withWorld(async (world, _memory, dir) => {
    await world.record({
      id: "e1",
      context: "mobile responsive layout",
      prediction: { action: "use fluid width", expectedOutcome: "no overflow", confidence: 0.8 },
      observation: { actualOutcome: "no overflow", success: true, evidence: ["visual test"] },
    });
    const restarted = new PersistentWorldModel(join(dir, "world.json"));
    const event = await restarted.get("e1");
    assert.equal(event?.observation.success, true);
    assert.ok(Math.abs((event?.predictionError ?? 0) - 0.2) < 1e-9);
  });
});

test("retrieves relevant prior outcomes", async () => {
  await withWorld(async (world) => {
    await world.record({ id: "mobile", context: "mobile responsive layout", prediction: { action: "fluid", expectedOutcome: "stable", confidence: 0.8 }, observation: { actualOutcome: "stable", success: true, evidence: ["a"] } });
    await world.record({ id: "db", context: "database migration", prediction: { action: "backup", expectedOutcome: "safe", confidence: 0.8 }, observation: { actualOutcome: "safe", success: true, evidence: ["b"] } });
    const result = await world.retrieve("fix mobile responsive overflow");
    assert.equal(result[0]?.id, "mobile");
  });
});

test("calibrates confidence from repeated evidence", async () => {
  await withWorld(async (world) => {
    for (let i = 0; i < 5; i += 1) {
      await world.record({
        id: `r${i}`,
        context: "typescript node test compatibility",
        prediction: { action: "use erasable types", expectedOutcome: "tests pass", confidence: 0.7 },
        observation: { actualOutcome: i < 4 ? "passed" : "failed", success: i < 4, evidence: ["ci"] },
      });
    }
    const stats = await world.stats("node typescript compatibility", "use erasable types");
    assert.equal(stats.samples, 5);
    assert.equal(stats.successRate, 0.8);
    assert.equal(stats.calibratedConfidence, 0.8);
  });
});

test("feeds verified outcomes into memory but does not promote failed rules", async () => {
  await withWorld(async (world, memory) => {
    await world.record({
      id: "success",
      context: "CI merge safety",
      prediction: { action: "run tests before merge", expectedOutcome: "regression caught", confidence: 0.9 },
      observation: { actualOutcome: "regression caught", success: true, evidence: ["CI failure"] },
    });
    assert.equal((await memory.get("world:success:semantic"))?.kind, "semantic");

    await world.record({
      id: "failure",
      context: "dependency guess",
      prediction: { action: "guess version", expectedOutcome: "build passes", confidence: 0.9 },
      observation: { actualOutcome: "build failed", success: false, evidence: ["build log"] },
    });
    assert.equal(await memory.get("world:failure:semantic"), null);
    assert.equal((await memory.get("world:failure:episodic"))?.kind, "episodic");
  });
});
