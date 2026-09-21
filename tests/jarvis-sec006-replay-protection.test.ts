import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  JarvisNonceRegistry,
  JarvisSqliteStateStore,
  canonicalWorkerRequest,
  verifyWorkerRequest,
  type JarvisSignedWorkerRequest,
  type JarvisWorkerIdentity,
} from "../src/jarvis/index.ts";

const START = Date.parse("2026-09-21T00:00:00.000Z");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const identity: JarvisWorkerIdentity = {
  nodeId: "sec006-worker-a",
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  enrolledAt: "2026-09-20T23:00:00.000Z",
  algorithm: "ed25519",
};

function signedWorkerRequest(nonce: string): JarvisSignedWorkerRequest {
  const unsigned = {
    nodeId: identity.nodeId,
    timestamp: new Date(START).toISOString(),
    nonce,
    method: "POST",
    path: "/api/jarvis/worker/result",
    bodySha256: createHash("sha256").update("{\"ok\":true}").digest("hex"),
  };
  return {
    ...unsigned,
    signatureBase64: sign(null, Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), privateKey).toString("base64"),
  };
}

test("SEC-006 rejects an accepted signed Worker request after Broker-state restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-sec006-"));
  const databasePath = join(directory, "jarvis.db");
  const request = signedWorkerRequest("sec006-replay-a");

  try {
    const firstStore = new JarvisSqliteStateStore(databasePath);
    const firstRegistry = new JarvisNonceRegistry();
    assert.deepEqual(verifyWorkerRequest({
      identity,
      request,
      now: new Date(START),
      seenNonce: (nodeId, nonce) => firstRegistry.has(nodeId, nonce, START),
    }), { ok: true });
    firstRegistry.record(identity.nodeId, request.nonce, 60_000, START);
    firstStore.close();

    const restartedStore = new JarvisSqliteStateStore(databasePath);
    const restartedRegistry = new JarvisNonceRegistry();
    assert.deepEqual(verifyWorkerRequest({
      identity,
      request,
      now: new Date(START + 30_000),
      seenNonce: (nodeId, nonce) => restartedRegistry.has(nodeId, nonce, START + 30_000),
    }), { ok: false, reason: "worker nonce already used" });
    restartedStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SEC-006 durable replay state remains per-node and expires at the bounded TTL", () => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-sec006-"));
  const databasePath = join(directory, "jarvis.db");

  try {
    const firstStore = new JarvisSqliteStateStore(databasePath);
    const firstRegistry = new JarvisNonceRegistry();
    firstRegistry.record(identity.nodeId, "sec006-replay-ttl", 60_000, START);
    firstStore.close();

    const restartedStore = new JarvisSqliteStateStore(databasePath);
    const restartedRegistry = new JarvisNonceRegistry();
    assert.equal(restartedRegistry.has(identity.nodeId, "sec006-replay-ttl", START + 59_999), true);
    assert.equal(restartedRegistry.has("sec006-worker-b", "sec006-replay-ttl", START + 59_999), false);
    assert.equal(restartedRegistry.has(identity.nodeId, "sec006-replay-ttl", START + 60_000), false);

    restartedRegistry.record(identity.nodeId, "sec006-replay-ttl", 60_000, START + 60_000);
    assert.equal(restartedRegistry.has(identity.nodeId, "sec006-replay-ttl", START + 60_001), true);
    restartedStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SEC-006 Broker installs durable state before nonce registry and still verifies before recording", () => {
  const broker = readFileSync("scripts/jarvis-broker.ts", "utf8");
  const storeCreation = broker.indexOf("const store = new JarvisSqliteStateStore(");
  const nonceCreation = broker.indexOf("const nonces = new JarvisNonceRegistry();", storeCreation);
  const authenticateFunction = broker.indexOf("function authenticateWorker(", nonceCreation);
  const verifyCall = broker.indexOf("const checked = verifyWorkerRequest(", authenticateFunction);
  const failClosedCheck = broker.indexOf("if (!checked.ok) return undefined", verifyCall);
  const nonceRecord = broker.indexOf("nonces.record(signed.nodeId, signed.nonce)", failClosedCheck);
  const workerRouteBoundary = broker.indexOf('if (path.startsWith("/api/jarvis/worker/"))', nonceRecord);

  assert.ok(storeCreation >= 0, "Broker durable state store must exist");
  assert.ok(nonceCreation > storeCreation, "durable state store must install nonce persistence before registry construction");
  assert.ok(verifyCall > authenticateFunction, "Worker verification must run inside authentication");
  assert.ok(failClosedCheck > verifyCall, "failed verification must stop before replay state is recorded");
  assert.ok(nonceRecord > failClosedCheck, "accepted nonce must be recorded only after successful verification");
  assert.ok(workerRouteBoundary > nonceRecord, "Worker route handling must remain behind replay protection");
});
