import { createHash } from "node:crypto";
import type { JarvisWorkerIdentity } from "./worker-auth.ts";

export type JarvisDeviceReplacementStatus = "AWAITING_HUMAN_GATE";

export interface JarvisDeviceReplacementPlan {
  status: JarvisDeviceReplacementStatus;
  requiresHumanGate: true;
  nodeId: string;
  action: "replace-worker-identity";
  reason: string;
  oldIdentityFingerprint: string;
  replacementIdentityFingerprint: string;
  proposedAt: string;
  proposedAfterApproval: {
    revokedIdentity: JarvisWorkerIdentity;
    replacementIdentity: JarvisWorkerIdentity;
  };
}

function fingerprintPublicKey(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem.trim(), "utf8").digest("hex");
}

function requireIsoTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("device replacement proposedAt must be an ISO timestamp");
  }
  return value;
}

export function planJarvisDeviceReplacement(input: {
  nodeId: string;
  currentIdentity: JarvisWorkerIdentity;
  replacementIdentity: JarvisWorkerIdentity;
  proposedAt: string;
}): JarvisDeviceReplacementPlan {
  const proposedAt = requireIsoTimestamp(input.proposedAt);
  const current = structuredClone(input.currentIdentity);
  const replacement = structuredClone(input.replacementIdentity);

  if (!input.nodeId.trim()) throw new Error("device replacement requires nodeId");
  if (current.nodeId !== input.nodeId) throw new Error("current worker identity does not match replacement node");
  if (replacement.nodeId !== input.nodeId) throw new Error("replacement worker identity does not match replacement node");
  if (current.revokedAt) throw new Error("current worker identity is already revoked");
  if (replacement.revokedAt) throw new Error("replacement worker identity must not already be revoked");

  const oldFingerprint = fingerprintPublicKey(current.publicKeyPem);
  const newFingerprint = fingerprintPublicKey(replacement.publicKeyPem);
  if (oldFingerprint === newFingerprint) {
    throw new Error("replacement worker identity must use a different public key");
  }

  return {
    status: "AWAITING_HUMAN_GATE",
    requiresHumanGate: true,
    nodeId: input.nodeId,
    action: "replace-worker-identity",
    reason: "revoking the existing worker identity and binding a replacement credential requires explicit owner approval",
    oldIdentityFingerprint: oldFingerprint,
    replacementIdentityFingerprint: newFingerprint,
    proposedAt,
    proposedAfterApproval: {
      revokedIdentity: { ...current, revokedAt: proposedAt },
      replacementIdentity: replacement,
    },
  };
}
