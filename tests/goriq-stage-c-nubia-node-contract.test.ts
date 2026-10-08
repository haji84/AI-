import assert from "node:assert/strict";
import test from "node:test";

import { JarvisControlPlane } from "../src/jarvis/control-plane.ts";
import { sanitizeJarvisAndroidNodeContract } from "../src/jarvis/fleet-manager.ts";
import type { JarvisAndroidNodeContractV1, JarvisNode } from "../src/jarvis/types.ts";

const now = new Date("2026-10-01T00:00:00.000Z");

function contract(overrides: Partial<JarvisAndroidNodeContractV1> = {}): JarvisAndroidNodeContractV1 {
  return {
    schemaVersion: 1,
    platform: "android",
    architecture: "arm64-v8a",
    executionModes: ["foreground", "background-scheduled", "deferred"],
    networkRequirement: "offline-capable",
    persistence: { localState: true, checkpointResume: false, offlineQueue: false },
    migration: { supported: ["RESTARTABLE", "PINNED"], checkpointResume: false, sideEffectingFencing: false },
    security: { credentialIsolation: true, taskScopedAuthorization: true },
    constraints: { residentExecution: false, lockedUiRequiresHuman: true },
    resources: {
      cpuCores: 8,
      memoryAvailableMb: 4096,
      freeStorageMb: 32768,
      batteryPercent: 80,
      charging: false,
      network: "wifi",
    },
    checkedAt: "client-time",
    ...overrides,
  };
}

function androidNode(nodeContract?: JarvisAndroidNodeContractV1): JarvisNode {
  return {
    id: "nubia-canary",
    label: "Nubia 5S",
    kind: "android",
    status: "ready",
    capabilities: ["browser", "camera", "gps"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: { checkedAt: now.toISOString(), batteryPercent: 80, charging: false, network: "wifi" },
    nodeContract,
    enrollment: "full",
    lastSeenAt: now.toISOString(),
  };
}

test("Stage C sanitizer accepts truthful Android Node Contract and server-stamps time", () => {
  const sanitized = sanitizeJarvisAndroidNodeContract(contract(), now);
  assert.ok(sanitized);
  assert.equal(sanitized.platform, "android");
  assert.equal(sanitized.architecture, "arm64-v8a");
  assert.deepEqual(sanitized.executionModes, ["foreground", "background-scheduled", "deferred"]);
  assert.deepEqual(sanitized.migration.supported, ["RESTARTABLE", "PINNED"]);
  assert.equal(sanitized.persistence.checkpointResume, false);
  assert.equal(sanitized.persistence.offlineQueue, false);
  assert.equal(sanitized.migration.sideEffectingFencing, false);
  assert.equal(sanitized.constraints.residentExecution, false);
  assert.equal(sanitized.checkedAt, now.toISOString());
});

test("Stage C sanitizer rejects overclaimed checkpoint and side-effect semantics", () => {
  assert.equal(sanitizeJarvisAndroidNodeContract(contract({
    persistence: { localState: true, checkpointResume: true, offlineQueue: false },
  }), now), undefined);

  assert.equal(sanitizeJarvisAndroidNodeContract(contract({
    migration: { supported: ["RESTARTABLE"], checkpointResume: false, sideEffectingFencing: true },
  }), now), undefined);
});

test("legacy Android node without Node Contract remains compatible", () => {
  const plane = new JarvisControlPlane();
  plane.fleet.register(androidNode(undefined));
  const updated = plane.heartbeat("nubia-canary", {
    status: "ready",
    telemetry: { checkedAt: now.toISOString(), batteryPercent: 79, network: "wifi" },
  }, new Date("2026-10-01T00:01:00.000Z"));

  assert.equal(updated.nodeContract, undefined);
  assert.equal(updated.telemetry.batteryPercent, 79);
});

test("heartbeat updates sanitized Node Contract without losing fleet state", () => {
  const plane = new JarvisControlPlane();
  const first = sanitizeJarvisAndroidNodeContract(contract(), now)!;
  plane.fleet.register({ ...androidNode(first), fleetNumber: 7, group: "owner-canary" });

  const next = sanitizeJarvisAndroidNodeContract(contract({
    resources: {
      cpuCores: 8,
      memoryAvailableMb: 3072,
      freeStorageMb: 32000,
      batteryPercent: 70,
      charging: true,
      network: "cellular",
    },
  }), new Date("2026-10-01T00:02:00.000Z"))!;

  const updated = plane.heartbeat("nubia-canary", {
    status: "busy",
    nodeContract: next,
    telemetry: {
      checkedAt: "ignored-client-time",
      memoryAvailableMb: 3072,
      freeStorageMb: 32000,
      batteryPercent: 70,
      charging: true,
      network: "cellular",
    },
  }, new Date("2026-10-01T00:02:00.000Z"));

  assert.equal(updated.status, "busy");
  assert.equal(updated.nodeContract?.resources.memoryAvailableMb, 3072);
  assert.equal(updated.nodeContract?.resources.network, "cellular");
  assert.equal(updated.fleetNumber, 7);
  assert.equal(updated.group, "owner-canary");
  assert.equal(updated.telemetry.checkedAt, "2026-10-01T00:02:00.000Z");
});
