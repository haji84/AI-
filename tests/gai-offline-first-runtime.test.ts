import assert from "node:assert/strict";
import test from "node:test";
import {
  ConnectivityManager,
  OfflineFirstExecutionCoordinator,
  createStaticOfflineExecutionResolver,
} from "../src/gai/offline-first-runtime.ts";
import {
  DurableTaskRuntime,
  MemoryDurableTaskStore,
} from "../src/gai/durable-task-runtime.ts";
import {
  MultiWorkerRuntime,
  createFunctionWorker,
  type WorkerDescriptor,
} from "../src/gai/worker-runtime.ts";

const offlineWorkerDescriptor: WorkerDescriptor = {
  id: "local-worker",
  label: "Local Worker",
  platform: "windows",
  deviceType: "laptop",
  capabilities: ["local-model", "local-inference", "offline-cache"],
  executionModes: ["resident", "foreground"],
  networkRequirement: "offline-capable",
  persistence: { localState: true, checkpointResume: true, offlineQueue: true },
  securityContext: { credentialIsolation: true, taskScopedAuthorization: true, acceptsRemoteSecrets: false },
  verifierHooks: { healthEvidence: true, executionEvidence: true, stateEvidence: true },
  maxParallelTasks: 1,
  enabled: true,
};

const onlineWorkerDescriptor: WorkerDescriptor = {
  id: "online-worker",
  label: "Online Worker",
  platform: "linux",
  deviceType: "server",
  capabilities: ["browser"],
  executionModes: ["resident"],
  networkRequirement: "online-required",
  maxParallelTasks: 1,
  enabled: true,
};

function localWorker() {
  return createFunctionWorker({
    descriptor: offlineWorkerDescriptor,
    health: () => ({ connectivity: "offline" }),
    run: async (request) => `local:${request.task.id}`,
  });
}

function onlineWorker() {
  return createFunctionWorker({
    descriptor: onlineWorkerDescriptor,
    health: () => ({ connectivity: "online" }),
    run: async (request) => `online:${request.task.id}`,
  });
}

const resolver = createStaticOfflineExecutionResolver({
  "local-analysis": {
    networkRequirement: "offline-capable",
    requestedCapability: "local-model",
    requiredCapabilities: ["local-model"],
    allowOffline: true,
  },
  "web-research": {
    networkRequirement: "online-required",
    requestedCapability: "browser",
    requiredCapabilities: ["browser"],
    allowOffline: false,
  },
});

test("offline mode parks online-required work and continues local work", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({
    id: "web-1",
    idempotencyKey: "web-1",
    type: "web-research",
    priority: "urgent",
  });
  await tasks.enqueue({
    id: "local-1",
    idempotencyKey: "local-1",
    type: "local-analysis",
    priority: "normal",
    requiredCapabilities: ["local-model"],
  });

  const coordinator = new OfflineFirstExecutionCoordinator({
    tasks,
    workers: new MultiWorkerRuntime([onlineWorker(), localWorker()]),
    connectivity: new ConnectivityManager("offline"),
    resolve: resolver,
  });

  const outcome = await coordinator.runNext();
  assert.equal(outcome?.task.id, "local-1");
  assert.equal(outcome?.task.status, "completed");
  assert.equal(outcome?.evidence.connectivity, "offline");
  assert.equal(outcome?.evidence.selectedWorkerId, "local-worker");
  assert.equal((await tasks.get("web-1"))?.status, "waiting-connectivity");
});

test("reconnect resumes waiting-connectivity work and routes it online", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({ id: "web-2", idempotencyKey: "web-2", type: "web-research" });
  const connectivity = new ConnectivityManager("offline");
  const coordinator = new OfflineFirstExecutionCoordinator({
    tasks,
    workers: new MultiWorkerRuntime([onlineWorker(), localWorker()]),
    connectivity,
    resolve: resolver,
  });

  assert.equal(await coordinator.runNext(), null);
  assert.equal((await tasks.get("web-2"))?.status, "waiting-connectivity");

  const evidence = await connectivity.transition("recovering", "signal returned");
  assert.equal(evidence?.current, "recovering");
  assert.equal((await tasks.get("web-2"))?.status, "waiting-connectivity");

  await connectivity.transition("online", "network verified");
  assert.equal((await tasks.get("web-2"))?.status, "queued");
  const outcome = await coordinator.runNext();
  assert.equal(outcome?.task.status, "completed");
  assert.equal(outcome?.evidence.selectedWorkerId, "online-worker");
  assert.equal(outcome?.evidence.connectivity, "online");
});

test("degraded network keeps offline-capable local work runnable", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({ id: "local-degraded", idempotencyKey: "local-degraded", type: "local-analysis" });
  const coordinator = new OfflineFirstExecutionCoordinator({
    tasks,
    workers: new MultiWorkerRuntime([localWorker()]),
    connectivity: new ConnectivityManager("degraded"),
    resolve: resolver,
  });
  const outcome = await coordinator.runNext();
  assert.equal(outcome?.task.status, "completed");
  assert.equal(outcome?.evidence.connectivity, "degraded");
});

test("missing local worker capacity waits for resource instead of failing task", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({ id: "local-no-worker", idempotencyKey: "local-no-worker", type: "local-analysis" });
  const coordinator = new OfflineFirstExecutionCoordinator({
    tasks,
    workers: new MultiWorkerRuntime([]),
    connectivity: new ConnectivityManager("offline"),
    resolve: resolver,
  });
  const outcome = await coordinator.runNext();
  assert.equal(outcome?.task.status, "waiting-resource");
  assert.equal(outcome?.evidence.decision, "wait-resource");
});

test("connectivity transitions emit bounded evidence and ignore duplicate state", async () => {
  const manager = new ConnectivityManager("online");
  const events: string[] = [];
  manager.subscribe((event) => {
    events.push(`${event.previous}->${event.current}:${event.reason}`);
  });
  assert.equal(await manager.transition("online", "same"), null);
  await manager.transition("degraded", "packet loss");
  await manager.transition("offline", "no route");
  assert.deepEqual(events, ["online->degraded:packet loss", "degraded->offline:no route"]);
  assert.equal(manager.lastEvidence?.current, "offline");
});
