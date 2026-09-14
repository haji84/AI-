import assert from "node:assert/strict";
import test from "node:test";
import {
  initialWorkerProfiles,
  iphoneWorkerProfile,
  macbookWorkerProfile,
  zbookWorkerProfile,
} from "../src/gai/initial-worker-profiles.ts";
import { evaluateWorkerContract } from "../src/gai/worker-contract-evaluation.ts";
import { MultiWorkerRuntime, createFunctionWorker, type WorkerDescriptor } from "../src/gai/worker-runtime.ts";

const task = {
  id: "worker-contract-task",
  title: "worker contract evaluation",
  description: "Validate device-neutral worker selection and evidence.",
  difficulty: 4,
  risk: "LOW" as const,
  requiresFrontierReasoning: false,
  requiresLongContext: false,
};

test("initial workers satisfy persistent offline-aware contract", () => {
  for (const descriptor of initialWorkerProfiles) {
    const evaluation = evaluateWorkerContract(descriptor, {
      requireLocalPersistence: true,
      requireCheckpointResume: true,
      requireOfflineQueue: true,
      requireCredentialIsolation: true,
      requireTaskScopedAuthorization: true,
      requireExecutionEvidence: true,
    });
    assert.equal(evaluation.passed, true, `${descriptor.id}: ${evaluation.failureReasons.join("; ")}`);
  }
});

test("iPhone is modeled as an OS-managed mobile worker rather than a resident daemon", () => {
  assert.equal(iphoneWorkerProfile.deviceType, "mobile");
  assert.equal(iphoneWorkerProfile.platform, "ios");
  assert.equal(iphoneWorkerProfile.executionModes?.includes("resident"), false);
  assert.equal(iphoneWorkerProfile.executionModes?.includes("background-scheduled"), true);
  assert.equal(iphoneWorkerProfile.executionModes?.includes("background-continued"), true);
  assert.equal(iphoneWorkerProfile.networkRequirement, "offline-preferred");
});

test("desktop workers retain resident execution while sharing the common contract", () => {
  assert.equal(zbookWorkerProfile.executionModes?.includes("resident"), true);
  assert.equal(macbookWorkerProfile.executionModes?.includes("resident"), true);
  assert.equal(zbookWorkerProfile.platform, "windows");
  assert.equal(macbookWorkerProfile.platform, "macos");
});

test("offline routing excludes online-required workers and selects an offline-capable worker", async () => {
  const cloudOnly: WorkerDescriptor = {
    id: "cloud-only",
    label: "Cloud Only",
    platform: "linux",
    deviceType: "server",
    capabilities: ["filesystem"],
    executionModes: ["resident"],
    networkRequirement: "online-required",
    maxParallelTasks: 1,
    enabled: true,
  };

  const runtime = new MultiWorkerRuntime([
    createFunctionWorker({ descriptor: cloudOnly, run: async () => "cloud" }),
    createFunctionWorker({ descriptor: zbookWorkerProfile, run: async () => "zbook" }),
  ]);

  const selected = await runtime.select({
    task,
    input: "continue locally",
    requiredCapabilities: ["filesystem"],
    connectivity: "offline",
    allowOffline: true,
  });

  assert.equal(selected.worker.descriptor.id, "zbook");
});

test("execution mode routing can select iPhone without hard-coding the device name", async () => {
  const runtime = new MultiWorkerRuntime([
    createFunctionWorker({ descriptor: zbookWorkerProfile, run: async () => "zbook" }),
    createFunctionWorker({ descriptor: macbookWorkerProfile, run: async () => "macbook" }),
    createFunctionWorker({ descriptor: iphoneWorkerProfile, run: async () => "iphone" }),
  ]);

  const selected = await runtime.select({
    task,
    input: "record location while offline",
    requiredCapabilities: ["gps", "offline-cache"],
    requiredExecutionMode: "background-scheduled",
    connectivity: "offline",
    allowOffline: true,
  });

  assert.equal(selected.worker.descriptor.platform, "ios");
  assert.equal(selected.worker.descriptor.capabilities.includes("gps"), true);
});

test("a future Android adapter can satisfy the same contract without changing runtime core", () => {
  const futureAndroid: WorkerDescriptor = {
    id: "future-android",
    label: "Future Android",
    platform: "android",
    deviceType: "mobile",
    capabilities: ["android-tooling", "gps", "local-storage", "offline-cache", "background-task"],
    executionModes: ["foreground", "background-scheduled", "deferred"],
    networkRequirement: "offline-capable",
    persistence: { localState: true, checkpointResume: true, offlineQueue: true },
    securityContext: { credentialIsolation: true, taskScopedAuthorization: true, acceptsRemoteSecrets: false },
    verifierHooks: { healthEvidence: true, executionEvidence: true, stateEvidence: true },
    maxParallelTasks: 1,
    enabled: true,
  };

  const evaluation = evaluateWorkerContract(futureAndroid, {
    requiredCapabilities: ["gps", "offline-cache"],
    requiredExecutionMode: "background-scheduled",
    connectivity: "offline",
    requireLocalPersistence: true,
    requireCheckpointResume: true,
    requireOfflineQueue: true,
    requireCredentialIsolation: true,
    requireTaskScopedAuthorization: true,
    requireExecutionEvidence: true,
  });

  assert.equal(evaluation.passed, true, evaluation.failureReasons.join("; "));
});

test("contract evaluation reports structured failure evidence", () => {
  const evaluation = evaluateWorkerContract(
    {
      id: "limited",
      label: "Limited",
      platform: "linux",
      capabilities: [],
      maxParallelTasks: 1,
      enabled: true,
      networkRequirement: "online-required",
    },
    {
      requiredCapabilities: ["gps"],
      connectivity: "offline",
      requireCheckpointResume: true,
      requireExecutionEvidence: true,
    },
  );

  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.failureReasons.length >= 3, true);
  assert.equal(evaluation.evidence.some((item) => item.check === "capabilities" && !item.passed), true);
  assert.equal(evaluation.evidence.some((item) => item.check === "connectivity" && !item.passed), true);
});
