import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAndroidWorkerAdapter } from "../src/gai/android-worker-adapter.ts";
import {
  exportMemorySyncEnvelope,
  importMemorySyncEnvelope,
} from "../src/gai/memory-integration.ts";
import { PersistentMemoryStore } from "../src/gai/memory-store.ts";
import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import { MultiWorkerRuntime } from "../src/gai/worker-runtime.ts";
import type { CycleReport, Goal } from "../src/orchestrator/goal-loop.ts";
import type { TaskProfile } from "../src/gai/types.ts";

const goal: Goal = {
  title: "ACC-008 offline reconnect acceptance",
  successCriteria: ["offline work or waiting survives reconnect", "resumed work is verifier-backed"],
  constraints: ["no physical evidence claim"],
};
const intent = { summary: "complete ACC-008 software path", confidence: 1, evidence: [] };

function report(overrides: Partial<CycleReport> = {}): CycleReport {
  return { goal, intent, stopReason: "continue", contextSources: [], ...overrides };
}

async function tempFiles() {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-acc008-"));
  return {
    runFile: join(dir, "runs.json"),
    sourceMemory: join(dir, "source-memory.json"),
    reconnectMemory: join(dir, "reconnect-memory.json"),
  };
}

test("ACC-008 performs offline local work, syncs on reconnect, resumes durable wait, and completes only after verifier PASS", async () => {
  const paths = await tempFiles();
  const task: TaskProfile = { id: "acc008-local", description: "collect cached mobile evidence", difficulty: 1, risk: "LOW" };
  const calls: string[] = [];
  const worker = createAndroidWorkerAdapter({
    bridge: {
      capabilities: ["gps"],
      health: () => ({ connectivity: "offline" }),
      execute: async ({ taskId, capability, mode }) => {
        calls.push(`${taskId}:${capability}:${mode}`);
        return { output: "cached-local-result", evidence: { source: "acc008-simulated-local" } };
      },
    },
  });

  const localResult = await new MultiWorkerRuntime([worker]).execute({
    task,
    input: "use local cached state",
    requestedCapability: "gps",
    requiredCapabilities: ["gps"],
    preferredPlatform: "android",
    requiredExecutionMode: "background-scheduled",
    connectivity: "offline",
    allowOffline: true,
  });
  assert.equal(localResult.ok, true);
  assert.deepEqual(calls, ["acc008-local:gps:background-scheduled"]);

  const source = new PersistentMemoryStore(paths.sourceMemory);
  await source.upsert({
    id: "acc008:offline-result",
    kind: "episodic",
    content: localResult.output,
    source: "offline-worker",
    confidence: 0.9,
    tags: ["acc008", "offline", "verified-local"],
    createdAt: "2026-09-21T20:00:00.000Z",
  });
  const envelope = await exportMemorySyncEnvelope(source, { limit: 50 });

  let firstCycles = 0;
  const beforeReconnect = new ProductionAutonomyRuntime(
    paths.runFile,
    () => ({
      runCycle: async () => {
        firstCycles += 1;
        return report({ stopReason: "paused", nextAction: "wait for connectivity" });
      },
    }) as never,
  );
  const waiting = await beforeReconnect.run({ runId: "acc008-run", goal });
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.cycles, 1);
  assert.equal(firstCycles, 1);
  assert.equal(waiting.completionEvidence.length, 0);

  const reconnected = new PersistentMemoryStore(paths.reconnectMemory);
  const sync = await importMemorySyncEnvelope(reconnected, envelope);
  assert.deepEqual(sync, { imported: 1, unchanged: 0 });
  assert.equal((await reconnected.get("acc008:offline-result"))?.content, "cached-local-result");

  let resumedCycles = 0;
  const resumedRuntime = new ProductionAutonomyRuntime(
    paths.runFile,
    () => ({
      runCycle: async () => {
        resumedCycles += 1;
        return report({
          stopReason: "goal_complete",
          action: { id: "resume-after-reconnect", description: "resume synced work", capability: "local", risk: "low" },
          result: { actionId: "resume-after-reconnect", ok: true, summary: "resumed using synchronized local state" },
          verification: { ok: true, summary: "ACC-008 resumed result verified", evidence: { requirement: "ACC-008", simulated: true } },
          nextAction: null,
        });
      },
    }) as never,
  );

  const completed = await resumedRuntime.run({ runId: "acc008-run", goal });
  assert.equal(completed.state, "completed");
  assert.equal(completed.cycles, 2);
  assert.equal(resumedCycles, 1);
  assert.equal(completed.completionEvidence.length, 1);
  assert.equal(completed.verificationHistory?.at(-1)?.ok, true);
});

test("ACC-008 reconnect sync validates the whole envelope before importing and fails closed on conflicts", async () => {
  const paths = await tempFiles();
  const store = new PersistentMemoryStore(paths.reconnectMemory);
  await store.upsert({
    id: "existing",
    kind: "semantic",
    content: "trusted existing value",
    source: "local",
    confidence: 0.9,
    tags: ["trusted"],
    createdAt: "2026-09-21T20:00:00.000Z",
  });

  const conflictingEnvelope = {
    version: 1,
    generatedAt: "2026-09-21T20:01:00.000Z",
    records: [
      {
        id: "would-have-been-new",
        kind: "episodic",
        content: "must not be partially imported",
        source: "remote",
        confidence: 0.8,
        tags: ["sync"],
        createdAt: "2026-09-21T20:00:10.000Z",
      },
      {
        id: "existing",
        kind: "semantic",
        content: "conflicting remote value",
        source: "remote",
        confidence: 0.9,
        tags: ["trusted"],
        createdAt: "2026-09-21T20:00:00.000Z",
      },
    ],
  };

  await assert.rejects(importMemorySyncEnvelope(store, conflictingEnvelope), /memory sync conflict for existing/);
  assert.equal(await store.get("would-have-been-new"), null);
  assert.equal((await store.get("existing"))?.content, "trusted existing value");

  await assert.rejects(
    importMemorySyncEnvelope(store, { version: 2, generatedAt: new Date().toISOString(), records: [] }),
    /unsupported memory sync envelope version/,
  );
  await assert.rejects(
    importMemorySyncEnvelope(store, {
      version: 1,
      generatedAt: new Date().toISOString(),
      records: Array.from({ length: 501 }, (_, index) => ({
        id: `record-${index}`,
        kind: "episodic",
        content: "bounded",
        confidence: 1,
        tags: [],
        createdAt: "2026-09-21T20:00:00.000Z",
      })),
    }),
    /invalid memory sync record count/,
  );
});

test("ACC-008 repeated sync is idempotent and does not duplicate durable memory", async () => {
  const paths = await tempFiles();
  const source = new PersistentMemoryStore(paths.sourceMemory);
  await source.upsert({
    id: "same",
    kind: "procedural",
    content: "resume from durable checkpoint after reconnect",
    source: "verified-run",
    confidence: 0.95,
    tags: ["acc008", "resume"],
    createdAt: "2026-09-21T20:00:00.000Z",
  });
  const envelope = await exportMemorySyncEnvelope(source);
  const target = new PersistentMemoryStore(paths.reconnectMemory);

  assert.deepEqual(await importMemorySyncEnvelope(target, envelope), { imported: 1, unchanged: 0 });
  assert.deepEqual(await importMemorySyncEnvelope(target, envelope), { imported: 0, unchanged: 1 });
  assert.equal((await target.query({ limit: 10 })).filter((record) => record.id === "same").length, 1);
});
