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

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const identity: JarvisWorkerIdentity = {
  nodeId: "sec003-worker-001",
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  enrolledAt: "2026-09-20T00:00:00.000Z",
  algorithm: "ecdsa-p256-sha256",
};

function signedRequest(overrides: Partial<Omit<JarvisSignedWorkerRequest, "signatureBase64">> = {}) {
  const body = Buffer.from(JSON.stringify({ status: "ready" }), "utf8");
  const unsigned = {
    nodeId: identity.nodeId,
    timestamp: "2026-09-20T01:00:00.000Z",
    nonce: "sec003-nonce-001",
    method: "POST",
    path: "/api/jarvis/worker/heartbeat",
    bodySha256: createHash("sha256").update(body).digest("hex"),
    ...overrides,
  };
  return {
    request: {
      ...unsigned,
      signatureBase64: sign("sha256", Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), privateKey).toString("base64"),
    },
    body,
  };
}

const verifyAt = (request: JarvisSignedWorkerRequest, workerIdentity = identity) =>
  verifyWorkerRequest({ identity: workerIdentity, request, now: new Date("2026-09-20T01:01:00.000Z") });

test("SEC-003 accepts a valid enrolled-worker signature bound to the canonical request", () => {
  const { request } = signedRequest();
  assert.deepEqual(verifyAt(request), { ok: true });
});

test("SEC-003 rejects method, path, node, body-digest, and signature tampering", () => {
  const { request } = signedRequest();
  const tampered = [
    { ...request, method: "GET" },
    { ...request, path: "/api/jarvis/worker/result" },
    { ...request, nodeId: "sec003-worker-evil" },
    { ...request, bodySha256: createHash("sha256").update("tampered").digest("hex") },
    { ...request, signatureBase64: Buffer.from("invalid-signature", "utf8").toString("base64") },
  ];

  for (const candidate of tampered) assert.equal(verifyAt(candidate).ok, false);
});

test("SEC-003 rejects a signature under a different enrolled public key", () => {
  const { request } = signedRequest();
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const wrongIdentity: JarvisWorkerIdentity = {
    ...identity,
    publicKeyPem: other.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  assert.equal(verifyAt(request, wrongIdentity).ok, false);
});

test("SEC-003 Broker binds actual method/path/body before dispatch and authenticates first", () => {
  const broker = readFileSync("scripts/jarvis-broker.ts", "utf8");
  const workerBoundary = broker.indexOf('if (path.startsWith("/api/jarvis/worker/"))');
  const actualDigestCheck = broker.indexOf("safeEqualText(declaredBodySha as string, bodySha256(body))");
  const actualMethodBinding = broker.indexOf('method: request.method || "POST"');
  const actualPathBinding = broker.indexOf("path, bodySha256: declaredBodySha as string");
  const authentication = broker.indexOf("const identity = authenticateWorker(request, path, body)", workerBoundary);
  const firstWorkerRoute = broker.indexOf('path === "/api/jarvis/worker/heartbeat"', workerBoundary);

  assert.ok(actualDigestCheck >= 0, "Broker must bind the signature to the actual body digest");
  assert.ok(actualMethodBinding >= 0, "Broker must bind the signature to the actual HTTP method");
  assert.ok(actualPathBinding >= 0, "Broker must bind the signature to the actual request path");
  assert.ok(workerBoundary >= 0 && authentication > workerBoundary, "Worker boundary must authenticate requests");
  assert.ok(firstWorkerRoute > authentication, "Worker route handling must happen only after authentication");
});
