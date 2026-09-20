import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalWorkerRequest, verifyWorkerRequest } from "../src/jarvis/index.ts";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const identity = {
  nodeId: "android-ecdsa-001",
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  enrolledAt: "2026-09-12T07:00:00.000Z",
  algorithm: "ecdsa-p256-sha256" as const,
};

function signedRequest(input: {
  body: Buffer;
  path: string;
  timestamp?: string;
  nonce?: string;
  method?: string;
}) {
  const unsigned = {
    nodeId: identity.nodeId,
    timestamp: input.timestamp ?? "2026-09-12T08:00:00.000Z",
    nonce: input.nonce ?? "ecdsa-nonce-001",
    method: input.method ?? "POST",
    path: input.path,
    bodySha256: createHash("sha256").update(input.body).digest("hex"),
  };
  return {
    ...unsigned,
    signatureBase64: sign("sha256", Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), privateKey).toString("base64"),
  };
}

test("Android-compatible P-256 ECDSA worker heartbeat signatures verify", () => {
  const body = Buffer.from(JSON.stringify({ status: "ready" }), "utf8");
  const request = signedRequest({ body, path: "/api/jarvis/worker/heartbeat" });

  const result = verifyWorkerRequest({
    identity,
    request,
    now: new Date("2026-09-12T08:01:00.000Z"),
  });
  assert.deepEqual(result, { ok: true });
});

test("worker result requests remain signed and path/body binding rejects tampering", () => {
  const body = Buffer.from(JSON.stringify({ taskId: "task-1", ok: true, detail: { status: "done" } }), "utf8");
  const request = signedRequest({ body, path: "/api/jarvis/worker/result", nonce: "ecdsa-result-001" });

  assert.deepEqual(
    verifyWorkerRequest({ identity, request, now: new Date("2026-09-12T08:01:00.000Z") }),
    { ok: true },
  );
  assert.equal(
    verifyWorkerRequest({
      identity,
      request: { ...request, path: "/api/jarvis/worker/heartbeat" },
      now: new Date("2026-09-12T08:01:00.000Z"),
    }).ok,
    false,
  );
  assert.equal(
    verifyWorkerRequest({
      identity,
      request: { ...request, bodySha256: createHash("sha256").update("tampered").digest("hex") },
      now: new Date("2026-09-12T08:01:00.000Z"),
    }).ok,
    false,
  );
});

test("worker request verification rejects stale/future clocks and replayed nonces", () => {
  const body = Buffer.from(JSON.stringify({ status: "ready" }), "utf8");
  const request = signedRequest({ body, path: "/api/jarvis/worker/heartbeat", nonce: "ecdsa-clock-001" });

  assert.deepEqual(
    verifyWorkerRequest({ identity, request, now: new Date("2026-09-12T08:06:00.001Z") }),
    { ok: false, reason: "worker timestamp outside allowed clock skew" },
  );
  assert.deepEqual(
    verifyWorkerRequest({ identity, request, now: new Date("2026-09-12T07:53:59.999Z") }),
    { ok: false, reason: "worker timestamp outside allowed clock skew" },
  );
  assert.deepEqual(
    verifyWorkerRequest({
      identity,
      request,
      now: new Date("2026-09-12T08:01:00.000Z"),
      seenNonce: (nodeId, nonce) => nodeId === identity.nodeId && nonce === request.nonce,
    }),
    { ok: false, reason: "worker nonce already used" },
  );
});

test("broker authenticates every worker route before heartbeat, command, or result handling", () => {
  const broker = readFileSync("scripts/jarvis-broker.ts", "utf8");
  const workerBlockStart = broker.indexOf('if (path.startsWith("/api/jarvis/worker/"))');
  const authentication = broker.indexOf("const identity = authenticateWorker(request, path, body)", workerBlockStart);
  const heartbeatRoute = broker.indexOf('path === "/api/jarvis/worker/heartbeat"', workerBlockStart);
  const nextRoute = broker.indexOf('path === "/api/jarvis/worker/next"', workerBlockStart);
  const resultRoute = broker.indexOf('path === "/api/jarvis/worker/result"', workerBlockStart);

  assert.ok(workerBlockStart >= 0, "worker route boundary must exist");
  assert.ok(authentication > workerBlockStart, "worker boundary must authenticate before dispatch");
  assert.ok(heartbeatRoute > authentication, "heartbeat must be behind worker authentication");
  assert.ok(nextRoute > authentication, "task polling must be behind worker authentication");
  assert.ok(resultRoute > authentication, "task results must be behind worker authentication");
  assert.match(broker, /safeEqualText\(declaredBodySha as string, bodySha256\(body\)\)/);
  assert.match(broker, /nonces\.record\(signed\.nodeId, signed\.nonce\)/);
});
