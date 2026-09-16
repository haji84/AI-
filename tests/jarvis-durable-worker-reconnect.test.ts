import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JarvisNonceRegistry, canonicalWorkerRequest, verifyWorkerRequest } from "../src/jarvis/worker-auth.ts";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import type { JarvisSignedWorkerRequest, JarvisWorkerIdentity } from "../src/jarvis/worker-auth.ts";

function makeSignedRequest(input: {
  identity: JarvisWorkerIdentity;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  timestamp: string;
  nonce: string;
}): JarvisSignedWorkerRequest {
  const method = "POST";
  const path = "/api/jarvis/worker/heartbeat";
  const body = Buffer.from('{"status":"ready"}', "utf8");
  const unsigned = {
    nodeId: input.identity.nodeId,
    timestamp: input.timestamp,
    nonce: input.nonce,
    method,
    path,
    bodySha256: createHash("sha256").update(body).digest("hex"),
  };
  const signatureBase64 = sign(null, Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), input.privateKey).toString("base64");
  return { ...unsigned, signatureBase64 };
}

test("worker identity survives state-store reopen and authenticates without re-enrollment", () => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-reconnect-"));
  const dbPath = join(directory, "jarvis.db");
  try {
    const pair = generateKeyPairSync("ed25519");
    const identity: JarvisWorkerIdentity = {
      nodeId: "android-001",
      publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      algorithm: "ed25519",
      enrolledAt: "2026-09-16T04:00:00.000Z",
    };

    const first = new JarvisSqliteStateStore(dbPath);
    first.saveWorkerIdentity(identity, new Date("2026-09-16T04:00:00.000Z"));
    first.close();

    const reopened = new JarvisSqliteStateStore(dbPath);
    const durableIdentity = reopened.getWorkerIdentity(identity.nodeId);
    assert.deepEqual(durableIdentity, identity);

    const now = new Date("2026-09-16T04:05:00.000Z");
    const request = makeSignedRequest({
      identity,
      privateKey: pair.privateKey,
      timestamp: now.toISOString(),
      nonce: "reconnect-after-store-reopen",
    });
    const nonces = new JarvisNonceRegistry();
    const result = verifyWorkerRequest({
      identity: durableIdentity!,
      request,
      now,
      seenNonce: (nodeId, nonce) => nonces.has(nodeId, nonce, now.getTime()),
    });
    assert.deepEqual(result, { ok: true });

    nonces.record(identity.nodeId, request.nonce, 10 * 60_000, now.getTime());
    assert.deepEqual(verifyWorkerRequest({
      identity: durableIdentity!,
      request,
      now,
      seenNonce: (nodeId, nonce) => nonces.has(nodeId, nonce, now.getTime()),
    }), { ok: false, reason: "worker nonce already used" });
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("revocation survives state-store reopen and reconnect fails closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-revoked-reconnect-"));
  const dbPath = join(directory, "jarvis.db");
  try {
    const pair = generateKeyPairSync("ed25519");
    const identity: JarvisWorkerIdentity = {
      nodeId: "android-009",
      publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      algorithm: "ed25519",
      enrolledAt: "2026-09-16T04:00:00.000Z",
    };
    const first = new JarvisSqliteStateStore(dbPath);
    first.saveWorkerIdentity(identity);
    const revoked = first.revokeWorkerIdentity(identity.nodeId, new Date("2026-09-16T04:10:00.000Z"));
    assert.equal(revoked?.revokedAt, "2026-09-16T04:10:00.000Z");
    first.close();

    const reopened = new JarvisSqliteStateStore(dbPath);
    const durableRevoked = reopened.getWorkerIdentity(identity.nodeId)!;
    assert.equal(durableRevoked.revokedAt, "2026-09-16T04:10:00.000Z");
    const now = new Date("2026-09-16T04:11:00.000Z");
    const request = makeSignedRequest({ identity, privateKey: pair.privateKey, timestamp: now.toISOString(), nonce: "revoked-after-reopen" });
    assert.deepEqual(verifyWorkerRequest({ identity: durableRevoked, request, now }), { ok: false, reason: "worker identity revoked" });
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
