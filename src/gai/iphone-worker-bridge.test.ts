import assert from "node:assert/strict";
import test from "node:test";
import { PhysicalIphoneWorkerBridge, signIphoneResult, type IphoneTaskEnvelope, type IphoneTransport } from "./iphone-worker-bridge.ts";

const token = "test-only-iphone-token";
const now = new Date("2026-09-15T03:00:00.000Z");

function transport(overrides: Partial<IphoneTransport> = {}): IphoneTransport {
  return {
    async connectivity() { return "online"; },
    async deliver(task: IphoneTaskEnvelope) {
      return signIphoneResult({
        protocolVersion: 1,
        taskId: task.taskId,
        deviceId: task.deviceId,
        ok: true,
        output: "iphone-ok",
        evidence: { executor: "physical-ios-app" },
        completedAt: "2026-09-15T03:00:01.000Z",
        nonce: task.nonce,
      }, token);
    },
    ...overrides,
  };
}

function bridge(t: IphoneTransport) {
  return new PhysicalIphoneWorkerBridge({
    enrollment: {
      deviceId: "iphone-1",
      token,
      capabilities: ["ios-tooling", "local-storage"],
      expiresAt: "2026-09-16T03:00:00.000Z",
    },
    transport: t,
    now: () => now,
  });
}

test("returns verifier-friendly physical-device evidence and is idempotent", async () => {
  let deliveries = 0;
  const t = transport({ async deliver(task) { deliveries += 1; return signIphoneResult({ protocolVersion: 1, taskId: task.taskId, deviceId: task.deviceId, ok: true, output: "done", evidence: { proof: "on-device" }, completedAt: "2026-09-15T03:00:01.000Z", nonce: task.nonce }, token); } });
  const worker = bridge(t);
  const request = { taskId: "task-1", capability: "ios-tooling" as const, mode: "foreground" as const, input: "bounded test" };
  const first = await worker.execute(request);
  const second = await worker.execute(request);
  assert.equal(first.output, "done");
  assert.equal(first.evidence?.physicalDevice, true);
  assert.equal(first.evidence?.deviceId, "iphone-1");
  assert.deepEqual(second, first);
  assert.equal(deliveries, 1);
});

test("offline transport waits instead of fabricating device evidence", async () => {
  const worker = bridge(transport({ async connectivity() { return "offline"; } }));
  await assert.rejects(() => worker.execute({ taskId: "task-offline", capability: "ios-tooling", mode: "deferred", input: "later" }), /WAITING_FOR_CONNECTIVITY/);
});

test("rejects tampered result and unauthorized capability", async () => {
  const bad = bridge(transport({ async deliver(task) { return { protocolVersion: 1, taskId: task.taskId, deviceId: task.deviceId, ok: true, output: "tampered", evidence: {}, completedAt: "2026-09-15T03:00:01.000Z", nonce: task.nonce, signature: "00" }; } }));
  await assert.rejects(() => bad.execute({ taskId: "task-bad", capability: "ios-tooling", mode: "foreground", input: "x" }), /invalid iPhone result signature/);
  await assert.rejects(() => bridge(transport()).execute({ taskId: "task-cap", capability: "camera", mode: "foreground", input: "x" }), /does not authorize camera/);
});
