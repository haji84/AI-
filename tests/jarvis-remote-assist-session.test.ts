import assert from "node:assert/strict";
import test from "node:test";
import {
  JarvisRemoteAssistSessionManager,
  capabilityForRemoteDevice,
  isManualRemoteAction,
} from "../src/jarvis/remote-assist.ts";

test("Remote Assist session is bounded to one device and expires closed", () => {
  const manager = new JarvisRemoteAssistSessionManager(1_000, 5_000);
  const start = new Date("2026-09-16T00:00:00.000Z");
  const session = manager.start({ serial: "android-001", capability: "CONTROLLABLE" }, start);

  assert.equal(session.status, "active");
  assert.equal(session.serial, "android-001");
  assert.equal(session.expiresAt, "2026-09-16T00:00:01.000Z");
  assert.equal(manager.requireActive(session.id, "android-001", new Date("2026-09-16T00:00:00.500Z")).id, session.id);
  assert.throws(
    () => manager.requireActive(session.id, "android-002", new Date("2026-09-16T00:00:00.500Z")),
    /another device/,
  );
  assert.throws(
    () => manager.requireActive(session.id, "android-001", new Date("2026-09-16T00:00:01.001Z")),
    /not active/,
  );
  assert.equal(manager.get(session.id, new Date("2026-09-16T00:00:01.001Z"))?.status, "expired");
  assert(manager.auditFor(session.id).some((event) => event.action === "session.expired"));
});

test("Remote Assist touch renews idle TTL and end fails closed for further use", () => {
  const manager = new JarvisRemoteAssistSessionManager(1_000, 5_000);
  const session = manager.start({ serial: "android-001", capability: "CONTROLLABLE" }, new Date("2026-09-16T00:00:00.000Z"));

  const touched = manager.touch(session.id, "android-001", new Date("2026-09-16T00:00:00.800Z"));
  assert.equal(touched.expiresAt, "2026-09-16T00:00:01.800Z");
  assert.equal(manager.requireActive(session.id, "android-001", new Date("2026-09-16T00:00:01.500Z")).status, "active");

  const ended = manager.end(session.id, new Date("2026-09-16T00:00:01.600Z"));
  assert.equal(ended.status, "ended");
  assert.throws(
    () => manager.requireActive(session.id, "android-001", new Date("2026-09-16T00:00:01.700Z")),
    /not active/,
  );
  assert.deepEqual(
    manager.auditFor(session.id).map((event) => event.action),
    ["session.created", "session.touched", "session.ended"],
  );
});

test("Remote Assist TTL is capped and capability derivation is conservative", () => {
  const manager = new JarvisRemoteAssistSessionManager(1_000, 5_000);
  const session = manager.start({ serial: "android-001", capability: "CONTROLLABLE", ttlMs: 60_000 }, new Date("2026-09-16T00:00:00.000Z"));
  assert.equal(session.expiresAt, "2026-09-16T00:00:05.000Z");

  assert.equal(capabilityForRemoteDevice({ canView: false, canControl: false }), null);
  assert.equal(capabilityForRemoteDevice({ canView: true, canControl: false }), "VIEW_ONLY");
  assert.equal(capabilityForRemoteDevice({ canView: true, canControl: true }), "CONTROLLABLE");
  assert.equal(capabilityForRemoteDevice({ canView: true, canControl: true, fullManagement: true }), "FULL_MANAGEMENT");
  assert.equal(capabilityForRemoteDevice({ canView: true, canControl: false, fullManagement: true }), "VIEW_ONLY");
});

test("only manual Remote Assist actions are session-gated by the route contract", () => {
  for (const action of ["screenshot", "tap", "swipe", "text", "keyevent", "open-url"]) {
    assert.equal(isManualRemoteAction(action), true, action);
  }
  for (const action of ["qa-sequence-start", "qa-sequence-status", "session-start", "session-end", "reboot", "delete"]) {
    assert.equal(isManualRemoteAction(action), false, action);
  }
});
