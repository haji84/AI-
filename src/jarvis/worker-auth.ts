import { createPublicKey, randomBytes, verify } from "node:crypto";

export interface JarvisWorkerIdentity {
  nodeId: string;
  publicKeyPem: string;
  enrolledAt: string;
  revokedAt?: string;
}

export interface JarvisSignedWorkerRequest {
  nodeId: string;
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  bodySha256: string;
  signatureBase64: string;
}

export function createEnrollmentChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export function canonicalWorkerRequest(input: Omit<JarvisSignedWorkerRequest, "signatureBase64">): string {
  return [input.nodeId, input.timestamp, input.nonce, input.method.toUpperCase(), input.path, input.bodySha256].join("\n");
}

export function verifyWorkerRequest(input: {
  identity: JarvisWorkerIdentity;
  request: JarvisSignedWorkerRequest;
  now?: Date;
  maxClockSkewMs?: number;
  seenNonce?: (nodeId: string, nonce: string) => boolean;
}): { ok: boolean; reason?: string } {
  if (input.identity.revokedAt) return { ok: false, reason: "worker identity revoked" };
  if (input.identity.nodeId !== input.request.nodeId) return { ok: false, reason: "node identity mismatch" };

  const now = input.now ?? new Date();
  const requestAt = new Date(input.request.timestamp);
  if (Number.isNaN(requestAt.getTime())) return { ok: false, reason: "invalid worker timestamp" };
  const maxSkew = input.maxClockSkewMs ?? 5 * 60_000;
  if (Math.abs(now.getTime() - requestAt.getTime()) > maxSkew) return { ok: false, reason: "worker timestamp outside allowed clock skew" };
  if (input.seenNonce?.(input.request.nodeId, input.request.nonce)) return { ok: false, reason: "worker nonce already used" };

  try {
    const publicKey = createPublicKey(input.identity.publicKeyPem);
    const canonical = canonicalWorkerRequest({
      nodeId: input.request.nodeId,
      timestamp: input.request.timestamp,
      nonce: input.request.nonce,
      method: input.request.method,
      path: input.request.path,
      bodySha256: input.request.bodySha256,
    });
    const signature = Buffer.from(input.request.signatureBase64, "base64");
    const ok = verify(null, Buffer.from(canonical, "utf8"), publicKey, signature);
    return ok ? { ok: true } : { ok: false, reason: "invalid worker signature" };
  } catch {
    return { ok: false, reason: "invalid worker public key or signature" };
  }
}

export class JarvisNonceRegistry {
  private readonly entries = new Map<string, number>();

  has(nodeId: string, nonce: string, now = Date.now()): boolean {
    this.cleanup(now);
    return this.entries.has(`${nodeId}:${nonce}`);
  }

  record(nodeId: string, nonce: string, ttlMs = 10 * 60_000, now = Date.now()): void {
    this.cleanup(now);
    this.entries.set(`${nodeId}:${nonce}`, now + ttlMs);
  }

  private cleanup(now: number): void {
    for (const [key, expiresAt] of this.entries) if (expiresAt <= now) this.entries.delete(key);
  }
}
