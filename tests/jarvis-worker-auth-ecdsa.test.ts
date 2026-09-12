import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { canonicalWorkerRequest, verifyWorkerRequest } from "../src/jarvis/index.ts";

test("Android-compatible P-256 ECDSA worker signatures verify", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const body = Buffer.from(JSON.stringify({ status: "ready" }), "utf8");
  const unsigned = {
    nodeId: "android-ecdsa-001",
    timestamp: "2026-09-12T08:00:00.000Z",
    nonce: "ecdsa-nonce-001",
    method: "POST",
    path: "/api/jarvis/worker/heartbeat",
    bodySha256: createHash("sha256").update(body).digest("hex"),
  };
  const signatureBase64 = sign("sha256", Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), privateKey).toString("base64");
  const result = verifyWorkerRequest({
    identity: {
      nodeId: unsigned.nodeId,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      enrolledAt: "2026-09-12T07:00:00.000Z",
      algorithm: "ecdsa-p256-sha256",
    },
    request: { ...unsigned, signatureBase64 },
    now: new Date("2026-09-12T08:01:00.000Z"),
  });
  assert.deepEqual(result, { ok: true });
});
