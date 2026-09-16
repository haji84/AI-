import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import type { JarvisWorkerIdentity, JarvisWorkerSignatureAlgorithm } from "./worker-auth.ts";

const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_PENDING = 100;

export interface JarvisReplacementCandidateRequest {
  nodeId: string;
  publicKeyPem: string;
  algorithm: JarvisWorkerSignatureAlgorithm;
}

export interface JarvisReplacementChallenge {
  candidateId: string;
  nodeId: string;
  algorithm: JarvisWorkerSignatureAlgorithm;
  publicKeyFingerprint: string;
  challenge: string;
  issuedAt: string;
  expiresAt: string;
  signingPayload: string;
}

export interface JarvisVerifiedReplacementCandidate {
  status: "READY_FOR_HUMAN_GATE";
  requiresHumanGate: true;
  candidateId: string;
  nodeId: string;
  algorithm: JarvisWorkerSignatureAlgorithm;
  publicKeyPem: string;
  publicKeyFingerprint: string;
  verifiedAt: string;
  reason: string;
}

type PendingCandidate = JarvisReplacementChallenge & { publicKeyPem: string };

function fingerprint(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem.trim(), "utf8").digest("hex");
}

function validatePublicKey(publicKeyPem: string, algorithm: JarvisWorkerSignatureAlgorithm): void {
  const key = createPublicKey(publicKeyPem);
  if (algorithm === "ed25519" && key.asymmetricKeyType !== "ed25519") {
    throw new Error("replacement candidate must provide an Ed25519 public key");
  }
  if (algorithm === "ecdsa-p256-sha256") {
    if (key.asymmetricKeyType !== "ec") throw new Error("replacement candidate must provide an EC public key");
    const details = key.asymmetricKeyDetails;
    if (details?.namedCurve !== "prime256v1") throw new Error("replacement candidate EC key must use P-256");
  }
}

export function replacementCandidateSigningPayload(input: {
  candidateId: string;
  nodeId: string;
  challenge: string;
  publicKeyFingerprint: string;
  expiresAt: string;
}): string {
  return [
    "JARVIS_DEVICE_REPLACEMENT_V1",
    input.candidateId,
    input.nodeId,
    input.challenge,
    input.publicKeyFingerprint,
    input.expiresAt,
  ].join("\n");
}

export class JarvisDeviceReplacementCandidateManager {
  private readonly pending = new Map<string, PendingCandidate>();
  private readonly maxPending: number;

  constructor(maxPending = DEFAULT_MAX_PENDING) {
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 100) {
      throw new Error("replacement candidate maxPending must be 1..100");
    }
    this.maxPending = maxPending;
  }

  create(input: {
    currentIdentity: JarvisWorkerIdentity;
    replacement: JarvisReplacementCandidateRequest;
    now?: Date;
    ttlMs?: number;
  }): JarvisReplacementChallenge {
    const now = input.now ?? new Date();
    this.cleanup(now);
    if (this.pending.size >= this.maxPending) throw new Error("replacement candidate capacity reached");
    if (!input.replacement.nodeId.trim()) throw new Error("replacement candidate requires nodeId");
    if (input.currentIdentity.nodeId !== input.replacement.nodeId) throw new Error("replacement candidate node does not match current identity");
    if (input.currentIdentity.revokedAt) throw new Error("current worker identity is already revoked");
    validatePublicKey(input.replacement.publicKeyPem, input.replacement.algorithm);

    const currentFingerprint = fingerprint(input.currentIdentity.publicKeyPem);
    const replacementFingerprint = fingerprint(input.replacement.publicKeyPem);
    if (currentFingerprint === replacementFingerprint) throw new Error("replacement candidate must use a different public key");

    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) throw new Error("replacement candidate ttl must be within 10 minutes");
    const candidateId = randomUUID();
    const challenge = randomBytes(32).toString("base64url");
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const signingPayload = replacementCandidateSigningPayload({ candidateId, nodeId: input.replacement.nodeId, challenge, publicKeyFingerprint: replacementFingerprint, expiresAt });
    const record: PendingCandidate = {
      candidateId,
      nodeId: input.replacement.nodeId,
      algorithm: input.replacement.algorithm,
      publicKeyPem: input.replacement.publicKeyPem,
      publicKeyFingerprint: replacementFingerprint,
      challenge,
      issuedAt,
      expiresAt,
      signingPayload,
    };
    this.pending.set(candidateId, record);
    return this.publicChallenge(record);
  }

  verify(input: { candidateId: string; nodeId: string; signatureBase64: string; now?: Date }): JarvisVerifiedReplacementCandidate {
    const now = input.now ?? new Date();
    this.cleanup(now);
    const record = this.pending.get(input.candidateId);
    if (!record) throw new Error("replacement candidate is unknown, expired, or already verified");
    if (record.nodeId !== input.nodeId) throw new Error("replacement candidate node mismatch");
    if (!input.signatureBase64.trim()) throw new Error("replacement candidate signature is required");

    let ok = false;
    try {
      const key = createPublicKey(record.publicKeyPem);
      const signature = Buffer.from(input.signatureBase64, "base64");
      ok = record.algorithm === "ed25519"
        ? verify(null, Buffer.from(record.signingPayload, "utf8"), key, signature)
        : verify("sha256", Buffer.from(record.signingPayload, "utf8"), key, signature);
    } catch {
      ok = false;
    }
    if (!ok) throw new Error("replacement candidate proof is invalid");

    this.pending.delete(record.candidateId);
    return {
      status: "READY_FOR_HUMAN_GATE",
      requiresHumanGate: true,
      candidateId: record.candidateId,
      nodeId: record.nodeId,
      algorithm: record.algorithm,
      publicKeyPem: record.publicKeyPem,
      publicKeyFingerprint: record.publicKeyFingerprint,
      verifiedAt: now.toISOString(),
      reason: "replacement key possession is verified; revoking the current identity and binding this replacement still requires explicit owner approval",
    };
  }

  size(now = new Date()): number {
    this.cleanup(now);
    return this.pending.size;
  }

  private publicChallenge(record: PendingCandidate): JarvisReplacementChallenge {
    return {
      candidateId: record.candidateId,
      nodeId: record.nodeId,
      algorithm: record.algorithm,
      publicKeyFingerprint: record.publicKeyFingerprint,
      challenge: record.challenge,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      signingPayload: record.signingPayload,
    };
  }

  private cleanup(now: Date): void {
    for (const [candidateId, candidate] of this.pending) {
      if (Date.parse(candidate.expiresAt) <= now.getTime()) this.pending.delete(candidateId);
    }
  }
}
