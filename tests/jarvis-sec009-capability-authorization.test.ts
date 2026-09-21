import assert from "node:assert/strict";
import test from "node:test";

import { DeviceCapabilityRuntime } from "../src/gai/device-capability-runtime.ts";
import { createFunctionWorker, MultiWorkerRuntime, type WorkerDescriptor } from "../src/gai/worker-runtime.ts";
import type { TaskProfile } from "../src/gai/types.ts";
import { evaluateJarvisPolicy } from "../src/jarvis/policy-engine.ts";
import type { JarvisNode, JarvisTask } from "../src/jarvis/types.ts";

const taskProfile: TaskProfile = {
  id: "sec009-capability",
  description: "capability authorization regression",
  difficulty: 1,
  risk: "LOW",
};

function descriptor(input: Partial<WorkerDescriptor> & Pick<WorkerDescriptor, "id" | "platform" | "capabilities">): WorkerDescriptor {
  return {
    id: input.id,
    label: input.id,
    platform: input.platform,
    deviceType: input.deviceType ?? (input.platform === "android" || input.platform === "ios" ? "mobile" : "laptop"),
    capabilities: input.capabilities,
    executionModes: input.executionModes ?? ["foreground"],
    networkRequirement: input.networkRequirement ?? "offline-capable",
    maxParallelTasks: input.maxParallelTasks ?? 1,
    enabled: input.enabled ?? true,
    persistence: input.persistence,
    securityContext: input.securityContext,
    verifierHooks: input.verifierHooks,
  };
}

function policyNode(allowRemoteControl: boolean): JarvisNode {
  return {
    id: "node-sec009",
    label: "SEC-009 node",
    kind: "android",
    status: "ready",
    capabilities: ["remote-control"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl,
      requireHumanForLockedDevice: true,
    },
    telemetry: { checkedAt: new Date(0).toISOString() },
    enrollment: "full",
    lastSeenAt: new Date(0).toISOString(),
  };
}

function remoteControlTask(): JarvisTask {
  return {
    id: "sec009-remote-control",
    idempotencyKey: "sec009-remote-control",
    type: "remote-control",
    payload: {},
    status: "queued",
    requiredCapabilities: ["remote-control"],
    priority: "normal",
    requiresOnline: false,
    attempts: 0,
    maxAttempts: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

test("SEC-009 denies remote-control when node policy does not authorize it", () => {
  const denied = evaluateJarvisPolicy({
    task: remoteControlTask(),
    node: policyNode(false),
    incrementalCostYen: 0,
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.requiresHumanGate, true);
  assert.ok(denied.reasons.includes("remote control is disabled for this node"));

  const allowed = evaluateJarvisPolicy({
    task: remoteControlTask(),
    node: policyNode(true),
    incrementalCostYen: 0,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.requiresHumanGate, false);
});

test("SEC-009 rejects unsupported operations before capability worker dispatch", async () => {
  let dispatches = 0;
  const worker = createFunctionWorker({
    descriptor: descriptor({ id: "camera-phone", platform: "android", capabilities: ["camera"] }),
    health: () => ({ connectivity: "offline" }),
    run: async () => {
      dispatches += 1;
      return "unexpected";
    },
  });
  const runtime = new DeviceCapabilityRuntime(new MultiWorkerRuntime([worker]));

  await assert.rejects(
    () => runtime.execute({ task: taskProfile, capability: "camera", operation: "delete", preferredPlatform: "android" }),
    /Unsupported camera operation/,
  );
  assert.equal(dispatches, 0);
});

test("SEC-009 worker without requested capability cannot be selected", async () => {
  let dispatches = 0;
  const worker = createFunctionWorker({
    descriptor: descriptor({ id: "filesystem-only", platform: "windows", capabilities: ["filesystem"] }),
    health: () => ({ connectivity: "offline" }),
    run: async () => {
      dispatches += 1;
      return "unexpected";
    },
  });
  const runtime = new DeviceCapabilityRuntime(new MultiWorkerRuntime([worker]));

  await assert.rejects(
    () => runtime.execute({
      task: taskProfile,
      capability: "browser",
      operation: "read",
      connectivity: "offline",
      allowOffline: true,
    }),
    /No healthy worker/,
  );
  assert.equal(dispatches, 0);
});

test("SEC-009 platform and execution-mode restrictions cannot be used as a capability bypass", async () => {
  let dispatches = 0;
  const ios = createFunctionWorker({
    descriptor: descriptor({
      id: "ios-tooling-phone",
      platform: "ios",
      capabilities: ["ios-tooling"],
      executionModes: ["foreground", "background-scheduled"],
    }),
    health: () => ({ connectivity: "offline" }),
    run: async () => {
      dispatches += 1;
      return "unexpected";
    },
  });
  const runtime = new DeviceCapabilityRuntime(new MultiWorkerRuntime([ios]));

  await assert.rejects(
    () => runtime.execute({
      task: taskProfile,
      capability: "ios-tooling",
      operation: "device-status",
      preferredPlatform: "ios",
      executionMode: "resident",
    }),
    /cannot use resident mode/,
  );

  await assert.rejects(
    () => runtime.execute({
      task: taskProfile,
      capability: "camera",
      operation: "capture",
      preferredPlatform: "windows",
    }),
    /camera is not supported on windows/,
  );
  assert.equal(dispatches, 0);
});
