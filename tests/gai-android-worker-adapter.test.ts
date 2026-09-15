import assert from "node:assert/strict";
import test from "node:test";

import { androidWorkerProfile, createAndroidWorkerAdapter } from "../src/gai/android-worker-adapter.ts";
import { evaluateWorkerContract } from "../src/gai/worker-contract-evaluation.ts";
import { MultiWorkerRuntime } from "../src/gai/worker-runtime.ts";
import type { TaskProfile } from "../src/gai/types.ts";

const task: TaskProfile = { id: "android-task", description: "mobile offline work", difficulty: 1, risk: "LOW" };

test("Android profile satisfies the same persistent offline-aware worker contract", () => {
  const result = evaluateWorkerContract(androidWorkerProfile);
  assert.equal(result.passed, true, result.failures.join("; "));
  assert.equal(androidWorkerProfile.platform, "android");
  assert.equal(androidWorkerProfile.persistence?.offlineQueue, true);
  assert.equal(androidWorkerProfile.securityContext?.humanGateEnforced, true);
  assert.equal(androidWorkerProfile.verifierHooks?.evidenceCapture, true);
});

test("Android adapter executes offline mobile capability through common runtime", async () => {
  const calls: string[] = [];
  const worker = createAndroidWorkerAdapter({ bridge: {
    capabilities: ["gps", "camera"],
    health: () => ({ connectivity: "offline" }),
    execute: async (request) => { calls.push(`${request.capability}:${request.mode}`); return { output: "ok", evidence: { source: "android-bridge-test" } }; },
  }});
  const result = await new MultiWorkerRuntime([worker]).execute({ task, input: "where", requestedCapability: "gps", requiredCapabilities: ["gps"], preferredPlatform: "android", requiredExecutionMode: "background-scheduled", connectivity: "offline", allowOffline: true });
  assert.equal(result.workerId, "android-mobile-worker");
  assert.deepEqual(calls, ["gps:background-scheduled"]);
  assert.equal(result.evidence?.capabilityEvidence && (result.evidence.capabilityEvidence as Record<string, unknown>).source, "android-bridge-test");
});

test("Android adapter rejects undeclared bridge capabilities and resident semantics", async () => {
  assert.throws(() => createAndroidWorkerAdapter({ bridge: { capabilities: ["gpu"], execute: async () => ({ output: "bad" }) } }), /unsupported capabilities/);
  const worker = createAndroidWorkerAdapter({ bridge: { capabilities: ["gps"], execute: async () => ({ output: "ok" }) } });
  await assert.rejects(() => worker.execute({ task, input: "x", requestedCapability: "gps", requiredCapabilities: ["gps"], preferredPlatform: "android", requiredExecutionMode: "resident" }), /does not claim unrestricted resident execution/);
});

test("unavailable Android adapter falls back to another compatible Android worker without core changes", async () => {
  const unavailable = createAndroidWorkerAdapter({ bridge: { capabilities: ["gps"], available: () => false, execute: async () => ({ output: "never" }) } });
  const fallback = createAndroidWorkerAdapter({ bridge: { capabilities: ["gps"], execute: async () => ({ output: "fallback" }) } });
  fallback.descriptor.id = "android-fallback";
  const result = await new MultiWorkerRuntime([unavailable, fallback]).execute({ task, input: "x", requestedCapability: "gps", requiredCapabilities: ["gps"], preferredPlatform: "android", connectivity: "offline", allowOffline: true });
  assert.equal(result.workerId, "android-fallback");
  assert.equal(result.output, "fallback");
});
