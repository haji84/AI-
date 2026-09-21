import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JarvisControlPlane, type JarvisNode } from "../src/jarvis/index.ts";

const T0 = new Date("2026-09-21T05:00:00.000Z");
const T1 = new Date("2026-09-21T05:01:00.000Z");
const T2 = new Date("2026-09-21T05:02:00.000Z");
const T3 = new Date("2026-09-21T05:03:00.000Z");

function node(): JarvisNode {
  return {
    id: "android-sec015-001",
    label: "Android SEC-015 001",
    kind: "android",
    status: "ready",
    capabilities: ["browser", "remote-view", "remote-control"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: true,
      requireHumanForLockedDevice: true,
    },
    telemetry: {
      batteryPercent: 80,
      charging: true,
      network: "wifi",
      checkedAt: T0.toISOString(),
    },
    enrollment: "quick",
    lastSeenAt: T0.toISOString(),
  };
}

function seededControlPlane() {
  const plane = new JarvisControlPlane();
  const token = plane.createEnrollment({ mode: "quick", now: T0 });
  const registered = plane.enroll(token.token, node(), T0);
  const task = plane.enqueueTask({
    idempotencyKey: "sec015-takeover-task",
    type: "browser",
    payload: { url: "https://example.com" },
    requiredCapabilities: ["browser"],
    priority: "normal",
    requiresOnline: true,
    targetNodeId: registered.id,
    maxAttempts: 3,
  }, T0);
  return { plane, registered, task };
}

test("SEC-015 audits takeover request, persists it, then audits explicit resume", () => {
  const { plane, registered, task } = seededControlPlane();

  const takeover = plane.requestTakeover({
    nodeId: registered.id,
    taskId: task.id,
    reason: "operator verification required",
    currentUrl: "https://example.com/check",
  }, T1);

  let snapshot = plane.snapshot(T1);
  assert.equal(plane.queue.get(task.id)?.status, "waiting-human");
  assert.equal(plane.fleet.get(registered.id)?.status, "needs-human");
  assert.equal(snapshot.activeTakeovers.length, 1);
  assert.equal(snapshot.activeTakeovers[0]?.id, takeover.id);

  const requested = snapshot.audit.find((event) => event.action === "takeover.requested");
  assert.ok(requested);
  assert.equal(requested.actor, "jarvis");
  assert.equal(requested.target, takeover.id);
  assert.deepEqual(requested.detail, {
    nodeId: registered.id,
    taskId: task.id,
    reason: "operator verification required",
  });

  const restored = new JarvisControlPlane();
  restored.restore(snapshot);
  const restoredSnapshot = restored.snapshot(T2);
  assert.equal(restoredSnapshot.activeTakeovers[0]?.id, takeover.id);
  assert.ok(restoredSnapshot.audit.some((event) => event.id === requested.id));
  assert.equal(restored.queue.get(task.id)?.status, "waiting-human");

  const resolved = restored.resolveTakeover(takeover.id, true, T3);
  assert.equal(resolved.status, "resolved");
  assert.equal(restored.queue.get(task.id)?.status, "queued");
  assert.equal(restored.fleet.get(registered.id)?.status, "ready");

  snapshot = restored.snapshot(T3);
  assert.equal(snapshot.activeTakeovers.length, 0);
  const resolvedAudit = snapshot.audit.find((event) => event.action === "takeover.resolved");
  assert.ok(resolvedAudit);
  assert.equal(resolvedAudit.actor, "owner");
  assert.equal(resolvedAudit.target, takeover.id);
  assert.deepEqual(resolvedAudit.detail, { resumeTask: true });
  assert.ok(snapshot.audit.findIndex((event) => event.id === requested.id) < snapshot.audit.findIndex((event) => event.id === resolvedAudit.id));
});

test("SEC-015 resolution without resume is audited and cannot silently resume the waiting task", () => {
  const { plane, registered, task } = seededControlPlane();
  const takeover = plane.requestTakeover({
    nodeId: registered.id,
    taskId: task.id,
    reason: "owner will inspect before deciding",
  }, T1);

  plane.resolveTakeover(takeover.id, false, T2);

  assert.equal(plane.queue.get(task.id)?.status, "waiting-human");
  const resolvedAudit = plane.snapshot(T2).audit.find((event) => event.action === "takeover.resolved");
  assert.ok(resolvedAudit);
  assert.equal(resolvedAudit.target, takeover.id);
  assert.deepEqual(resolvedAudit.detail, { resumeTask: false });
});

test("SEC-015 console association remains fail-closed on identity mismatch", () => {
  const source = readFileSync("src/app/jarvis/JarvisConsole.tsx", "utf8");

  assert.match(source, /activeTakeovers\.find\(\(item\) => item\.nodeId === remoteSerial\)/);
  assert.doesNotMatch(source, /activeTakeovers\.find\(\(item\) => item\.nodeId !== remoteSerial\)/);
  assert.match(source, /resolve-takeover/);
  assert.match(source, /sessionId: selectedTakeover\.id/);
});
