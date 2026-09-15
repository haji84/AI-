import assert from "node:assert/strict";
import test from "node:test";

import { DeviceCapabilityRuntime } from "../src/gai/device-capability-runtime.ts";
import { createFunctionWorker, MultiWorkerRuntime, type WorkerDescriptor } from "../src/gai/worker-runtime.ts";
import type { TaskProfile } from "../src/gai/types.ts";

const task: TaskProfile = { id: "cap-task", description: "capability task", difficulty: 1, risk: "LOW" };

function descriptor(id: string, platform: WorkerDescriptor["platform"], capabilities: WorkerDescriptor["capabilities"], modes: WorkerDescriptor["executionModes"]): WorkerDescriptor {
  return { id, label: id, platform, deviceType: platform === "ios" ? "mobile" : "laptop", capabilities, executionModes: modes, networkRequirement: "offline-capable", maxParallelTasks: 1, enabled: true };
}

function runtime() {
  const windows = createFunctionWorker({
    descriptor: descriptor("pc", "windows", ["browser", "filesystem", "windows-tooling"], ["resident", "foreground"]),
    health: () => ({ connectivity: "offline" }),
    run: async (request) => `pc:${request.requestedCapability}`,
  });
  const iphone = createFunctionWorker({
    descriptor: descriptor("phone", "ios", ["ios-tooling", "camera", "gps", "sensors"], ["foreground", "background-scheduled", "deferred"]),
    health: () => ({ connectivity: "offline" }),
    run: async (request) => `ios:${request.requestedCapability}`,
  });
  return new DeviceCapabilityRuntime(new MultiWorkerRuntime([windows, iphone]));
}

test("routes browser capability to a capable PC without worker-id hard-coding", async () => {
  const executed = await runtime().execute({ task, capability: "browser", operation: "read", preferredPlatform: "windows", connectivity: "offline", allowOffline: true });
  assert.equal(executed.result.workerId, "pc");
  assert.equal(executed.evidence.capability, "browser");
  assert.equal(executed.evidence.platform, "windows");
});

test("routes iPhone camera and GPS through OS-managed execution modes", async () => {
  const camera = await runtime().execute({ task, capability: "camera", operation: "capture", preferredPlatform: "ios", executionMode: "foreground", connectivity: "offline", allowOffline: true });
  assert.equal(camera.result.workerId, "phone");
  const gps = await runtime().execute({ task, capability: "gps", operation: "read-location", preferredPlatform: "ios", executionMode: "background-scheduled", connectivity: "offline", allowOffline: true });
  assert.equal(gps.result.workerId, "phone");
});

test("rejects unsupported operation and impossible platform before dispatch", async () => {
  await assert.rejects(() => runtime().execute({ task, capability: "camera", operation: "delete", preferredPlatform: "ios" }), /Unsupported camera operation/);
  await assert.rejects(() => runtime().execute({ task, capability: "ios-tooling", operation: "open-url", preferredPlatform: "windows" }), /not supported/);
});

test("rejects resident daemon semantics for iOS", async () => {
  await assert.rejects(() => runtime().execute({ task, capability: "ios-tooling", operation: "device-status", preferredPlatform: "ios", executionMode: "resident" }), /cannot use resident mode/);
});

test("fails visibly when no worker exposes the required capability", async () => {
  const workers = new MultiWorkerRuntime([createFunctionWorker({ descriptor: descriptor("pc", "windows", ["filesystem"], ["resident"]), run: async () => "ok" })]);
  await assert.rejects(() => new DeviceCapabilityRuntime(workers).execute({ task, capability: "browser", operation: "read" }), /No healthy worker/);
});
