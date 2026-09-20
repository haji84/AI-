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
  nodeId: "sec004-worker-001",
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  enrolledAt: "2026-09-20T00:00:00.000Z",
  algorithm: "ecdsa-p256-sha256",
};

function signedResult(path: "/api/jarvis/worker/result" | "/api/jarvis/worker/remote/result", body: Buffer, nonce: string) {
  const unsigned = {
    nodeId: identity.nodeId,
    timestamp: "2026-09-20T01:00:00.000Z",
    nonce,
    method: "POST",
    path,
    bodySha256: createHash("sha256").update(body).digest("hex"),
  };
  return {
    ...unsigned,
    signatureBase64: sign("sha256", Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), privateKey).toString("base64"),
  } satisfies JarvisSignedWorkerRequest;
}

const verifyAt = (request: JarvisSignedWorkerRequest, workerIdentity = identity) =>
  verifyWorkerRequest({ identity: workerIdentity, request, now: new Date("2026-09-20T01:01:00.000Z") });

test("SEC-004 accepts signed task and remote-result payloads bound to their exact result route", () => {
  const taskBody = Buffer.from(JSON.stringify({ taskId: "task-004", ok: true, detail: { status: "done" } }), "utf8");
  const remoteBody = Buffer.from(JSON.stringify({ id: "remote-004", ok: true, detail: { action: "wake-device" } }), "utf8");

  assert.deepEqual(verifyAt(signedResult("/api/jarvis/worker/result", taskBody, "sec004-task-result-001")), { ok: true });
  assert.deepEqual(verifyAt(signedResult("/api/jarvis/worker/remote/result", remoteBody, "sec004-remote-result-001")), { ok: true });
});

test("SEC-004 rejects result path, body digest, node identity, and signature tampering", () => {
  const body = Buffer.from(JSON.stringify({ taskId: "task-004", ok: true, detail: { status: "done" } }), "utf8");
  const request = signedResult("/api/jarvis/worker/result", body, "sec004-tamper-001");
  const tampered: JarvisSignedWorkerRequest[] = [
    { ...request, path: "/api/jarvis/worker/remote/result" },
    { ...request, bodySha256: createHash("sha256").update("tampered-result").digest("hex") },
    { ...request, nodeId: "sec004-worker-evil" },
    { ...request, signatureBase64: Buffer.from("invalid-signature", "utf8").toString("base64") },
  ];

  for (const candidate of tampered) assert.equal(verifyAt(candidate).ok, false);
});

test("SEC-004 rejects a result signed for a different enrolled public key", () => {
  const body = Buffer.from(JSON.stringify({ taskId: "task-004", ok: false, detail: { error: "expected-test-failure" } }), "utf8");
  const request = signedResult("/api/jarvis/worker/result", body, "sec004-key-001");
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const wrongIdentity: JarvisWorkerIdentity = {
    ...identity,
    publicKeyPem: other.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };

  assert.equal(verifyAt(request, wrongIdentity).ok, false);
});

test("SEC-004 Broker authenticates result bytes before parsing or applying either result route", () => {
  const broker = readFileSync("scripts/jarvis-broker.ts", "utf8");
  const workerBoundary = broker.indexOf('if (path.startsWith("/api/jarvis/worker/"))');
  const authentication = broker.indexOf("const identity = authenticateWorker(request, path, body)", workerBoundary);
  const payloadParse = broker.indexOf("const payload = parseJson(body)", authentication);
  const remoteResultRoute = broker.indexOf('path === "/api/jarvis/worker/remote/result"', workerBoundary);
  const taskResultRoute = broker.indexOf('path === "/api/jarvis/worker/result"', workerBoundary);

  assert.ok(workerBoundary >= 0, "Worker route boundary must exist");
  assert.ok(authentication > workerBoundary, "Worker boundary must authenticate before route handling");
  assert.ok(payloadParse > authentication, "Result JSON must be parsed only after the signed raw body authenticates");
  assert.ok(remoteResultRoute > payloadParse, "Remote results must remain behind Worker authentication");
  assert.ok(taskResultRoute > payloadParse, "Task results must remain behind Worker authentication");
  assert.match(broker, /safeEqualText\(declaredBodySha as string, bodySha256\(body\)\)/);
  assert.match(broker, /remoteMailbox\.finish\(identity\.nodeId, payload\.id, payload\)/);
  assert.match(broker, /plane\.completeTask\(payload\.taskId, identity\.nodeId, detail\)/);
});
