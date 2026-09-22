import { createHash, createPublicKey } from "node:crypto";

import type {
  JarvisCapability,
  JarvisNode,
  JarvisNodeKind,
  JarvisNodeStatus,
} from "./types.ts";
import type {
  JarvisWorkerIdentity,
  JarvisWorkerSignatureAlgorithm,
} from "./worker-auth.ts";

export interface JarvisFleetDeviceRecord {
  identity: {
    nodeId: string;
    label: string;
    enrollment: JarvisNode["enrollment"];
    fleetNumber?: number;
    group?: string;
  };
  signing: {
    algorithm: JarvisWorkerSignatureAlgorithm;
    publicKeySha256: string;
    enrolledAt: string;
    status: "active" | "revoked";
    revokedAt?: string;
  };
  capabilities: JarvisCapability[];
  platform: {
    kind: JarvisNodeKind;
  };
  connectivity: {
    network: NonNullable<JarvisNode["telemetry"]["network"]> | "unknown";
    nodeStatus: JarvisNodeStatus;
    lastSeenAt: string;
  };
  health: {
    checkedAt: string;
    batteryPercent?: number;
    charging?: boolean;
    temperatureC?: number;
    freeStorageMb?: number;
    cpuLoadPercent?: number;
    gpuLoadPercent?: number;
    deviceOwner?: boolean;
    adminActive?: boolean;
    accessibilityEnabled?: boolean;
    locked?: boolean;
    screenInteractive?: boolean;
  };
}

function normalizedTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label} timestamp`);
  return parsed.toISOString();
}

function signingFingerprint(identity: JarvisWorkerIdentity): {
  algorithm: JarvisWorkerSignatureAlgorithm;
  publicKeySha256: string;
} {
  const algorithm = identity.algorithm ?? "ed25519";
  const publicKey = createPublicKey(identity.publicKeyPem);

  if (algorithm === "ed25519" && publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Worker signing key does not match ed25519 algorithm");
  }
  if (algorithm === "ecdsa-p256-sha256") {
    const details = publicKey.asymmetricKeyDetails;
    if (publicKey.asymmetricKeyType !== "ec" || details?.namedCurve !== "prime256v1") {
      throw new Error("Worker signing key does not match ecdsa-p256-sha256 algorithm");
    }
  }

  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    algorithm,
    publicKeySha256: createHash("sha256").update(spki).digest("hex"),
  };
}

export function createJarvisFleetDeviceRecord(
  node: JarvisNode,
  workerIdentity: JarvisWorkerIdentity,
): JarvisFleetDeviceRecord {
  if (workerIdentity.nodeId !== node.id) {
    throw new Error(`Worker signing identity mismatch for JARVIS node: ${node.id}`);
  }

  if (new Set(node.capabilities).size !== node.capabilities.length) {
    throw new Error(`Duplicate JARVIS capability declaration for node: ${node.id}`);
  }

  const signing = signingFingerprint(workerIdentity);
  const enrolledAt = normalizedTimestamp(workerIdentity.enrolledAt, "worker enrollment");
  const revokedAt = workerIdentity.revokedAt
    ? normalizedTimestamp(workerIdentity.revokedAt, "worker revocation")
    : undefined;
  const lastSeenAt = normalizedTimestamp(node.lastSeenAt, "last-seen");
  const checkedAt = normalizedTimestamp(node.telemetry.checkedAt, "health-check");

  return {
    identity: {
      nodeId: node.id,
      label: node.label,
      enrollment: node.enrollment,
      ...(node.fleetNumber === undefined ? {} : { fleetNumber: node.fleetNumber }),
      ...(node.group === undefined ? {} : { group: node.group }),
    },
    signing: {
      ...signing,
      enrolledAt,
      status: revokedAt ? "revoked" : "active",
      ...(revokedAt ? { revokedAt } : {}),
    },
    capabilities: [...node.capabilities],
    platform: { kind: node.kind },
    connectivity: {
      network: node.telemetry.network ?? "unknown",
      nodeStatus: node.status,
      lastSeenAt,
    },
    health: {
      checkedAt,
      ...(node.telemetry.batteryPercent === undefined ? {} : { batteryPercent: node.telemetry.batteryPercent }),
      ...(node.telemetry.charging === undefined ? {} : { charging: node.telemetry.charging }),
      ...(node.telemetry.temperatureC === undefined ? {} : { temperatureC: node.telemetry.temperatureC }),
      ...(node.telemetry.freeStorageMb === undefined ? {} : { freeStorageMb: node.telemetry.freeStorageMb }),
      ...(node.telemetry.cpuLoadPercent === undefined ? {} : { cpuLoadPercent: node.telemetry.cpuLoadPercent }),
      ...(node.telemetry.gpuLoadPercent === undefined ? {} : { gpuLoadPercent: node.telemetry.gpuLoadPercent }),
      ...(node.telemetry.deviceOwner === undefined ? {} : { deviceOwner: node.telemetry.deviceOwner }),
      ...(node.telemetry.adminActive === undefined ? {} : { adminActive: node.telemetry.adminActive }),
      ...(node.telemetry.accessibilityEnabled === undefined ? {} : { accessibilityEnabled: node.telemetry.accessibilityEnabled }),
      ...(node.telemetry.locked === undefined ? {} : { locked: node.telemetry.locked }),
      ...(node.telemetry.screenInteractive === undefined ? {} : { screenInteractive: node.telemetry.screenInteractive }),
    },
  };
}
