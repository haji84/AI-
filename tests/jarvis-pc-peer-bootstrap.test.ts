import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { PcEnrollmentService } from "../src/jarvis/pc-enrollment.ts";
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
function offer() {
  const now = new Date();
  return new PcEnrollmentService({ version: 1, issue: 1662, goalIssue: 1219,
    approvedAt: new Date(now.getTime() - 1000).toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(),
    targets: [{ nodeId: "macbook", platform: "macos" }, { nodeId: "zbook", platform: "windows" }],
    roles: ["Executor","Storage","Verifier","Coordinator"] }).offer({
      nodeId: mac.nodeId, platform: mac.platform, algorithm: mac.algorithm, publicKeyPem: mac.publicKeyPem }, now);
}
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
    return Response.json(offer(), { status: 201 });
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

test("expired descriptors, changed challenge signature and mismatched proof refuse before local Owner mutation", async () => {
  assert.ok(api, "PC_MUTUAL_BOOTSTRAP_UNAVAILABLE");
  const descriptor = api.publicPcDescriptor(mac, revision, new Date(Date.now() - 1000000));
  assert.throws(() => api.validatePublicPcDescriptor(descriptor, { nodeId: "macbook", revision, fingerprint: fingerprint(mac) }));
  const peer = api.publicPcDescriptor(mac, revision);
  const local: typeof fetch = async url => String(url).endsWith("/health") ? Response.json({ ok: true, runtimeRevision: revision }) :
    Response.json(offer(), { status: 201 });
  const envelope = await api.requestPeerPcEnrollment({ base: "http://127.0.0.1:8787", revision, ownerToken: "LOCAL_SENTINEL",
    identity: win, peer, expectedPeerFingerprint: fingerprint(mac), request: local });
  const proof = api.signPeerPcEnrollment({ envelope, identity: mac, revision, expectedCoordinatorFingerprint: fingerprint(win) });
  assert.throws(() => api.signPeerPcEnrollment({ envelope: { ...envelope, signatureBase64: "A".repeat(86) + "==" },
    identity: mac, revision, expectedCoordinatorFingerprint: fingerprint(win) }));
  assert.throws(() => api.signPeerPcEnrollment({ envelope, identity: mac, revision, expectedCoordinatorFingerprint: fingerprint(win),
    now: new Date(Date.now() + 300000) }));
  let touched = 0;
  const request: typeof fetch = async () => { touched++; assert.fail("invalid proof reached Owner"); };
  for (const changed of [{ ...proof, nodeId: "zbook" }, { ...proof, challengeSha256: "b".repeat(64) },
    { ...proof, signatureBase64: "A".repeat(86) + "==" }, { ...proof, contextSignatureBase64: "A".repeat(86) + "==" }]) {
    await assert.rejects(() => api.completePeerPcEnrollment({ base: "http://127.0.0.1:8787", revision, ownerToken: "OWNER_SENTINEL",
      identity: win, peer, expectedPeerFingerprint: fingerprint(mac), envelope, proof: changed, request }), /PROOF_REJECTED/);
  }
  assert.equal(touched,0);
});

test("even a pinned coordinator cannot obtain a signature for hidden or changed enrollment authority", async () => {
  assert.ok(api);
  const peer = api.publicPcDescriptor(mac, revision);
  const request: typeof fetch = async url => String(url).endsWith("/health") ?
    Response.json({ ok: true, runtimeRevision: revision }) : Response.json(offer(), { status: 201 });
  const envelope = await api.requestPeerPcEnrollment({ base: "http://127.0.0.1:8787", revision, ownerToken: "LOCAL_ONLY",
    identity: win, peer, expectedPeerFingerprint: fingerprint(mac), request });
  for (const mutate of [
    (e: typeof envelope) => { e.candidateContext = null; },
    (e: typeof envelope) => { e.candidateContext!.node.pcAuthority!.roles = ["Executor"]; },
    (e: typeof envelope) => { e.candidateContext!.node.policy.allowRemoteControl = true; },
    (e: typeof envelope) => { e.candidateContext!.identity.publicKeyPem = win.publicKeyPem; },
    (e: typeof envelope) => { e.candidateContext!.node.id = "zbook"; },
  ]) {
    const changed = structuredClone(envelope); mutate(changed);
    if (changed.candidateContext) changed.proofText = changed.proofText.split("\n").slice(0,2).join("\n") +
      "\n" + createHash("sha256").update(JSON.stringify(changed.candidateContext)).digest("hex");
    const { signatureBase64: _prior, ...publicFields } = changed; void _prior;
    changed.signatureBase64 = sign(null, Buffer.from("GORIQ-PC-PEER-CHALLENGE-v1\n" + JSON.stringify(publicFields)),
      win.privateKeyPem).toString("base64");
    assert.throws(() => api.signPeerPcEnrollment({ envelope: changed, identity: mac, revision,
      expectedCoordinatorFingerprint: fingerprint(win) }), /CHALLENGE_REJECTED/);
  }
});
