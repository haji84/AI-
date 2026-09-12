import assert from "node:assert/strict";
import test from "node:test";
import {
  JarvisControlPlane,
  JarvisSqliteStateStore,
  type JarvisNode,
} from "../src/jarvis/index.ts";

function node(): JarvisNode {
  return {
    id: "android-persist-001",
    label: "Android Persist 001",
    kind: "android",
    status: "ready",
    capabilities: ["open-url", "browser"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: { batteryPercent: 77, charging: true, network: "wifi", checkedAt: "2026-09-12T08:00:00.000Z" },
    enrollment: "quick",
    lastSeenAt: "2026-09-12T08:00:00.000Z",
  };
}

test("control plane survives a SQLite save/load/restore cycle", () => {
  const store = new JarvisSqliteStateStore(":memory:");
  const original = new JarvisControlPlane();
  const token = original.createEnrollment({ mode: "quick", now: new Date("2026-09-12T08:00:00.000Z") });
  original.enroll(token.token, node(), new Date("2026-09-12T08:01:00.000Z"));
  const task = original.enqueueTask({
    idempotencyKey: "persist-task",
    type: "open-url",
    payload: { url: "https://example.com" },
    requiredCapabilities: ["open-url"],
    priority: "normal",
    requiresOnline: true,
    maxAttempts: 3,
  }, new Date("2026-09-12T08:02:00.000Z"));
  original.dispatch({ mobileOnline: true, pcOnline: true, sameLanAvailable: false }, new Date("2026-09-12T08:03:00.000Z"));
  original.requestTakeover({ nodeId: node().id, taskId: task.id, reason: "manual check" }, new Date("2026-09-12T08:04:00.000Z"));

  store.save(original.snapshot(new Date("2026-09-12T08:05:00.000Z")));
  const persisted = store.load();
  assert(persisted);

  const restored = new JarvisControlPlane();
  restored.restore(persisted);
  const snapshot = restored.snapshot(new Date("2026-09-12T08:06:00.000Z"));
  assert.equal(snapshot.fleet.length, 1);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0]?.status, "waiting-human");
  assert.equal(snapshot.activeTakeovers.length, 1);
  assert(snapshot.audit.length >= 1);
  store.close();
});
