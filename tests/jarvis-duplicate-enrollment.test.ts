import assert from "node:assert/strict";
import test from "node:test";
import { JarvisControlPlane, type JarvisNode } from "../src/jarvis/index.ts";

function node(id: string, label = id): JarvisNode {
  return {
    id,
    label,
    kind: "android",
    status: "ready",
    capabilities: ["open-url", "device-status"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: { checkedAt: "2026-09-16T04:00:00.000Z", network: "wifi" },
    enrollment: "quick",
    lastSeenAt: "2026-09-16T04:00:00.000Z",
  };
}

test("ordinary enrollment rejects an already-registered logical node before token consumption", () => {
  const plane = new JarvisControlPlane();
  const first = plane.createEnrollment({ mode: "quick", maxDevices: 1, now: new Date("2026-09-16T04:00:00.000Z") });
  plane.enroll(first.token, node("android-001", "original"), new Date("2026-09-16T04:00:01.000Z"));

  const replacementAttempt = plane.createEnrollment({ mode: "quick", maxDevices: 1, now: new Date("2026-09-16T04:01:00.000Z") });
  const before = plane.fleet.get("android-001");

  assert.throws(
    () => plane.enroll(replacementAttempt.token, node("android-001", "replacement-attempt"), new Date("2026-09-16T04:01:01.000Z")),
    /owner-approved replacement required/,
  );
  assert.deepEqual(plane.fleet.get("android-001"), before);

  const enrolledSecondNode = plane.enroll(
    replacementAttempt.token,
    node("android-002", "second-real-device"),
    new Date("2026-09-16T04:01:02.000Z"),
  );
  assert.equal(enrolledSecondNode.id, "android-002");
  assert.equal(plane.snapshot().stats.registered, 2);
});

test("already-enrolled worker continues through heartbeat rather than re-enrollment", () => {
  const plane = new JarvisControlPlane();
  const token = plane.createEnrollment({ mode: "quick", now: new Date("2026-09-16T04:10:00.000Z") });
  plane.enroll(token.token, node("android-001"), new Date("2026-09-16T04:10:01.000Z"));

  const reconnected = plane.heartbeat("android-001", {
    status: "ready",
    telemetry: { checkedAt: "2026-09-16T04:11:00.000Z", network: "wifi", batteryPercent: 90 },
  }, new Date("2026-09-16T04:11:00.000Z"));

  assert.equal(reconnected.id, "android-001");
  assert.equal(reconnected.telemetry.batteryPercent, 90);
  assert.equal(plane.snapshot().stats.registered, 1);
});
