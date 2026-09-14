import assert from "node:assert/strict";
import test from "node:test";
import { CommonWorkerRuntime, createMemoryCheckpointHooks } from "../src/gai/common-worker-runtime.ts";
import { MultiWorkerRuntime } from "../src/gai/worker-runtime.ts";

const task = {
  id: "runtime-task",
  title: "runtime task",
  description: "exercise the common worker runtime",
  difficulty: 4,
  risk: "LOW" as const,
  requiresFrontierReasoning: false,
  requiresLongContext: false,
};

const descriptor = {
  id: "zbook",
  label: "ZBook",
  platform: "windows" as const,
  deviceType: "laptop" as const,
  capabilities: ["gpu", "filesystem", "local-model"] as const,
  maxParallelTasks: 1,
  enabled: true,
  executionModes: ["resident"] as const,
  networkRequirement: "offline-capable" as const,
  persistence: { localState: true, checkpointResume: true, offlineQueue: false },
  securityContext: { credentialIsolation: true, taskScopedAuthorization: true, acceptsRemoteSecrets: false },
  verifierHooks: { healthEvidence: true, executionEvidence: true, stateEvidence: true },
};

function runtime() {
  return new CommonWorkerRuntime({
    descriptor: {
      ...descriptor,
      capabilities: [...descriptor.capabilities],
      executionModes: [...descriptor.executionModes],
    },
    runtimeVersion: "phase2-test",
    checkpoint: createMemoryCheckpointHooks(),
  });
}

test("dispatches a task through an explicitly requested registered capability", async () => {
  const worker = runtime().registerCapability("gpu", async (request) => `gpu:${request.input}`);
  const result = await worker.execute({ task, input: "run", requestedCapability: "gpu" });

  assert.equal(result.ok, true);
  assert.equal(result.output, "gpu:run");
  assert.equal(result.evidence?.workerId, "zbook");
  assert.equal(result.evidence?.taskId, task.id);
  assert.equal(result.evidence?.capability, "gpu");
  assert.deepEqual(result.evidence?.securityContext, descriptor.securityContext);
  assert.deepEqual(result.evidence?.verifierHooks, descriptor.verifierHooks);

  const state = worker.snapshot();
  assert.equal(state.activeTasks, 0);
  assert.equal(state.completedTasks, 1);
  assert.equal(state.failedTasks, 0);
  assert.equal(state.lastResult, "success");
});

test("fails visibly for undeclared, duplicate, and ambiguous capability handlers", async () => {
  const worker = runtime();
  assert.throws(() => worker.registerCapability("camera", async () => "no"), /not declared/);

  worker.registerCapability("gpu", async () => "gpu");
  assert.throws(() => worker.registerCapability("gpu", async () => "duplicate"), /already registered/);
  worker.registerCapability("filesystem", async () => "filesystem");

  await assert.rejects(worker.execute({ task, input: "ambiguous" }), /must select requestedCapability/);
});

test("handler failure returns structured failed result and updates runtime health state", async () => {
  const worker = runtime().registerCapability("filesystem", async () => {
    throw new Error("disk unavailable");
  });

  const result = await worker.execute({ task, input: "write", requestedCapability: "filesystem" });
  assert.equal(result.ok, false);
  assert.match(result.output, /disk unavailable/);
  assert.equal(result.evidence?.capability, "filesystem");

  const health = await worker.health();
  assert.equal(health.available, true);
  assert.equal(health.runtimeState?.activeTasks, 0);
  assert.equal(health.runtimeState?.completedTasks, 0);
  assert.equal(health.runtimeState?.failedTasks, 1);
  assert.equal(health.runtimeState?.lastResult, "failed");
});

test("checkpoint hook is capability-neutral and available to handlers", async () => {
  const worker = runtime().registerCapability("local-model", async (_request, context) => {
    await context.checkpoint?.save({
      taskId: context.taskId,
      capability: context.capability,
      value: { token: 7 },
      savedAt: new Date().toISOString(),
    });
    const restored = await context.checkpoint?.load(context.taskId, context.capability);
    return JSON.stringify(restored?.value);
  });

  const result = await worker.execute({ task, input: "checkpoint", requestedCapability: "local-model" });
  assert.equal(result.ok, true);
  assert.equal(result.output, JSON.stringify({ token: 7 }));
});

test("common runtime remains selectable through MultiWorkerRuntime without device hard-coding", async () => {
  const worker = runtime().registerCapability("gpu", async () => "selected");
  const router = new MultiWorkerRuntime([worker]);

  const result = await router.execute({
    task,
    input: "route",
    requestedCapability: "gpu",
    requiredCapabilities: ["gpu"],
    connectivity: "offline",
    allowOffline: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.workerId, "zbook");
  assert.equal(result.output, "selected");
});
