import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  JarvisNonceRegistry,
  canonicalWorkerRequest,
  verifyWorkerRequest,
  type JarvisSignedWorkerRequest,
  type JarvisWorkerIdentity,
} from "../src/jarvis/worker-auth.ts";

const NOW = new Date("2026-09-20T02:00:00.000Z");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const identity: JarvisWorkerIdentity = {
  nodeId: "sec005-worker-a",
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  enrolledAt: "2026-09-20T01:00:00.000Z",
  algorithm: "ed25519",
};

function signedWorkerRequest(nonce: string): JarvisSignedWorkerRequest {
  const unsigned = {
    nodeId: identity.nodeId,
    timestamp: NOW.toISOString(),
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

test("SEC-005 cryptographically binds the nonce into the Worker signature", () => {
  const request = signedWorkerRequest("sec005-nonce-a");
  assert.deepEqual(verifyWorkerRequest({ identity, request, now: NOW }), { ok: true });

  assert.deepEqual(
    verifyWorkerRequest({ identity, request: { ...request, nonce: "sec005-nonce-tampered" }, now: NOW }),
    { ok: false, reason: "invalid worker signature" },
  );
});

test("SEC-005 rejects a recorded nonce for the same node while keeping nonce scope per node", () => {
  const registry = new JarvisNonceRegistry();
  const request = signedWorkerRequest("sec005-nonce-replay");

  assert.deepEqual(verifyWorkerRequest({
    identity,
    request,
    now: NOW,
    seenNonce: (nodeId, nonce) => registry.has(nodeId, nonce, NOW.getTime()),
  }), { ok: true });

  registry.record(identity.nodeId, request.nonce, 10 * 60_000, NOW.getTime());

  assert.deepEqual(verifyWorkerRequest({
    identity,
    request,
    now: NOW,
    seenNonce: (nodeId, nonce) => registry.has(nodeId, nonce, NOW.getTime()),
  }), { ok: false, reason: "worker nonce already used" });

  assert.equal(registry.has("sec005-worker-b", request.nonce, NOW.getTime()), false);
});

test("SEC-005 nonce registry expires entries at the bounded TTL boundary", () => {
  const registry = new JarvisNonceRegistry();
  const start = NOW.getTime();
  registry.record(identity.nodeId, "sec005-nonce-ttl", 60_000, start);

  assert.equal(registry.has(identity.nodeId, "sec005-nonce-ttl", start + 59_999), true);
  assert.equal(registry.has(identity.nodeId, "sec005-nonce-ttl", start + 60_000), false);
});

test("SEC-005 Broker verifies a signed nonce before recording it and before Worker route handling", () => {
  const broker = readFileSync("scripts/jarvis-broker.ts", "utf8");
  const signedRequestFunction = broker.indexOf("function signedWorkerRequest(");
  const nonceHeader = broker.indexOf('request.headers["x-jarvis-nonce"]', signedRequestFunction);
  const authenticateFunction = broker.indexOf("function authenticateWorker(", signedRequestFunction);
  const verifyCall = broker.indexOf("const checked = verifyWorkerRequest(", authenticateFunction);
  const failClosedCheck = broker.indexOf("if (!checked.ok) return undefined", verifyCall);
  const nonceRecord = broker.indexOf("nonces.record(signed.nodeId, signed.nonce)", failClosedCheck);
  const workerRouteBoundary = broker.indexOf('if (path.startsWith("/api/jarvis/worker/"))', nonceRecord);

  assert.ok(signedRequestFunction >= 0, "signed Worker request parser must exist");
  assert.ok(nonceHeader > signedRequestFunction, "Worker nonce must come from the signed-request headers");
  assert.ok(authenticateFunction > nonceHeader, "Worker authentication must consume the parsed nonce");
  assert.ok(verifyCall > authenticateFunction, "signature/clock/nonce verification must run inside Worker authentication");
  assert.ok(failClosedCheck > verifyCall, "failed verification must return before nonce recording");
  assert.ok(nonceRecord > failClosedCheck, "nonce must be recorded only after successful verification");
  assert.ok(workerRouteBoundary > nonceRecord, "Worker route handling must remain behind authenticated nonce processing");
});
