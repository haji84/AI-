import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { learnFromOutcome } from "../src/gai/learning.ts";
import { PersistentMemoryStore } from "../src/gai/memory-store.ts";
import { loadGaiMemoryContext } from "../src/orchestrator/gai-memory-context.ts";

async function withStore(run: (store: PersistentMemoryStore, file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "gai-memory-"));
  const file = join(dir, "memory.json");
  try {
    await run(new PersistentMemoryStore(file), file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("persists CRUD across store restarts", async () => {
  await withStore(async (store, file) => {
    await store.upsert({ id: "w1", kind: "working", content: "finish G1 memory", confidence: 1, source: "goal", tags: ["g1"] });
    assert.equal((await store.get("w1"))?.content, "finish G1 memory");

    const restarted = new PersistentMemoryStore(file);
    assert.equal((await restarted.get("w1"))?.source, "goal");
    assert.equal(await restarted.remove("w1"), true);
    assert.equal(await restarted.get("w1"), null);
  });
});

test("keeps all four memory kinds distinct and replaces working set only", async () => {
  await withStore(async (store) => {
    await store.upsert({ id: "e1", kind: "episodic", content: "test passed", confidence: 0.8 });
    await store.upsert({ id: "s1", kind: "semantic", content: "verified tests reduce regression risk", confidence: 0.9 });
    await store.upsert({ id: "p1", kind: "procedural", content: "run tests before merge", confidence: 0.9 });
    await store.replaceWorkingSet([{ id: "w1", kind: "working", content: "old", confidence: 1 }]);
    await store.replaceWorkingSet([{ id: "w2", kind: "working", content: "new", confidence: 1 }]);

    assert.equal((await store.get("w1")), null);
    assert.equal((await store.query({ kinds: ["working"] }))[0]?.id, "w2");
    assert.equal((await store.get("e1"))?.kind, "episodic");
    assert.equal((await store.get("s1"))?.kind, "semantic");
    assert.equal((await store.get("p1"))?.kind, "procedural");
  });
});

test("retrieves by relevance, kind, confidence and provenance", async () => {
  await withStore(async (store) => {
    await store.upsert({ id: "a", kind: "semantic", content: "responsive layout prevents mobile overflow", source: "visual-test", confidence: 0.9, tags: ["mobile"] });
    await store.upsert({ id: "b", kind: "semantic", content: "database migration notes", source: "db-test", confidence: 0.95, tags: ["database"] });
    await store.upsert({ id: "c", kind: "episodic", content: "responsive failure", source: "unverified", confidence: 0.2, tags: ["mobile"] });

    const result = await loadGaiMemoryContext(store, { task: "fix mobile responsive layout", kinds: ["semantic"], minConfidence: 0.5 });
    assert.equal(result[0]?.id, "a");
    assert.equal(result[0]?.source, "visual-test");
    assert.ok(result[0]?.lastUsedAt);
  });
});

test("promotes only successful evidence-backed learning into reusable memory", async () => {
  await withStore(async (store) => {
    const success = learnFromOutcome(
      { action: "run regression tests before merge", expectedOutcome: "regressions are caught", confidence: 0.8 },
      { actualOutcome: "regression caught", success: true, evidence: ["node:test failed as expected"] },
    );
    const promoted = await store.promoteLearning(success, "learn-1", "ci");
    assert.deepEqual(promoted.map((item) => item.kind), ["episodic", "semantic", "procedural"]);
    assert.match((await store.get("learn-1:semantic"))?.source ?? "", /learn-1:episodic/);

    const failed = learnFromOutcome(
      { action: "guess dependency version", expectedOutcome: "build passes", confidence: 0.9 },
      { actualOutcome: "build failed", success: false, evidence: ["build log"] },
    );
    assert.equal((await store.promoteLearning(failed, "learn-2")).length, 0);
  });
});

test("writes an inspectable versioned persistence format", async () => {
  await withStore(async (store, file) => {
    await store.upsert({ id: "x", kind: "semantic", content: "portable memory", confidence: 0.7 });
    const parsed = JSON.parse(await readFile(file, "utf8")) as { version: number; records: unknown[] };
    assert.equal(parsed.version, 1);
    assert.equal(parsed.records.length, 1);
  });
});
