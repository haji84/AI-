import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  observationFromWorker,
  PersistentWorldResourceModel,
} from "../src/gai/world-resource-model.ts";
import type { WorkerDescriptor, WorkerHealth } from "../src/gai/worker-runtime.ts";

const descriptor = (id: string, platform: WorkerDescriptor["platform"], capabilities: WorkerDescriptor["capabilities"]): WorkerDescriptor => ({
  id,
  label: id,
  platform,
  capabilities,
  maxParallelTasks: 2,
  enabled: true,
  executionModes: ["resident"],
  networkRequirement: "offline-capable",
});

const health = (workerId: string, checkedAt: string, overrides: Partial<WorkerHealth> = {}): WorkerHealth => ({
  workerId,
  available: true,
  checkedAt,
  connectivity: "online",
  resources: { cpuAvailable: true, memoryAvailableMb: 8192, diskAvailableMb: 50000 },
  runtimeState: { activeTasks: 0, completedTasks: 0, failedTasks: 0 },
  ...overrides,
});

async function withModel(run: (model: PersistentWorldResourceModel, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "gai-world-resource-"));
  const path = join(dir, "resources.json");
  try {
    await run(new PersistentWorldResourceModel(path), path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("normalizes worker descriptor and health with provenance confidence and TTL", () => {
  const now = new Date("2026-09-15T00:00:30.000Z");
  const observation = observationFromWorker({
    descriptor: descriptor("worker-a", "windows", ["local-model", "gpu"]),
    health: health("worker-a", "2026-09-15T00:00:00.000Z", { resources: { cpuAvailable: true, gpuAvailable: true, memoryAvailableMb: 16000 } }),
    ttlMs: 120_000,
    confidence: 0.9,
    provenance: ["resident-health", "resident-health"],
    now,
  });

  assert.equal(observation.workerId, "worker-a");
  assert.equal(observation.platform, "windows");
  assert.equal(observation.connectivity, "online");
  assert.equal(observation.resources.gpuAvailable, true);
  assert.equal(observation.confidence, 0.9);
  assert.deepEqual(observation.provenance, ["resident-health"]);
  assert.equal(observation.expiresAt, "2026-09-15T00:02:00.000Z");
});

test("fresh state expires to stale instead of fabricating availability", async () => {
  await withModel(async (model) => {
    await model.observeWorker({
      descriptor: descriptor("worker-a", "windows", ["filesystem"]),
      health: health("worker-a", "2026-09-15T00:00:00.000Z"),
      ttlMs: 60_000,
      now: new Date("2026-09-15T00:00:10.000Z"),
    });

    const fresh = await model.get("worker-a", new Date("2026-09-15T00:00:30.000Z"));
    assert.equal(fresh.knowledgeState, "fresh");
    const stale = await model.get("worker-a", new Date("2026-09-15T00:02:00.000Z"));
    assert.equal(stale.knowledgeState, "stale");
    assert.equal((await model.query({ capability: "filesystem" }, new Date("2026-09-15T00:02:00.000Z"))).length, 0);
    assert.equal((await model.query({ capability: "filesystem", allowStale: true }, new Date("2026-09-15T00:02:00.000Z"))).length, 1);
  });
});

test("missing worker is explicit unknown with zero confidence", async () => {
  await withModel(async (model) => {
    const view = await model.get("never-observed", new Date("2026-09-15T00:00:00.000Z"));
    assert.equal(view.knowledgeState, "unknown");
    assert.equal(view.available, false);
    assert.equal(view.confidence, 0);
    assert.deepEqual(view.capabilities, []);
  });
});

test("device-neutral query selects by capability resources and capacity without worker names", async () => {
  await withModel(async (model) => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    await model.observeWorker({
      descriptor: descriptor("alpha", "windows", ["local-model", "gpu"]),
      health: health("alpha", now.toISOString(), {
        resources: { cpuAvailable: true, gpuAvailable: true, memoryAvailableMb: 16000, diskAvailableMb: 100000 },
        runtimeState: { activeTasks: 1, completedTasks: 4, failedTasks: 0 },
      }),
      ttlMs: 60_000,
      now,
    });
    await model.observeWorker({
      descriptor: descriptor("beta", "macos", ["local-model"]),
      health: health("beta", now.toISOString(), {
        resources: { cpuAvailable: true, gpuAvailable: false, memoryAvailableMb: 32000, diskAvailableMb: 200000 },
        runtimeState: { activeTasks: 0, completedTasks: 4, failedTasks: 0 },
      }),
      ttlMs: 60_000,
      now,
    });

    const gpu = await model.query({ capability: "local-model", requireGpu: true }, now);
    assert.deepEqual(gpu.map((worker) => worker.workerId), ["alpha"]);
    const memory = await model.query({ capability: "local-model", minMemoryAvailableMb: 20000 }, now);
    assert.deepEqual(memory.map((worker) => worker.workerId), ["beta"]);
  });
});

test("offline observations remain usable and are exposed to the Phase 9 planner context", async () => {
  await withModel(async (model) => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    await model.observeWorker({
      descriptor: descriptor("local-node", "macos", ["local-model", "filesystem"]),
      health: health("local-node", now.toISOString(), {
        connectivity: "offline",
        resources: { cpuAvailable: true, gpuAvailable: false, memoryAvailableMb: 8000 },
      }),
      ttlMs: 120_000,
      provenance: ["offline-local-health"],
      now,
    });

    const offline = await model.query({ capability: "local-model", connectivity: "offline" }, now);
    assert.equal(offline.length, 1);
    const context = await model.plannerContext(now);
    assert.equal(context.source, "world.resource.snapshot");
    const data = context.data as {
      connectivity: string;
      capabilities: Array<{ capability: string; available: boolean }>;
      workers: Array<{ workerId: string; knowledgeState: string; provenance: string[] }>;
    };
    assert.equal(data.connectivity, "offline");
    assert.equal(data.capabilities.find((item) => item.capability === "local-model")?.available, true);
    assert.equal(data.workers[0]?.knowledgeState, "fresh");
    assert.deepEqual(data.workers[0]?.provenance, ["offline-local-health"]);
  });
});

test("newer observation wins and survives restart", async () => {
  await withModel(async (model, path) => {
    const worker = descriptor("worker-a", "windows", ["gpu"]);
    await model.observeWorker({
      descriptor: worker,
      health: health("worker-a", "2026-09-15T00:01:00.000Z", { available: false }),
      ttlMs: 60_000,
      now: new Date("2026-09-15T00:01:00.000Z"),
    });
    await model.observeWorker({
      descriptor: worker,
      health: health("worker-a", "2026-09-15T00:00:00.000Z", { available: true }),
      ttlMs: 60_000,
      now: new Date("2026-09-15T00:01:00.000Z"),
    });

    const restarted = new PersistentWorldResourceModel(path);
    const view = await restarted.get("worker-a", new Date("2026-09-15T00:01:30.000Z"));
    assert.equal(view.available, false);
    assert.equal(view.observedAt, "2026-09-15T00:01:00.000Z");
  });
});
