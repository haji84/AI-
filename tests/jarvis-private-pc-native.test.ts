import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { privatePcDiscovery, privatePcIngressReady, registeredPrivatePcSigner, registeredPrivatePcPeer } from "../src/jarvis/private-pc-native.ts";
import { withPcExecutionLock } from "../src/jarvis/pc-execution-lock.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";
import type { PcLocalIdentity } from "../src/jarvis/pc-local-identity.ts";
const origin = "https://zbook.tailfixture.ts.net", host = new URL(origin).hostname;
const status = { BackendState: "Running", Self: { DNSName: host + "." }, Peer: {
  valid: { Online: true, DNSName: "macbook.tailfixture.ts.net." }, wrong: { Online: true, DNSName: "other.another.ts.net." },
  down: { Online: false, DNSName: "down.tailfixture.ts.net." } } };
const serve = { TCP: { "443": { HTTPS: true } }, Web: { [host + ":443"]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } };
const env = { JARVIS_PRIVATE_WORKER_INGRESS_ENABLED: "1", JARVIS_BROKER_HOST: "127.0.0.1",
  JARVIS_REMOTE_GATEWAY_HOST: "127.0.0.1", JARVIS_DASHBOARD_PORT: "3000" };
function req(url = origin) { return new Request(url + "/api/jarvis/worker/pc/next", { headers: {
  host, "x-forwarded-host": host, "x-forwarded-proto": "https", "tailscale-user-login": "owner-fixture" } }); }
test("private native gate rechecks live Serve state and per-request Funnel/identity headers", async () => {
  let calls = 0;
  const run = async (args: string[]) => { calls++; return JSON.stringify(args[0] === "status" ? status : serve); };
  assert.equal(await privatePcIngressReady(req(), { platform: "win32", env, run }), true);
  assert.equal(await privatePcIngressReady(req("http://127.0.0.1:3000"), { platform: "win32", env, run }), true);
  assert.equal(calls, 4);
  for (const changed of [new Request(req(), { headers: { host } }),
    new Request(req(), { headers: { ...Object.fromEntries(req().headers), "tailscale-funnel-request": "?1" } }),
    new Request(req(), { headers: { ...Object.fromEntries(req().headers), "x-forwarded-host": "public.invalid" } })]) {
    assert.equal(await privatePcIngressReady(changed, { platform: "win32", env, run }), false);
  }
  assert.equal(await privatePcIngressReady(req(), { platform: "win32", env: { ...env, VERCEL: "1" }, run }), false);
  assert.equal(await privatePcIngressReady(req(), { platform: "linux", env, run }), false);
  assert.equal(await privatePcIngressReady(req(), { platform: "win32", env, run: async () => { throw Error("PRIVATE_NETWORK_SENTINEL"); } }), false);
  assert.equal(await privatePcIngressReady(req(), { platform: "win32", env, run: async args => JSON.stringify(args[0] === "status" ? status : { ...serve, AllowFunnel: { [host + ":443"]: true } }) }), false);
});
test("discovery yields only current same-tailnet HTTPS candidates, without trusting them as GORIQ Nodes", () => {
  assert.deepEqual(privatePcDiscovery(status), { domain: "tailfixture.ts.net", origins: ["https://macbook.tailfixture.ts.net"] });
  assert.throws(() => privatePcDiscovery({ ...status, BackendState: "NoState" }));
  assert.throws(() => privatePcDiscovery({ ...status, Self: { DNSName: "public.invalid" } }));
});
const keys = generateKeyPairSync("ed25519");
const identity: PcLocalIdentity = { version: 1, nodeId: "zbook", platform: "windows", algorithm: "ed25519", hostBinding: "b".repeat(64),
  createdAt: new Date().toISOString(), publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const node = { id: "zbook", kind: "windows", pcAuthority: { version: 1, approvalIssue: 1662, goalIssue: 1219,
  roles: ["Coordinator"], capabilityCeiling: ["filesystem"] } } as JarvisNode;
const registered = { nodeId: "zbook", algorithm: "ed25519" as const, publicKeyPem: identity.publicKeyPem, enrolledAt: identity.createdAt };
test("native signer requires the existing matched unrevoked host key and approved Goal authority", () => {
  assert.equal(registeredPrivatePcSigner(identity, node, registered, "a".repeat(40)).identity.nodeId, "zbook");
  for (const changed of [undefined, { ...registered, revokedAt: identity.createdAt }, { ...registered, nodeId: "macbook" }]) {
    assert.throws(() => registeredPrivatePcSigner(identity, node, changed, "a".repeat(40)), /SIGNER_UNAVAILABLE/);
  }
  assert.throws(() => registeredPrivatePcSigner(identity, { ...node, pcAuthority: { ...node.pcAuthority!, goalIssue: 999 } }, registered, "a".repeat(40)));
  assert.throws(() => registeredPrivatePcSigner({ ...identity, privateKeyPem: "KEY_SENTINEL" }, node, registered, "a".repeat(40)), /SIGNER_UNAVAILABLE/);
});
test("local and remote execution share a host slot and release it on failed transport", async () => {
  let release: () => void = () => {};
  const wait = new Promise<void>(resolve => { release = resolve; });
  let started: () => void = () => {};
  const entered = new Promise<void>(resolve => { started = resolve; });
  const running = withPcExecutionLock(identity, async () => { started(); await wait; });
  await entered;
  await assert.rejects(() => withPcExecutionLock(identity, async () => assert.fail("duplicate execution")), /EXECUTION_BUSY/);
  release(); await running;
  await assert.rejects(() => withPcExecutionLock(identity, async () => { throw Error("NETWORK_OFFLINE"); }), /NETWORK_OFFLINE/);
  assert.equal(await withPcExecutionLock(identity, async () => 42), 42);
});

test("network membership cannot replace existing counterpart enrollment and Goal authority", () => {
  assert.equal(registeredPrivatePcPeer("macbook", node, registered).nodeId, "zbook");
  for (const changed of [undefined, { ...registered, revokedAt: identity.createdAt }, { ...registered, nodeId: "macbook" }]) {
    assert.throws(() => registeredPrivatePcPeer("macbook", node, changed), /MUTUAL_ENROLLMENT_REQUIRED/);
  }
  assert.throws(() => registeredPrivatePcPeer("zbook", node, registered), /MUTUAL_ENROLLMENT_REQUIRED/);
  assert.throws(() => registeredPrivatePcPeer("macbook", { ...node, pcAuthority: { ...node.pcAuthority!, roles: ["Executor"] } }, registered), /MUTUAL_ENROLLMENT_REQUIRED/);
});
