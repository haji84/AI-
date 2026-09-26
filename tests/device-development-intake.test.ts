import assert from "node:assert/strict";
import test from "node:test";
import { DeviceDevelopmentIntake, MemoryDeviceDevelopmentInbox } from "../src/orchestrator/device-development-intake.ts";

test("offline device intake persists and flushes with stable cross-device idempotency", async () => {
  const inbox = new MemoryDeviceDevelopmentInbox();
  const calls: string[] = [];
  const intake = new DeviceDevelopmentIntake({ inbox, async submit(request) { calls.push(request.idempotencyKey!); return { goalId: "goal-681", action: "CONTINUE_GOAL" }; } });
  const queued = await intake.receive({ deviceId: "iphone", platform: "ios", ownerCommandId: "owner-command-1", text: "GORIQを強化", connectivity: "offline", goalSnapshotDigest: "a".repeat(64) });
  assert.equal(queued.status, "QUEUED_OFFLINE");
  assert.equal(calls.length, 0);
  const restored = new DeviceDevelopmentIntake({ inbox, async submit(request) { calls.push(request.idempotencyKey!); return { goalId: "goal-681", action: "CONTINUE_GOAL" }; } });
  const flushed = await restored.flush("online");
  assert.equal(flushed.length, 1);
  assert.deepEqual(calls, ["owner-command-1"]);
  const duplicate = await restored.receive({ deviceId: "zbook", platform: "windows", ownerCommandId: "owner-command-1", text: "GORIQを強化", connectivity: "online", goalSnapshotDigest: "a".repeat(64) });
  assert.equal(duplicate.recordId, queued.recordId);
  assert.equal(calls.length, 1);
});

test("unsupported devices and multiple iPhone identities fail closed", async () => {
  const intake = new DeviceDevelopmentIntake({ inbox: new MemoryDeviceDevelopmentInbox(), async submit() { return { goalId: "g", action: "CONTINUE_GOAL" }; } });
  await intake.receive({ deviceId: "iphone-1", platform: "ios", ownerCommandId: "one", text: "one", connectivity: "offline", goalSnapshotDigest: "a".repeat(64) });
  await assert.rejects(() => intake.receive({ deviceId: "iphone-2", platform: "ios", ownerCommandId: "two", text: "two", connectivity: "offline", goalSnapshotDigest: "a".repeat(64) }), /one iPhone/i);
  await assert.rejects(() => intake.receive({ deviceId: "android", platform: "android" as "ios", ownerCommandId: "three", text: "three", connectivity: "offline", goalSnapshotDigest: "a".repeat(64) }), /unsupported device/i);
});

