import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createJarvisFleetDeviceRecord } from "../src/jarvis/fleet-device-record.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";
import type { JarvisWorkerIdentity } from "../src/jarvis/worker-auth.ts";

function ed25519PublicKeyPem(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  return publicKey.export({ format: "pem", type: "spki" }).toString();
}

function node(overrides: Partial<JarvisNode> = {}): JarvisNode {
  return {
    id: "android-001",
    label: "Front desk Android",
    kind: "android",
    status: "ready",
    capabilities: ["open-url", "background-worker", "device-status"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: {
      batteryPercent: 82,
      charging: true,
      temperatureC: 31.5,
      freeStorageMb: 12_000,
      cpuLoadPercent: 18,
      network: "wifi",
      deviceOwner: true,
      adminActive: true,
      accessibilityEnabled: true,
      locked: false,
      screenInteractive: true,
      checkedAt: "2026-09-22T11:00:00.000Z",
    },
    enrollment: "full",
    fleetNumber: 1,
    group: "alpha",
    lastSeenAt: "2026-09-22T11:00:01.000Z",
    ...overrides,
  };
}

function identity(overrides: Partial<JarvisWorkerIdentity> = {}): JarvisWorkerIdentity {
  return {
    nodeId: "android-001",
    publicKeyPem: ed25519PublicKeyPem(),
    algorithm: "ed25519",
    enrolledAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

test("FLEET-007 binds identity signing capability platform connectivity and health in one record", () => {
  const sourceNode = node();
  const signingIdentity = identity();
  const record = createJarvisFleetDeviceRecord(sourceNode, signingIdentity);

  assert.deepEqual(record.identity, {
    nodeId: "android-001",
    label: "Front desk Android",
    enrollment: "full",
    fleetNumber: 1,
    group: "alpha",
  });
  assert.equal(record.signing.algorithm, "ed25519");
  assert.equal(record.signing.status, "active");
  assert.match(record.signing.publicKeySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(record.capabilities, ["open-url", "background-worker", "device-status"]);
  assert.deepEqual(record.platform, { kind: "android" });
  assert.deepEqual(record.connectivity, {
    network: "wifi",
    nodeStatus: "ready",
    lastSeenAt: "2026-09-22T11:00:01.000Z",
  });
  assert.equal(record.health.checkedAt, "2026-09-22T11:00:00.000Z");
  assert.equal(record.health.batteryPercent, 82);
  assert.equal(record.health.deviceOwner, true);

  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes(signingIdentity.publicKeyPem), false);
  assert.equal(serialized.includes("BEGIN PUBLIC KEY"), false);
});

test("FLEET-007 record output is clone-isolated from mutable node capabilities", () => {
  const sourceNode = node();
  const record = createJarvisFleetDeviceRecord(sourceNode, identity());

  record.capabilities.push("camera");
  assert.deepEqual(sourceNode.capabilities, ["open-url", "background-worker", "device-status"]);
});

test("FLEET-007 fails closed when node and signing identities do not match", () => {
  assert.throws(
    () => createJarvisFleetDeviceRecord(node(), identity({ nodeId: "android-999" })),
    /Worker signing identity mismatch/,
  );
});

test("FLEET-007 fails closed for malformed or algorithm-mismatched signing keys", () => {
  assert.throws(
    () => createJarvisFleetDeviceRecord(node(), identity({ publicKeyPem: "not-a-public-key" })),
  );

  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  assert.throws(
    () => createJarvisFleetDeviceRecord(node(), identity({
      publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
      algorithm: "ed25519",
    })),
    /does not match ed25519 algorithm/,
  );
});

test("FLEET-007 fails closed for invalid timestamps and duplicate capability declarations", () => {
  assert.throws(
    () => createJarvisFleetDeviceRecord(node({ lastSeenAt: "not-a-time" }), identity()),
    /Invalid last-seen timestamp/,
  );
  assert.throws(
    () => createJarvisFleetDeviceRecord(node({ telemetry: { checkedAt: "bad-time" } }), identity()),
    /Invalid health-check timestamp/,
  );
  assert.throws(
    () => createJarvisFleetDeviceRecord(node({ capabilities: ["open-url", "open-url"] }), identity()),
    /Duplicate JARVIS capability declaration/,
  );
});

test("FLEET-007 records revoked signing identity without exposing its raw key", () => {
  const signingIdentity = identity({ revokedAt: "2026-09-22T10:59:00.000Z" });
  const record = createJarvisFleetDeviceRecord(node(), signingIdentity);

  assert.equal(record.signing.status, "revoked");
  assert.equal(record.signing.revokedAt, "2026-09-22T10:59:00.000Z");
  assert.equal(JSON.stringify(record).includes(signingIdentity.publicKeyPem), false);
});
