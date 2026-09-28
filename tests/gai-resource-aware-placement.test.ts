import assert from "node:assert/strict";
import test from "node:test";
import { MultiWorkerRuntime, createFunctionWorker, type WorkerDescriptor } from "../src/gai/worker-runtime.ts";

const task = { id: "resource-task", title: "resource task", description: "resource-aware placement", difficulty: 3, risk: "LOW" as const, requiresFrontierReasoning: false, requiresLongContext: false };
const descriptor = (id: string, platform: WorkerDescriptor["platform"] = "windows"): WorkerDescriptor => ({ id, label: id, platform, capabilities: ["filesystem"], maxParallelTasks: 2, enabled: true });

test("lower known CPU load wins between otherwise equal workers", async () => {
  const runtime = new MultiWorkerRuntime([
    createFunctionWorker({
      descriptor: descriptor("busy"),
      health: () => ({ resources: { cpuLoadPercent: 90, memoryAvailableMb: 8192 }, runtimeState: { activeTasks: 0, completedTasks: 0, failedTasks: 0 } }),
      run: async () => "busy",
    }),
    createFunctionWorker({
      descriptor: descriptor("idle"),
      health: () => ({ resources: { cpuLoadPercent: 10, memoryAvailableMb: 8192 }, runtimeState: { activeTasks: 0, completedTasks: 0, failedTasks: 0 } }),
      run: async () => "idle",
    }),
  ]);
  const selected = await runtime.select({ task, input: "run" });
  assert.equal(selected.worker.descriptor.id, "idle");
});

test("unknown CPU load is not treated as zero load", async () => {
  const runtime = new MultiWorkerRuntime([
    createFunctionWorker({
      descriptor: descriptor("unknown"),
      health: () => ({ resources: { memoryAvailableMb: 8192 }, runtimeState: { activeTasks: 0, completedTasks: 0, failedTasks: 0 } }),
      run: async () => "unknown",
    }),
    createFunctionWorker({
      descriptor: descriptor("known"),
      health: () => ({ resources: { cpuLoadPercent: 20, memoryAvailableMb: 8192 }, runtimeState: { activeTasks: 0, completedTasks: 0, failedTasks: 0 } }),
      run: async () => "known",
    }),
  ]);
  const selected = await runtime.select({ task, input: "run" });
  assert.equal(selected.worker.descriptor.id, "known");
});
