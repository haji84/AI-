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
  sanitizeJarvisNodeTelemetry,
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


test("Production FleetManager applies the shared resource placement policy", () => {
  const fleet = new JarvisFleetManager();
  fleet.register(node({
    id: "zbook",
    label: "ZBook",
    kind: "windows",
    capabilities: ["open-url", "gpu", "long-running"],
    telemetry: {
      checkedAt: "2026-09-28T05:00:00.000Z",
      cpuLoadPercent: 75,
      gpuLoadPercent: 20,
      gpuAvailable: true,
      memoryAvailableMb: 32_000,
      freeStorageMb: 100_000,
      charging: true,
      onExternalPower: true,
      thermalState: "nominal",
      dataLocalityKeys: ["dataset-A"],
    },
  }));
  fleet.register(node({
    id: "macbook",
    label: "MacBook",
    kind: "macos",
    capabilities: ["open-url", "long-running"],
    telemetry: {
      checkedAt: "2026-09-28T05:00:00.000Z",
      cpuLoadPercent: 10,
      memoryAvailableMb: 16_000,
      freeStorageMb: 100_000,
      charging: true,
      onExternalPower: true,
      thermalState: "nominal",
      dataLocalityKeys: ["dataset-B"],
    },
  }));

  const gpu = fleet.select(task({
    requiredCapabilities: ["open-url", "gpu"],
    resourceRequirements: { requireGpu: true, minMemoryAvailableMb: 24_000 },
  }));
  assert.equal(gpu?.id, "zbook");

  const localData = fleet.select(task({
    resourceRequirements: { preferredDataLocalityKeys: ["dataset-A"] },
  }));
  assert.equal(localData?.id, "zbook");
});

test("Production FleetManager fails closed on hard unknown resources while legacy tasks remain compatible", () => {
  const fleet = new JarvisFleetManager();
  fleet.register(node({
    id: "legacy",
    label: "Legacy",
    telemetry: {
      checkedAt: "2026-09-28T05:00:00.000Z",
      batteryPercent: 80,
      charging: true,
      cpuLoadPercent: 10,
    },
  }));

  assert.equal(fleet.select(task())?.id, "legacy");
  assert.equal(fleet.select(task({
    resourceRequirements: { minMemoryAvailableMb: 8_000 },
  })), undefined);
  assert.equal(fleet.select(task({
    resourceRequirements: { maxGpuLoadPercent: 50 },
  })), undefined);
});

test("Production FleetManager excludes critical thermal nodes and respects required data locality", () => {
  const fleet = new JarvisFleetManager();
  fleet.register(node({
    id: "critical",
    label: "Critical",
    telemetry: {
      checkedAt: "2026-09-28T05:00:00.000Z",
      cpuLoadPercent: 0,
      memoryAvailableMb: 64_000,
      charging: true,
      thermalState: "critical",
      dataLocalityKeys: ["dataset-A"],
    },
  }));
  fleet.register(node({
    id: "healthy",
    label: "Healthy",
    telemetry: {
      checkedAt: "2026-09-28T05:00:00.000Z",
      cpuLoadPercent: 30,
      memoryAvailableMb: 16_000,
      charging: true,
      thermalState: "nominal",
      dataLocalityKeys: ["dataset-A"],
    },
  }));

  const selected = fleet.select(task({
    resourceRequirements: { requiredDataLocalityKeys: ["dataset-A"] },
  }));
  assert.equal(selected?.id, "healthy");

  assert.equal(fleet.select(task({
    resourceRequirements: { requiredDataLocalityKeys: ["missing-dataset"] },
  })), undefined);
});


test("signed worker resource telemetry is bounded and path-like locality is discarded", () => {
  const telemetry = sanitizeJarvisNodeTelemetry({
    batteryPercent: 81,
    charging: true,
    cpuLoadPercent: 23,
    gpuLoadPercent: 15,
    memoryAvailableMb: 24_000,
    cpuAvailable: true,
    gpuAvailable: true,
    onExternalPower: true,
    thermalState: "nominal",
    dataLocalityKeys: [
      "dataset-A",
      "dataset-A",
      "model:v1",
      "../private/path",
      "a/b",
      "",
      ...Array.from({ length: 40 }, (_, index) => `key-${index}`),
    ],
    unknownSecretLikeField: "must-not-pass-through",
  }, new Date("2026-09-28T05:10:00.000Z"));

  assert.equal(telemetry?.checkedAt, "2026-09-28T05:10:00.000Z");
  assert.equal(telemetry?.memoryAvailableMb, 24_000);
  assert.equal(telemetry?.thermalState, "nominal");
  assert.ok((telemetry?.dataLocalityKeys?.length ?? 0) <= 32);
  assert.ok(telemetry?.dataLocalityKeys?.includes("dataset-A"));
  assert.ok(telemetry?.dataLocalityKeys?.includes("model:v1"));
  assert.ok(!telemetry?.dataLocalityKeys?.some((key) => key.includes("/") || key.includes("..")));
  assert.equal("unknownSecretLikeField" in (telemetry ?? {}), false);

  const invalid = sanitizeJarvisNodeTelemetry({
    batteryPercent: 200,
    cpuLoadPercent: -1,
    gpuLoadPercent: 101,
    memoryAvailableMb: -5,
    thermalState: "melting",
    network: "satellite",
  }, new Date("2026-09-28T05:11:00.000Z"));
  assert.equal(invalid?.batteryPercent, undefined);
  assert.equal(invalid?.cpuLoadPercent, undefined);
  assert.equal(invalid?.gpuLoadPercent, undefined);
  assert.equal(invalid?.memoryAvailableMb, undefined);
  assert.equal(invalid?.thermalState, undefined);
  assert.equal(invalid?.network, undefined);
});
