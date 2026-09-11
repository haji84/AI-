import assert from "node:assert/strict";
import test from "node:test";
import { compareCrossDevice, summarizeDeviceEffect } from "../src/gai/cross-device-evaluation.ts";
import { MultiWorkerRuntime, createFunctionWorker } from "../src/gai/worker-runtime.ts";

const task = {
  id: "task-1",
  title: "cross-platform task",
  description: "Verify deterministic multi-worker selection across Windows and macOS workers.",
  difficulty: 6,
  risk: "LOW" as const,
  requiresFrontierReasoning: false,
  requiresLongContext: false,
};

test("prefers requested platform when both workers are healthy", async () => {
  const runtime = new MultiWorkerRuntime([
    createFunctionWorker({
      descriptor: {
        id: "zbook",
        label: "ZBook",
        platform: "windows",
        capabilities: ["local-model", "gpu", "windows-tooling", "long-running"],
        maxParallelTasks: 1,
        enabled: true,
      },
      run: async () => "zbook",
    }),
    createFunctionWorker({
      descriptor: {
        id: "macbook",
        label: "MacBook",
        platform: "macos",
        capabilities: ["local-model", "macos-tooling", "long-running"],
        maxParallelTasks: 1,
        enabled: true,
      },
      run: async () => "macbook",
    }),
  ]);

  const selected = await runtime.select({ task, input: "run", preferredPlatform: "macos" });
  assert.equal(selected.worker.descriptor.id, "macbook");
});

test("requires declared worker capability", async () => {
  const runtime = new MultiWorkerRuntime([
    createFunctionWorker({
      descriptor: {
        id: "zbook",
        label: "ZBook",
        platform: "windows",
        capabilities: ["gpu", "windows-tooling"],
        maxParallelTasks: 1,
        enabled: true,
      },
      run: async () => "ok",
    }),
  ]);

  await assert.rejects(
    runtime.select({ task, input: "run", requiredCapabilities: ["macos-tooling"] }),
    /No healthy worker/,
  );
});

test("skips unavailable worker", async () => {
  const runtime = new MultiWorkerRuntime([
    createFunctionWorker({
      descriptor: {
        id: "zbook",
        label: "ZBook",
        platform: "windows",
        capabilities: ["gpu"],
        maxParallelTasks: 1,
        enabled: true,
      },
      available: () => false,
      run: async () => "no",
    }),
    createFunctionWorker({
      descriptor: {
        id: "macbook",
        label: "MacBook",
        platform: "macos",
        capabilities: [],
        maxParallelTasks: 1,
        enabled: true,
      },
      run: async () => "yes",
    }),
  ]);

  const selected = await runtime.select({ task, input: "run" });
  assert.equal(selected.worker.descriptor.id, "macbook");
});

test("cross-device evaluation separates outcome agreement from speed", () => {
  const comparisons = compareCrossDevice([
    { taskId: "a", workerId: "zbook", platform: "windows", passed: true, durationMs: 100 },
    { taskId: "a", workerId: "macbook", platform: "macos", passed: true, durationMs: 80 },
    { taskId: "b", workerId: "zbook", platform: "windows", passed: true, durationMs: 90 },
    { taskId: "b", workerId: "macbook", platform: "macos", passed: false, durationMs: 70 },
  ]);
  const summary = summarizeDeviceEffect(comparisons);
  assert.equal(summary.tasks, 2);
  assert.equal(summary.outcomeAgreementRate, 0.5);
  assert.deepEqual(summary.divergentTasks, ["b"]);
  assert.equal(comparisons.find((item) => item.taskId === "a")?.fastestWorkerId, "macbook");
});
