import assert from "node:assert/strict";
import test from "node:test";
import { WorkerRemoteMailbox, validateWorkerRemoteAction } from "../src/jarvis/worker-remote-mailbox.ts";
import { remoteDeviceInventory } from "../src/jarvis/remote-device-inventory.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";

const node = (): JarvisNode => ({ id: "wifi-device", label: "Android 002", kind: "android", status: "ready", capabilities: ["remote-view", "remote-control"], policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: true, requireHumanForLockedDevice: true }, telemetry: { checkedAt: new Date().toISOString(), accessibilityEnabled: true, remoteProtocol: 1, androidApi: 30 }, enrollment: "quick", lastSeenAt: new Date().toISOString() });

test("all registered workers remain visible without gateway, but capabilities fail closed", () => {
  const ready = node();
  assert.equal(remoteDeviceInventory([ready], [])[0].remoteAssistCapability, "CONTROLLABLE");
  for (const changed of [
    { ...ready, telemetry: { ...ready.telemetry, remoteProtocol: undefined } },
    { ...ready, telemetry: { ...ready.telemetry, locked: true } },
    { ...ready, capabilities: [] },
    { ...ready, lastSeenAt: "invalid" },
    { ...ready, lastSeenAt: new Date(Date.now() - 100_000).toISOString() },
    { ...ready, policy: { ...ready.policy, allowRemoteControl: false } },
    { ...ready, status: "busy" as const },
  ]) {
    const inventory = remoteDeviceInventory([changed], []);
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0].serial, "worker:wifi-device");
    assert.equal(inventory[0].remoteAssistCapability, null);
  }
  assert.equal(remoteDeviceInventory([ready, { ...ready, id: "second" }], [{ serial: "adb", state: "device" }]).length, 3);
});

test("remote input is claimed once, cannot be completed by another device or replayed", async () => {
  const mailbox = new WorkerRemoteMailbox();
  const result = mailbox.request("A", "session-A", { action: "tap", x: 12, y: 15 }, Date.now() + 5_000);
  assert.equal(mailbox.claim("B"), null);
  const command = mailbox.claim("A")!;
  assert.equal(mailbox.claim("A"), null);
  assert.throws(() => mailbox.request("A", "session-B", { action: "screenshot" }, Date.now() + 5_000));
  assert.throws(() => mailbox.finish("B", command.id, { ok: true }));
  assert.throws(() => mailbox.finish("A", "wrong", { ok: true }));
  mailbox.finish("A", command.id, { ok: true });
  assert.deepEqual(await result, { ok: true });
  assert.throws(() => mailbox.finish("A", command.id, { ok: true }));
});

test("expired and cancelled input is never redelivered; ending one session preserves others", async () => {
  const mailbox = new WorkerRemoteMailbox();
  const expired = mailbox.request("A", "one", { action: "screenshot" }, Date.now() + 25);
  await assert.rejects(expired);
  assert.equal(mailbox.claim("A"), null);
  const cancelled = mailbox.request("A", "one", { action: "keyevent", key: "HOME" }, Date.now() + 1_000);
  const preserved = mailbox.request("B", "two", { action: "screenshot" }, Date.now() + 1_000);
  const rejected = assert.rejects(cancelled);
  mailbox.endSession("one");
  await rejected;
  assert.equal(mailbox.claim("A"), null);
  assert.throws(() => mailbox.request("A", "one", { action: "tap", x: 1, y: 1 }, Date.now() + 1_000), "session end may arrive before a delayed dispatch");
  const command = mailbox.claim("B")!;
  mailbox.finish("B", command.id, { ok: true });
  await preserved;
});

test("rejects arbitrary commands, unbounded input and invalid coordinates", () => {
  for (const input of [{ action: "shell", command: "anything" }, { action: "tap", x: NaN, y: 0 }, { action: "tap", x: -1, y: 0 }, { action: "text", text: "a".repeat(2_001) }, { action: "keyevent", key: "POWER" }]) assert.throws(() => validateWorkerRemoteAction(input));
  assert.deepEqual(validateWorkerRemoteAction({ action: "swipe", x1: 1, y1: 2, x2: 3, y2: 4, durationMs: Infinity }), { action: "swipe", x1: 1, y1: 2, x2: 3, y2: 4, durationMs: 350 });
});
