import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { registerLocalPc } from "../src/jarvis/pc-bootstrap.ts";
import type { PcLocalIdentity } from "../src/jarvis/pc-local-identity.ts";
const keys = generateKeyPairSync("ed25519");
const identity: PcLocalIdentity = { version: 1, nodeId: "macbook", platform: "macos", hostBinding: "fixture", algorithm: "ed25519", createdAt: new Date().toISOString(),
  publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
test("bootstrap never sends Owner credentials outside loopback or before exact runtime validation", async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return Response.json({ ok: true, runtimeRevision: "old" }); };
  await assert.rejects(() => registerLocalPc({ base: "https://peer", revision: "a".repeat(40), ownerToken: "private-fixture", identity, request }), /LOOPBACK/);
  assert.equal(calls, 0);
  await assert.rejects(() => registerLocalPc({ base: "http://127.0.0.1:8787", revision: "a".repeat(40), ownerToken: "private-fixture", identity, request }), /REVISION/);
  assert.equal(calls, 1);
});
test("proof is signed by the host and successful enrollment must match the requested identity", async () => {
  let calls = 0;
  const request: typeof fetch = async (_url, options) => {
    calls++;
    if(calls === 1) { assert.equal(options?.headers, undefined); return Response.json({ ok: true, runtimeRevision: "a".repeat(40) }); }
    if(calls === 2) return Response.json({ challengeId: "challenge", proofText: "GORIQ-PC-ENROLL-v1\nchallenge\n" + "b".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() }, { status: 201 });
    if(calls === 3) {
      const proof = JSON.parse(String(options?.body));
      assert.equal(proof.signatureBase64, sign(null, Buffer.from("GORIQ-PC-ENROLL-v1\nchallenge\n" + "b".repeat(64)), keys.privateKey).toString("base64"));
      return Response.json({ node: { id: "other", kind: "macos" } }, { status: 201 });
    }
    assert.fail("no heartbeat on enrollment mismatch");
  };
  await assert.rejects(() => registerLocalPc({ base: "http://127.0.0.1:8787", revision: "a".repeat(40), ownerToken: "private-fixture", identity, request }), /ENROLLMENT/);
  assert.equal(calls, 3);
});
