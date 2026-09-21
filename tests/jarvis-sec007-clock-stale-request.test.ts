import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalWorkerRequest,
  verifyWorkerRequest,
  type JarvisSignedWorkerRequest,
  type JarvisWorkerIdentity,
} from "../src/jarvis/index.ts";

const CLOCK_SKEW_MS = 5 * 60_000;
const NOW = Date.parse("2026-09-21T01:00:00.000Z");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const identity: JarvisWorkerIdentity = {
  nodeId: "sec007-worker-a",
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  enrolledAt: "2026-09-21T00:00:00.000Z",
  algorithm: "ed25519",
};

function signedRequest(timestamp: string): JarvisSignedWorkerRequest {
  const unsigned = {
    nodeId: identity.nodeId,
    timestamp,
    nonce: `sec007-${timestamp}`,
    method: "POST",
    path: "/api/jarvis/worker/heartbeat",
    bodySha256: createHash("sha256").update("{}").digest("hex"),
  };
  return {
    ...unsigned,
    signatureBase64: sign(null, Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), privateKey).toString("base64"),
  };
}

function verifyAt(request: JarvisSignedWorkerRequest, now = NOW) {
  return verifyWorkerRequest({ identity, request, now: new Date(now) });
}

test("SEC-007 rejects malformed Worker timestamps before signature acceptance", () => {
  assert.deepEqual(verifyAt(signedRequest("not-a-timestamp")), { ok: false, reason: "invalid worker timestamp" });
});

test("SEC-007 rejects stale past and too-far-future signed Worker requests", () => {
  const stale = signedRequest(new Date(NOW - CLOCK_SKEW_MS - 1).toISOString());
  const future = signedRequest(new Date(NOW + CLOCK_SKEW_MS + 1).toISOString());
  assert.deepEqual(verifyAt(stale), { ok: false, reason: "worker timestamp outside allowed clock skew" });
  assert.deepEqual(verifyAt(future), { ok: false, reason: "worker timestamp outside allowed clock skew" });
});

test("SEC-007 accepts exact skew boundaries and rejects the next millisecond", () => {
  const pastBoundary = signedRequest(new Date(NOW - CLOCK_SKEW_MS).toISOString());
  const futureBoundary = signedRequest(new Date(NOW + CLOCK_SKEW_MS).toISOString());
  assert.deepEqual(verifyAt(pastBoundary), { ok: true });
  assert.deepEqual(verifyAt(futureBoundary), { ok: true });

  const pastOutside = signedRequest(new Date(NOW - CLOCK_SKEW_MS - 1).toISOString());
  const futureOutside = signedRequest(new Date(NOW + CLOCK_SKEW_MS + 1).toISOString());
  assert.equal(verifyAt(pastOutside).ok, false);
  assert.equal(verifyAt(futureOutside).ok, false);
});

test("SEC-007 Broker binds timestamp header and verifies freshness before recording nonce or dispatching Worker routes", () => {
  const broker = readFileSync("scripts/jarvis-broker.ts", "utf8");
  const timestampHeader = broker.indexOf('const timestamp = request.headers["x-jarvis-timestamp"]');
  const signedTimestamp = broker.indexOf("timestamp: timestamp as string", timestampHeader);
  const authenticateFunction = broker.indexOf("function authenticateWorker(", signedTimestamp);
  const verifyCall = broker.indexOf("const checked = verifyWorkerRequest(", authenticateFunction);
  const failClosedCheck = broker.indexOf("if (!checked.ok) return undefined", verifyCall);
  const nonceRecord = broker.indexOf("nonces.record(signed.nodeId, signed.nonce)", failClosedCheck);
  const workerBoundary = broker.indexOf('if (path.startsWith("/api/jarvis/worker/"))', nonceRecord);

  assert.ok(timestampHeader >= 0, "Broker must read the signed Worker timestamp header");
  assert.ok(signedTimestamp > timestampHeader, "Broker must bind the received timestamp into the signed request");
  assert.ok(verifyCall > authenticateFunction, "Broker must run Worker freshness/signature verification during authentication");
  assert.ok(failClosedCheck > verifyCall, "failed freshness/signature verification must stop authentication");
  assert.ok(nonceRecord > failClosedCheck, "nonce must be recorded only after freshness/signature verification succeeds");
  assert.ok(workerBoundary > nonceRecord, "Worker route dispatch must remain behind authenticated freshness checks");
});
