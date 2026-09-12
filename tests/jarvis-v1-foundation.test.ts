import assert from "node:assert/strict";
import test from "node:test";
import {
  JARVIS_MAX_NODES,
  JarvisEnrollmentService,
  JarvisExecutionRouter,
  JarvisFleetManager,
  JarvisHumanTakeoverManager,
  JarvisTaskQueue,
  evaluateJarvisPolicy,
  resolveJarvisRoute,
  type JarvisNode,
  type JarvisTask,
} from "../src/jarvis/index.ts";

function node(overrides: Partial<JarvisNode> = {}): JarvisNode {
  return {
    id: "android-001",
    label: "Android 001",
    kind: "android",
    status: "ready",
    capabilities: ["browser", "open-url", "remote-view", "remote-control", "wake-device", "background-worker"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: true,
      requireHumanForLockedDevice: true,
    },
    telemetry: { batteryPercent: 80, charging: true, network: "wifi", checkedAt: "2026-09-12T08:00:00.000Z" },
    enrollment: "quick",
    lastSeenAt: "2026-09-12T08:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<JarvisTask> = {}): JarvisTask {
  return {
    id: "task-001",
    idempotencyKey: "open-url:001",
    type: "open-url",
    payload: { url: "https://example.com" },
    status: "queued",
    requiredCapabilities: ["open-url"],
    priority: "normal",
    requiresOnline: true,
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-09-12T08:00:00.000Z",
    updatedAt: "2026-09-12T08:00:00.000Z",
    ...overrides,
  };
}

test("connection router covers online, LAN and full offline modes", () => {
  assert.equal(resolveJarvisRoute({ mobileOnline: true, pcOnline: true, sameLanAvailable: false }).mode, "full-online");
  assert.equal(resolveJarvisRoute({ mobileOnline: false, pcOnline: true, sameLanAvailable: true }).mode, "lan-only");
  assert.equal(resolveJarvisRoute({ mobileOnline: false, pcOnline: false, sameLanAvailable: false }).mode, "full-offline");
});

test("fleet supports up to 100 nodes and selects a capable healthy Android", () => {
  const fleet = new JarvisFleetManager();
  for (let i = 1; i <= JARVIS_MAX_NODES; i += 1) {
    fleet.register(node({ id: `android-${String(i).padStart(3, "0")}`, label: `Android ${i}` }));
  }
  assert.equal(fleet.list().length, 100);
  assert.throws(() => fleet.register(node({ id: "android-101" })), /fleet limit exceeded/);
  assert.equal(fleet.select(task())?.kind, "android");
});

test("task queue is sequential, idempotent and reclaims expired leases", () => {
  const queue = new JarvisTaskQueue();
  queue.enqueue(task());
  queue.enqueue(task({ id: "duplicate" }));
  assert.equal(queue.list().length, 1);
  assert.equal(queue.next()?.id, "task-001");
  queue.lease("task-001", "android-001", 1000, new Date("2026-09-12T08:00:00.000Z"));
  queue.reclaimExpiredLeases(new Date("2026-09-12T08:00:02.000Z"));
  assert.equal(queue.get("task-001")?.status, "queued");
});

test("execution router queues online work while fully offline and dispatches after reconnect", () => {
  const fleet = new JarvisFleetManager();
  const queue = new JarvisTaskQueue();
  fleet.register(node());
  queue.enqueue(task());
  const router = new JarvisExecutionRouter(fleet, queue);

  const offline = router.dispatchNext({ connectivity: { mobileOnline: false, pcOnline: false, sameLanAvailable: false } });
  assert.equal(offline?.status, "waiting-connectivity");
  queue.resumeConnectivity();
  const online = router.dispatchNext({ connectivity: { mobileOnline: true, pcOnline: true, sameLanAvailable: false } });
  assert.equal(online?.status, "dispatched");
  assert.equal(online?.node?.id, "android-001");
});

test("paid execution and locked personal-device work require a Human Gate", () => {
  const paid = evaluateJarvisPolicy({ task: task(), node: node(), incrementalCostYen: 1 });
  assert.equal(paid.allowed, false);
  assert.equal(paid.requiresHumanGate, true);

  const locked = evaluateJarvisPolicy({ task: task(), node: node({ status: "locked" }), incrementalCostYen: 0 });
  assert.equal(locked.allowed, false);
  assert.equal(locked.requiresHumanGate, true);
});

test("quick, full and fleet enrollment use expiring capacity-limited tokens", () => {
  const enrollment = new JarvisEnrollmentService();
  const fullToken = enrollment.createToken({ mode: "full", now: new Date("2026-09-12T08:00:00.000Z") });
  const enrolled = enrollment.consume(fullToken.token, node(), new Date("2026-09-12T08:01:00.000Z"));
  assert.equal(enrolled.node.enrollment, "full");

  const fleetToken = enrollment.createToken({ mode: "fleet", maxDevices: 2, group: "fleet-a", now: new Date("2026-09-12T08:00:00.000Z") });
  assert.equal(enrollment.consume(fleetToken.token, node({ id: "a" }), new Date("2026-09-12T08:01:00.000Z")).node.group, "fleet-a");
  enrollment.consume(fleetToken.token, node({ id: "b" }), new Date("2026-09-12T08:01:30.000Z"));
  assert.throws(() => enrollment.consume(fleetToken.token, node({ id: "c" }), new Date("2026-09-12T08:02:00.000Z")), /Invalid/);
});

test("Human Takeover lifecycle supports request, activation and resolution", () => {
  const takeover = new JarvisHumanTakeoverManager();
  const requested = takeover.request({ nodeId: "android-017", taskId: "task-017", reason: "unexpected login prompt" });
  assert.equal(requested.status, "requested");
  assert.equal(takeover.activate(requested.id).status, "active");
  assert.equal(takeover.activeForNode("android-017")?.status, "active");
  assert.equal(takeover.resolve(requested.id).status, "resolved");
  assert.equal(takeover.activeForNode("android-017"), undefined);
});
