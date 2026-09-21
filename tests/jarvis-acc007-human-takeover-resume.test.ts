import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JarvisControlPlane, type JarvisNode } from "../src/jarvis/index.ts";

const T0 = new Date("2026-09-22T00:00:00.000Z");
const T1 = new Date("2026-09-22T00:01:00.000Z");
const T2 = new Date("2026-09-22T00:02:00.000Z");
const T3 = new Date("2026-09-22T00:03:00.000Z");
const T4 = new Date("2026-09-22T00:04:00.000Z");
const T5 = new Date("2026-09-22T00:05:00.000Z");
const T6 = new Date("2026-09-22T00:06:00.000Z");

const ONLINE = { mobileOnline: true, pcOnline: true, sameLanAvailable: false };

function node(): JarvisNode {
  return {
    id: "android-acc007-001",
    label: "Android ACC-007 001",
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

function failedTaskControlPlane() {
  const plane = new JarvisControlPlane();
  const token = plane.createEnrollment({ mode: "quick", now: T0 });
  const registered = plane.enroll(token.token, node(), T0);
  const task = plane.enqueueTask({
    idempotencyKey: "acc007-takeover-task",
    type: "browser",
    payload: { url: "https://example.com/check" },
    requiredCapabilities: ["browser"],
    priority: "normal",
    requiresOnline: true,
    targetNodeId: registered.id,
    maxAttempts: 1,
  }, T0);

  const dispatched = plane.dispatch(ONLINE, T1);
  assert.equal(dispatched?.status, "dispatched");
  assert.equal(dispatched?.task.id, task.id);
  plane.markRunning(task.id, registered.id, T1);
  const failed = plane.failTask(task.id, registered.id, "verification failed", T2);
  assert.equal(failed.status, "failed");

  return { plane, registered, task };
}

test("ACC-007 terminal failure stops for Human Takeover, survives restart, resumes only explicitly, then completes", () => {
  const { plane, registered, task } = failedTaskControlPlane();

  const takeover = plane.requestTakeover({
    nodeId: registered.id,
    taskId: task.id,
    reason: "human correction required after failed verification",
    currentUrl: "https://example.com/check",
  }, T3);

  assert.equal(plane.queue.get(task.id)?.status, "waiting-human");
  assert.equal(plane.fleet.get(registered.id)?.status, "needs-human");
  assert.equal(plane.dispatch(ONLINE, T3), undefined);

  const snapshot = plane.snapshot(T3);
  assert.ok(snapshot.audit.some((event) => event.action === "task.failed" && event.target === task.id));
  assert.ok(snapshot.audit.some((event) => event.action === "takeover.requested" && event.target === takeover.id));

  const restored = new JarvisControlPlane();
  restored.restore(snapshot);
  assert.equal(restored.queue.get(task.id)?.status, "waiting-human");
  assert.equal(restored.snapshot(T4).activeTakeovers[0]?.id, takeover.id);
  assert.equal(restored.dispatch(ONLINE, T4), undefined);

  restored.resolveTakeover(takeover.id, true, T4);
  assert.equal(restored.queue.get(task.id)?.status, "queued");
  assert.equal(restored.fleet.get(registered.id)?.status, "ready");

  const resumed = restored.dispatch(ONLINE, T5);
  assert.equal(resumed?.status, "dispatched");
  assert.equal(resumed?.task.id, task.id);
  restored.markRunning(task.id, registered.id, T5);
  const completed = restored.completeTask(task.id, registered.id, { verified: true }, T6);
  assert.equal(completed.status, "completed");

  const finalAudit = restored.snapshot(T6).audit;
  const failedIndex = finalAudit.findIndex((event) => event.action === "task.failed" && event.target === task.id);
  const requestedIndex = finalAudit.findIndex((event) => event.action === "takeover.requested" && event.target === takeover.id);
  const resolvedIndex = finalAudit.findIndex((event) => event.action === "takeover.resolved" && event.target === takeover.id);
  const completedIndex = finalAudit.findIndex((event) => event.action === "task.completed" && event.target === task.id);
  assert.ok(failedIndex >= 0 && failedIndex < requestedIndex);
  assert.ok(requestedIndex < resolvedIndex);
  assert.ok(resolvedIndex < completedIndex);
  assert.deepEqual(finalAudit[resolvedIndex]?.detail, { resumeTask: true });
});

test("ACC-007 resolving Human Takeover without resume cannot silently restart the task", () => {
  const { plane, registered, task } = failedTaskControlPlane();
  const takeover = plane.requestTakeover({
    nodeId: registered.id,
    taskId: task.id,
    reason: "owner inspected but did not authorize resume",
  }, T3);

  plane.resolveTakeover(takeover.id, false, T4);

  assert.equal(plane.queue.get(task.id)?.status, "waiting-human");
  assert.equal(plane.dispatch(ONLINE, T5), undefined);
  const audit = plane.snapshot(T5).audit.find((event) => event.action === "takeover.resolved" && event.target === takeover.id);
  assert.ok(audit);
  assert.deepEqual(audit.detail, { resumeTask: false });
});

test("ACC-007 owner action route requires authentication and an explicit resume decision", () => {
  const route = readFileSync("src/app/api/jarvis/action/route.ts", "utf8");
  const consoleSource = readFileSync("src/app/jarvis/JarvisConsole.tsx", "utf8");

  assert.match(route, /if \(!\(await requireJarvisOwner\(\)\)\) return NextResponse\.json/);
  assert.match(route, /typeof payload\.resumeTask !== "boolean"/);
  assert.match(route, /body = \{ sessionId: payload\.sessionId, resumeTask: payload\.resumeTask \}/);
  assert.doesNotMatch(route, /resumeTask: payload\.resumeTask !== false/);
  assert.match(consoleSource, /action: "resolve-takeover", sessionId: selectedTakeover\.id, resumeTask: true/);
  assert.match(consoleSource, /action: "resolve-takeover", sessionId: item\.id, resumeTask: true/);
});
