import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
const modulePath = "../src/jarvis/private-pc-transport.ts";
const api = await import(modulePath).catch(() => null);
const keys = generateKeyPairSync("ed25519");
const peer = { nodeId: "zbook", algorithm: "ed25519" as const,
  publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), enrolledAt: new Date().toISOString() };
const revision = "a".repeat(40), origin = "https://zbook.tailfixture.ts.net", path = "/api/jarvis/worker/pc/next";
function request(pathname = path, nodeId = "macbook") {
  return new Request(origin + pathname, { method: "POST", body: "{}", headers: {
    "content-type": "application/json", "x-jarvis-node-id": nodeId,
    "x-jarvis-nonce": randomUUID(), "x-jarvis-timestamp": new Date().toISOString(),
    "x-jarvis-body-sha256": "b".repeat(64), "x-jarvis-signature": "worker-fixture",
    authorization: "Bearer OWNER_SECRET_SENTINEL", cookie: "OWNER_COOKIE_SENTINEL" } });
}
test("private PC route works independently of physical Wi-Fi address and authenticates the enrolled peer response", async () => {
  assert.ok(api, "PRIVATE_PC_TRANSPORT_UNAVAILABLE");
  let calls = 0;
  const relay = api.privatePcRelay({ ingress: async () => true,
    signer: async () => ({ identity: { ...peer, privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, revision }),
    upstream: async (url: string, options: RequestInit) => {
      calls++; assert.equal(url, "http://127.0.0.1:8787" + path);
      const headers = new Headers(options.headers);
      assert.equal(headers.has("authorization"), false); assert.equal(headers.has("cookie"), false);
      assert.equal(headers.get("x-jarvis-node-id"), "macbook"); assert.equal(options.redirect, "error");
      return Response.json({ task: null });
    } });
  for (const physicalAddress of ["192.168.0.169", "10.24.8.31"]) {
    assert.notEqual(physicalAddress, new URL(origin).hostname);
    assert.equal(api.privatePcOrigin(origin, "tailfixture.ts.net"), origin);
    const req = request(), response = await relay(req);
    assert.equal(response.status, 200);
    const verified = await api.verifyPrivatePcResponse(response, { request: req, peer, revision });
    assert.deepEqual(await verified.json(), { task: null });
  }
  assert.equal(calls, 2);
});
test("unknown/public ingress and routes or identities outside scoped PC worker contract refuse before key or backend access", async () => {
  assert.ok(api, "PRIVATE_PC_TRANSPORT_UNAVAILABLE");
  let touched = 0;
  for (const available of [false, null, "private"]) {
    const relay = api.privatePcRelay({ ingress: async () => available,
      signer: async () => { touched++; throw Error("KEY_SECRET"); },
      upstream: async () => { touched++; throw Error("OWNER_SECRET"); } });
    const response = await relay(request()); assert.equal(response.status, 404);
  }
  const relay = api.privatePcRelay({ ingress: async () => true,
    signer: async () => { touched++; throw Error("KEY_SECRET"); }, upstream: async () => { touched++; throw Error("OWNER_SECRET"); } });
  for (const bad of [request("/api/jarvis/admin/pc-tasks"), request(path, "android-fixture"),
    new Request(origin + path), request(path + "?redirect=https://public.invalid")]) assert.equal((await relay(bad)).status, 404);
  assert.equal(touched, 0);
});
test("peer proof rejects changed body, wrong peer, request nonce, revision or response status", async () => {
  assert.ok(api, "PRIVATE_PC_TRANSPORT_UNAVAILABLE");
  const relay = api.privatePcRelay({ ingress: async () => true,
    signer: async () => ({ identity: { ...peer, privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, revision }),
    upstream: async () => Response.json({ task: null }) });
  const req = request();
  const response = await relay(req), body = await response.text();
  const clone = (text = body, status = response.status) => new Response(text, { status, headers: response.headers });
  await assert.rejects(() => api.verifyPrivatePcResponse(clone('{"task":"tampered"}'), { request: req, peer, revision }));
  await assert.rejects(() => api.verifyPrivatePcResponse(clone(), { request: request(), peer, revision }));
  await assert.rejects(() => api.verifyPrivatePcResponse(clone(), { request: req, peer: { ...peer, revokedAt: new Date().toISOString() }, revision }));
  await assert.rejects(() => api.verifyPrivatePcResponse(clone(), { request: req, peer: { ...peer, nodeId: "other" }, revision }));
  await assert.rejects(() => api.verifyPrivatePcResponse(clone(), { request: req, peer, revision: "c".repeat(40) }));
  await assert.rejects(() => api.verifyPrivatePcResponse(clone(body, 201), { request: req, peer, revision }));
});
test("private origin never falls back to HTTP, raw IP, another tailnet, credentials, ports or redirects", () => {
  assert.ok(api, "PRIVATE_PC_TRANSPORT_UNAVAILABLE");
  for (const bad of ["http://zbook.tailfixture.ts.net", "https://192.168.1.2:8792", "https://zbook.other.ts.net",
    "https://user:pass@zbook.tailfixture.ts.net", origin + ":8443", origin + "/other", origin + "?next=public"]) {
    assert.throws(() => api.privatePcOrigin(bad, "tailfixture.ts.net"));
  }
});

test("unavailable signing key and oversized or aborted bodies never touch the lease-changing backend", async () => {
  assert.ok(api, "PRIVATE_PC_TRANSPORT_UNAVAILABLE");
  let touched = 0;
  const signer = async () => ({ identity: { ...peer, privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, revision });
  const upstream = async () => { touched++; return Response.json({ task: null }); };
  assert.equal((await api.privatePcRelay({ ingress: async () => true, signer: async () => { throw Error("KEY_SENTINEL"); }, upstream })(request())).status, 502);
  const relay = api.privatePcRelay({ ingress: async () => true, signer, upstream });
  const oversized = new Request(request(), { body: "x".repeat(1_000_001) });
  assert.equal((await relay(oversized)).status, 502);
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  const slow = new Request(request(), { body: stream, signal: controller.signal, duplex: "half" } as RequestInit);
  const pending = relay(slow); controller.abort();
  assert.equal((await pending).status, 502);
  assert.equal(touched, 0);
});
