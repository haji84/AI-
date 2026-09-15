import assert from "node:assert/strict";
import test from "node:test";
import {
  JarvisControlPlane,
  JarvisFleetManager,
  type JarvisNode,
  type JarvisTask,
} from "../src/jarvis/index.ts";

function node(id: string, overrides: Partial<JarvisNode> = {}): JarvisNode {
  return {
    id,
    label: id,
    kind: "android",
    status: "ready",
    capabilities: ["open-url", "browser", "remote-view", "remote-control", "wake-device", "background-worker"],
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
      checkedAt: "2026-09-15T09:00:00.000Z",
    },
    enrollment: "fleet",
    lastSeenAt: "2026-09-15T09:00:00.000Z",
    ...overrides,
  };
}

function task(id: string, targetNodeId?: string): JarvisTask {
  return {
    id,
    idempotencyKey: `acceptance:${id}`,
    type: "open-url",
    payload: { url: "https://example.com" },
    status: "queued",
    requiredCapabilities: ["open-url"],
    priority: "normal",
    requiresOnline: true,
    targetNodeId,
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-09-15T09:00:00.000Z",
    updatedAt: "2026-09-15T09:00:00.000Z",
  };
}

test("Issue #401 stage 6: five-node mixed fleet routes only to an eligible connected worker", () => {
  const fleet = new JarvisFleetManager();
  fleet.register(node("android-wifi-ready", { telemetry: { batteryPercent: 90, charging: true, network: "wifi", checkedAt: "2026-09-15T09:00:00.000Z" } }));
  fleet.register(node("android-cell-ready", { telemetry: { batteryPercent: 75, charging: false, network: "cellular", checkedAt: "2026-09-15T09:00:00.000Z" } }));
  fleet.register(node("android-offline", { status: "offline", telemetry: { batteryPercent: 90, charging: true, network: "offline", checkedAt: "2026-09-15T09:00:00.000Z" } }));
  fleet.register(node("android-disabled", { status: "disabled" }));
  fleet.register(node("android-busy-low", { status: "busy", telemetry: { batteryPercent: 10, charging: false, network: "wifi", checkedAt: "2026-09-15T09:00:00.000Z" } }));

  assert.equal(fleet.list().length, 5);
  const selected = fleet.select(task("mixed-five"));
  assert.equal(selected?.id, "android-wifi-ready");
  assert.notEqual(selected?.status, "offline");
  assert.notEqual(selected?.status, "disabled");
});

test("Issue #401 stage 7: ten-node scheduling survives Human Takeover and resumes the paused task", () => {
  const plane = new JarvisControlPlane();
  const enrollment = plane.createEnrollment({
    mode: "fleet",
    maxDevices: 10,
    group: "acceptance-10",
    now: new Date("2026-09-15T09:00:00.000Z"),
  });

  for (let i = 1; i <= 10; i += 1) {
    const id = `android-${String(i).padStart(3, "0")}`;
    plane.enroll(enrollment.token, node(id), new Date(`2026-09-15T09:00:${String(i).padStart(2, "0")}.000Z`));
  }
  assert.equal(plane.snapshot().stats.registered, 10);

  for (let i = 1; i <= 10; i += 1) {
    const nodeId = `android-${String(i).padStart(3, "0")}`;
    const queued = plane.enqueueTask({
      id: `acceptance-task-${i}`,
      idempotencyKey: `acceptance-task-${i}`,
      type: "open-url",
      payload: { url: `https://example.com/${i}` },
      requiredCapabilities: ["open-url"],
      priority: "normal",
      requiresOnline: true,
      targetNodeId: nodeId,
      maxAttempts: 3,
    }, new Date(`2026-09-15T09:01:${String(i).padStart(2, "0")}.000Z`));

    const dispatched = plane.dispatch(
      { mobileOnline: true, pcOnline: true, sameLanAvailable: true },
      new Date(`2026-09-15T09:02:${String(i).padStart(2, "0")}.000Z`),
    );
    assert.equal(dispatched?.status, "dispatched");
    assert.equal(dispatched?.node?.id, nodeId);
    assert.equal(dispatched?.task.id, queued.id);

    if (i === 5) {
      const takeover = plane.requestTakeover({
        nodeId,
        taskId: queued.id,
        reason: "acceptance login interruption",
      }, new Date("2026-09-15T09:03:05.000Z"));
      assert.equal(plane.queue.get(queued.id)?.status, "waiting-human");
      assert.equal(plane.fleet.get(nodeId)?.status, "needs-human");
      plane.resolveTakeover(takeover.id, true, new Date("2026-09-15T09:03:06.000Z"));
      assert.equal(plane.queue.get(queued.id)?.status, "queued");
      assert.equal(plane.fleet.get(nodeId)?.status, "ready");

      const resumed = plane.dispatch(
        { mobileOnline: true, pcOnline: true, sameLanAvailable: true },
        new Date("2026-09-15T09:03:07.000Z"),
      );
      assert.equal(resumed?.status, "dispatched");
      assert.equal(resumed?.node?.id, nodeId);
    }

    plane.markRunning(queued.id, nodeId);
    plane.completeTask(queued.id, nodeId, { acceptance: true });
  }

  const snapshot = plane.snapshot();
  assert.equal(snapshot.stats.registered, 10);
  assert.equal(snapshot.stats.completed, 10);
  assert.equal(snapshot.stats.failed, 0);
  assert.equal(snapshot.activeTakeovers.length, 0);
  assert(snapshot.audit.some((event) => event.action === "takeover.requested"));
  assert(snapshot.audit.some((event) => event.action === "takeover.resolved"));
});
