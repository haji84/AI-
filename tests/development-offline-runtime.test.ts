import assert from "node:assert/strict";
import test from "node:test";
import { DurableTaskRuntime, MemoryDurableTaskStore } from "../src/gai/durable-task-runtime.ts";
import { ConnectivityManager, OfflineFirstExecutionCoordinator } from "../src/gai/offline-first-runtime.ts";
import { MultiWorkerRuntime, createFunctionWorker } from "../src/gai/worker-runtime.ts";

test("offline development persists verified work as ready to publish", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({
    id: "development-1",
    idempotencyKey: "development-1",
    type: "development-change",
    requiredCapabilities: ["code-builder"],
  });
  const worker = createFunctionWorker({
    descriptor: {
      id: "zbook-local",
      label: "ZBook local Builder",
      platform: "windows",
      capabilities: ["code-builder", "filesystem", "local-model"],
      maxParallelTasks: 1,
      enabled: true,
      executionModes: ["resident"],
      networkRequirement: "offline-capable",
    },
    health: () => ({ connectivity: "offline" }),
    run: async () => JSON.stringify({ changeSetId: "change-1", verified: true }),
  });
  const coordinator = new OfflineFirstExecutionCoordinator({
    tasks,
    workers: new MultiWorkerRuntime([worker]),
    connectivity: new ConnectivityManager("offline"),
    resolve: () => ({
      networkRequirement: "offline-capable",
      requestedCapability: "code-builder",
      requiredCapabilities: ["code-builder"],
      allowOffline: true,
      publicationRequired: true,
    }),
  });
  const outcome = await coordinator.runNext();
  assert.equal(outcome?.task.status, "ready-to-publish");
  assert.equal(outcome?.evidence.decision, "ready-to-publish");

  const restored = new DurableTaskRuntime(new class extends MemoryDurableTaskStore {
    override async load() { return { version: 1 as const, tasks: await tasks.list(), savedAt: new Date().toISOString() }; }
  }());
  assert.equal((await restored.get("development-1"))?.status, "ready-to-publish");
});

test("online publication-required work completes normally", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({ id: "development-online", idempotencyKey: "development-online", type: "development-change" });
  const worker = createFunctionWorker({
    descriptor: {
      id: "mac-local",
      label: "Mac local Builder",
      platform: "macos",
      capabilities: ["code-builder"],
      maxParallelTasks: 1,
      enabled: true,
      executionModes: ["resident"],
      networkRequirement: "offline-capable",
    },
    run: async () => "verified",
  });
  const outcome = await new OfflineFirstExecutionCoordinator({
    tasks,
    workers: new MultiWorkerRuntime([worker]),
    connectivity: new ConnectivityManager("online"),
    resolve: () => ({ networkRequirement: "offline-capable", requestedCapability: "code-builder", publicationRequired: true }),
  }).runNext();
  assert.equal(outcome?.task.status, "completed");
});

