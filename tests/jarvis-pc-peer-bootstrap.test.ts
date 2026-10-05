import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
const modulePath = "../src/jarvis/pc-peer-bootstrap.ts";
const api = await import(modulePath).catch(() => null);
function identity(nodeId: "macbook" | "zbook") {
  const keys = generateKeyPairSync("ed25519");
  return { version: 1 as const, nodeId, platform: nodeId === "macbook" ? "macos" as const : "windows" as const,
    algorithm: "ed25519" as const, hostBinding: "a".repeat(64), createdAt: new Date().toISOString(),
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
const mac = identity("macbook"), win = identity("zbook"), revision = "a".repeat(40);
const fingerprint = (value: ReturnType<typeof identity>) => createHash("sha256").update(
  generatePublicDer(value.publicKeyPem)).digest("hex");
import { createPublicKey } from "node:crypto";
function generatePublicDer(pem: string) { return createPublicKey(pem).export({ type: "spki", format: "der" }); }
test("public counterpart descriptor requires an independently pinned approved native issuer, not membership or self-signature", () => {
  assert.ok(api, "PC_MUTUAL_BOOTSTRAP_UNAVAILABLE");
  const descriptor = api.publicPcDescriptor(mac, revision);
  assert.equal(api.validatePublicPcDescriptor(descriptor, { nodeId: "macbook", revision, fingerprint: fingerprint(mac) }).nodeId, "macbook");
  assert.equal(JSON.stringify(descriptor).includes("PRIVATE KEY"), false);
  for (const pin of ["", "b".repeat(64)]) assert.throws(() => api.validatePublicPcDescriptor(descriptor, { nodeId: "macbook", revision, fingerprint: pin }));
  assert.throws(() => api.validatePublicPcDescriptor({ ...descriptor, sourceRevision: "b".repeat(40) }, { nodeId: "macbook", revision, fingerprint: fingerprint(mac) }));
  assert.throws(() => api.validatePublicPcDescriptor({ ...descriptor, privateKeyPem: "PRIVATE_SENTINEL" }, { nodeId: "macbook", revision, fingerprint: fingerprint(mac) }));
});
test("challenge and proof are tied to the exact two approved public identities and source", async () => {
  assert.ok(api, "PC_MUTUAL_BOOTSTRAP_UNAVAILABLE");
  const descriptor = api.publicPcDescriptor(mac, revision);
  const seen: Array<{url: string; headers: Headers}> = [];
  const request: typeof fetch = async (url, options) => {
    seen.push({ url: String(url), headers: new Headers(options?.headers) });
    if (String(url).endsWith("/health")) return Response.json({ ok: true, runtimeRevision: revision });
    return Response.json({ challengeId: "123e4567-e89b-12d3-a456-426614174000",
      proofText: "GORIQ-PC-ENROLL-v1\n123e4567-e89b-12d3-a456-426614174000\n" + "c".repeat(64),
      expiresAt: new Date(Date.now() + 240000).toISOString() }, { status: 201 });
  };
  const envelope = await api.requestPeerPcEnrollment({ base: "http://127.0.0.1:8787", revision, ownerToken: "LOCAL_OWNER_SENTINEL",
    identity: win, peer: descriptor, expectedPeerFingerprint: fingerprint(mac), request });
  const proof = api.signPeerPcEnrollment({ envelope, identity: mac, revision, expectedCoordinatorFingerprint: fingerprint(win) });
  assert.ok(proof.signatureBase64); assert.equal(JSON.stringify(envelope).includes("LOCAL_OWNER_SENTINEL"), false);
  assert.ok(seen.every(x => x.url.startsWith("http://127.0.0.1:8787/")));
  assert.throws(() => api.signPeerPcEnrollment({ envelope, identity: win, revision, expectedCoordinatorFingerprint: fingerprint(win) }));
  assert.throws(() => api.signPeerPcEnrollment({ envelope: { ...envelope, targetNodeId: "zbook" }, identity: mac, revision, expectedCoordinatorFingerprint: fingerprint(win) }));
  assert.throws(() => api.signPeerPcEnrollment({ envelope, identity: mac, revision: "b".repeat(40), expectedCoordinatorFingerprint: fingerprint(win) }));
});
test("Owner credentials never leave loopback and malformed peer proof cannot create a challenge", async () => {
  assert.ok(api, "PC_MUTUAL_BOOTSTRAP_UNAVAILABLE");
  let requests = 0;
  const request: typeof fetch = async () => { requests++; assert.fail("unsafe enrollment request"); };
  await assert.rejects(() => api.requestPeerPcEnrollment({ base: "https://peer.tailfixture.ts.net", revision, ownerToken: "OWNER_SENTINEL",
    identity: win, peer: {}, expectedPeerFingerprint: fingerprint(mac), request }));
  await assert.rejects(() => api.requestPeerPcEnrollment({ base: "http://127.0.0.1:8787", revision, ownerToken: "OWNER_SENTINEL",
    identity: win, peer: {}, expectedPeerFingerprint: fingerprint(mac), request }));
  assert.equal(requests, 0);
});
