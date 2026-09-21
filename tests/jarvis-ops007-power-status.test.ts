import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectWorldResources } from "../src/gai/world-resource-collector.ts";
import { PersistentWorldResourceModel } from "../src/gai/world-resource-model.ts";
import type { GaiWorker, WorkerDescriptor, WorkerHealth } from "../src/gai/worker-runtime.ts";

const now = new Date("2026-09-21T11:00:00.000Z");

function descriptor(id: string): WorkerDescriptor {
  return {
    id,
    label: id,
    platform: "windows",
    capabilities: ["filesystem"],
    maxParallelTasks: 1,
    enabled: true,
    executionModes: ["resident"],
    networkRequirement: "offline-capable",
  };
}

function worker(id: string, health: () => Promise<WorkerHealth>): GaiWorker {
  return {
    descriptor: descriptor(id),
    health,
    async execute() {
      throw new Error("not used by OPS-007 collection tests");
    },
  };
}

async function withModel(run: (model: PersistentWorldResourceModel, path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-ops007-"));
  const path = join(directory, "world-resources.json");
  try {
    await run(new PersistentWorldResourceModel(path), path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("OPS-007 preserves supplied battery/external-power status and does not invent missing power telemetry", async () => {
  await withModel(async (model, path) => {
    const powered = worker("power-reporter", async () => ({
      workerId: "power-reporter",
      available: true,
      checkedAt: now.toISOString(),
      connectivity: "online",
      resources: {
        cpuAvailable: true,
        batteryPercent: 0,
        onExternalPower: false,
      },
    }));
    const unknown = worker("power-unknown", async () => ({
      workerId: "power-unknown",
      available: true,
      checkedAt: now.toISOString(),
      connectivity: "online",
      resources: {
        cpuAvailable: true,
        memoryAvailableMb: 4096,
      },
    }));

    const collection = await collectWorldResources({
      model,
      workers: [powered, unknown],
      ttlMs: 60_000,
      now,
      provenance: "ops-007-test",
    });

    assert.equal(collection.failures.length, 0);
    assert.equal(collection.observations.length, 2);

    const poweredView = await model.get("power-reporter", now);
    assert.equal(poweredView.resources.batteryPercent, 0);
    assert.equal(poweredView.resources.onExternalPower, false);
    assert.deepEqual(poweredView.provenance, ["ops-007-test"]);

    const unknownView = await model.get("power-unknown", now);
    assert.equal(unknownView.resources.batteryPercent, undefined);
    assert.equal(unknownView.resources.onExternalPower, undefined);

    const restarted = new PersistentWorldResourceModel(path);
    const persisted = await restarted.get("power-reporter", now);
    assert.equal(persisted.resources.batteryPercent, 0);
    assert.equal(persisted.resources.onExternalPower, false);

    const context = await restarted.plannerContext(now);
    const data = context.data as {
      workers: Array<{ workerId: string; resources: { batteryPercent?: number; onExternalPower?: boolean } }>;
    };
    const poweredContext = data.workers.find((item) => item.workerId === "power-reporter");
    const unknownContext = data.workers.find((item) => item.workerId === "power-unknown");
    assert.equal(poweredContext?.resources.batteryPercent, 0);
    assert.equal(poweredContext?.resources.onExternalPower, false);
    assert.equal(unknownContext?.resources.batteryPercent, undefined);
    assert.equal(unknownContext?.resources.onExternalPower, undefined);
  });
});

test("OPS-007 failed health collection stays fail-visible and cannot fabricate a power observation", async () => {
  await withModel(async (model) => {
    const failing = worker("broken-power-source", async () => {
      throw new Error("power telemetry unavailable");
    });

    const collection = await collectWorldResources({
      model,
      workers: [failing],
      ttlMs: 60_000,
      now,
      provenance: "ops-007-test",
    });

    assert.deepEqual(collection.observations, []);
    assert.deepEqual(collection.failures, [
      { workerId: "broken-power-source", error: "power telemetry unavailable" },
    ]);

    const view = await model.get("broken-power-source", now);
    assert.equal(view.knowledgeState, "unknown");
    assert.equal(view.available, false);
    assert.deepEqual(view.resources, {});
  });
});
