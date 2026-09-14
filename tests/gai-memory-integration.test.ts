import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  exportMemorySyncEnvelope,
  GaiMemoryContextSource,
  MemoryLearningStateStore,
} from "../src/gai/memory-integration.ts";
import { PersistentMemoryStore } from "../src/gai/memory-store.ts";
import type { Goal, LoopState, StateStore, WriteBackRecord } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "analyze local incident logs",
  description: "summarize repeated failures and preserve a reusable verified procedure",
  successCriteria: ["verified summary", "reusable procedure captured"],
  constraints: ["works offline"],
};

class RecordingStateStore implements StateStore {
  records: WriteBackRecord[] = [];
  async getState(): Promise<LoopState> { return { completed: [], blockers: [] }; }
  async writeBack(record: WriteBackRecord): Promise<void> { this.records.push(record); }
}

async function withMemory(run: (memory: PersistentMemoryStore, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "gai-memory-integration-"));
  const path = join(dir, "memory.json");
  try {
    await run(new PersistentMemoryStore(path), path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function verifiedRecord(overrides: Partial<WriteBackRecord> = {}): WriteBackRecord {
  return {
    goal,
    intent: { summary: "complete log analysis", confidence: 0.95, evidence: [{ source: "goal", text: goal.title }] },
    action: { id: "analyze:1", description: "analyze local incident logs", capability: "local-model", risk: "low" },
    result: {
      actionId: "analyze:1",
      ok: true,
      summary: "found three repeated failure signatures",
      evidence: {
        artifact: "incident-summary.json",
        transferableRule: "Group failures by normalized signature before deciding a retry strategy.",
        procedure: "Normalize logs, cluster identical signatures, verify counts, then write the summary artifact.",
        memoryTags: ["incident", "offline"],
        memoryConfidence: 0.9,
      },
    },
    verification: { ok: true, summary: "artifact and counts verified", evidence: ["sha256:abc", "count-check:pass"] },
    stopReason: "continue",
    ...overrides,
  };
}

test("planner context keeps all four memory kinds distinct and bounded", async () => {
  await withMemory(async (memory) => {
    await memory.upsert({ id: "e1", kind: "episodic", content: "incident logs had timeout signature", confidence: 0.9, tags: ["incident"] });
    await memory.upsert({ id: "s1", kind: "semantic", content: "timeout bursts correlate with connectivity loss", confidence: 0.8, tags: ["incident"] });
    await memory.upsert({ id: "p1", kind: "procedural", content: "normalize incident logs before clustering", confidence: 0.85, tags: ["incident"] });
    const source = new GaiMemoryContextSource(memory, { contextLimit: 4, minConfidence: 0.5, maxContentChars: 160 });
    const context = await source.collect({ goal });

    assert.equal(context.length, 1);
    const data = context[0]?.data as { records: Array<{ kind: string; content: string }> };
    assert.ok(data.records.length <= 4);
    assert.ok(data.records.some((record) => record.kind === "working"));
    assert.ok(data.records.some((record) => record.kind === "episodic"));
    assert.ok(data.records.some((record) => record.kind === "semantic") || data.records.some((record) => record.kind === "procedural"));
    assert.ok(data.records.every((record) => record.content.length <= 160));
  });
});

test("verified successful write-back creates episodic memory and only explicit evidence-backed reusable memories", async () => {
  await withMemory(async (memory) => {
    const inner = new RecordingStateStore();
    const store = new MemoryLearningStateStore(inner, memory);
    await store.writeBack(verifiedRecord());

    assert.equal(inner.records.length, 1);
    const episodic = await memory.query({ kinds: ["episodic"], text: "incident", limit: 10 });
    const semantic = await memory.query({ kinds: ["semantic"], text: "failure", limit: 10 });
    const procedural = await memory.query({ kinds: ["procedural"], text: "normalize", limit: 10 });
    assert.equal(episodic.length, 1);
    assert.equal(semantic.length, 1);
    assert.equal(procedural.length, 1);
    assert.ok(episodic[0]?.tags.includes("verified"));
    assert.ok(semantic[0]?.source?.includes(":episodic"));
    assert.ok(procedural[0]?.source?.includes(":episodic"));
  });
});

test("verified failure is episodic evidence but never promoted to semantic or procedural truth", async () => {
  await withMemory(async (memory) => {
    const inner = new RecordingStateStore();
    const store = new MemoryLearningStateStore(inner, memory);
    const record = verifiedRecord({
      result: {
        actionId: "analyze:1",
        ok: false,
        summary: "local model ran out of memory",
        evidence: {
          transferableRule: "always use this broken route",
          procedure: "repeat failed route",
        },
      },
      verification: { ok: true, summary: "failure diagnosis verified", evidence: ["oom-log"] },
    });
    await store.writeBack(record);

    const episodes = await memory.query({ kinds: ["episodic"], limit: 10 });
    assert.equal(episodes.length, 1);
    assert.ok(episodes[0]?.tags.includes("failure"));
    assert.equal((await memory.query({ kinds: ["semantic"], limit: 10 })).length, 0);
    assert.equal((await memory.query({ kinds: ["procedural"], limit: 10 })).length, 0);
  });
});

test("unverified outcome does not enter learning memory", async () => {
  await withMemory(async (memory) => {
    const store = new MemoryLearningStateStore(new RecordingStateStore(), memory);
    await store.writeBack(verifiedRecord({ verification: { ok: false, summary: "verification failed" } }));
    assert.equal((await memory.query({ limit: 10 })).length, 0);
  });
});

test("local memory is recalled after restart without any network dependency", async () => {
  await withMemory(async (memory, path) => {
    await memory.upsert({
      id: "offline-procedure",
      kind: "procedural",
      content: "analyze local incident logs using cached files",
      source: "verified-local-run",
      confidence: 0.9,
      tags: ["offline", "incident"],
    });
    const restarted = new PersistentMemoryStore(path);
    const source = new GaiMemoryContextSource(restarted, { contextLimit: 5 });
    const context = await source.collect({ goal });
    const data = context[0]?.data as { records: Array<{ id: string }> };
    assert.ok(data.records.some((record) => record.id === "offline-procedure"));
  });
});

test("sync envelope is versioned and preserves memory provenance across kinds", async () => {
  await withMemory(async (memory) => {
    await memory.upsert({ id: "w", kind: "working", content: "current task", source: "goal-loop", confidence: 1, tags: [] });
    await memory.upsert({ id: "e", kind: "episodic", content: "verified event", source: "worker-1", confidence: 0.8, tags: ["verified"] });
    const envelope = await exportMemorySyncEnvelope(memory);
    assert.equal(envelope.version, 1);
    assert.equal(envelope.records.length, 2);
    assert.ok(envelope.records.some((record) => record.source === "worker-1"));
    assert.ok(Number.isFinite(Date.parse(envelope.generatedAt)));
  });
});
