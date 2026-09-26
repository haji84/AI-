import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import {
  handleOwnerRecoveryCancel,
  handleOwnerRecoveryIssue,
  handleOwnerRecoveryRedeem,
} from "../src/app/owner-recovery-http.ts";
import {
  OwnerRecoveryBrokerError,
  redeemOwnerRecovery,
} from "../src/app/owner-recovery-registry-client.ts";

const secret = "owner-secret-for-runtime-route-test";
const issuerDeviceId = "issuer_1234567890abcdef";
const targetDeviceId = "target_1234567890abcdef";
const publicKeyJwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
const validBody = { code: "OR-AAAA-AAAA-AAAA-AAAA", deviceId: targetDeviceId, label: "New iPhone", publicKeyJwk };

function request(path: string, body: unknown) {
  return new Request(`https://owner.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

const issueDependencies = (overrides = {}) => ({
  enabled: true,
  ownerSecret: secret,
  sessionToken: async () => "trusted-session",
  verifyFreshSession: async () => issuerDeviceId,
  issue: async () => ({ code: validBody.code, expiresAt: 1300 }),
  ...overrides,
});

const cancelDependencies = (overrides = {}) => ({
  enabled: true,
  ownerSecret: secret,
  sessionToken: async () => "trusted-session",
  verifyFreshSession: async () => issuerDeviceId,
  cancel: async () => ({ cancelled: true }),
  ...overrides,
});

const redeemDependencies = (overrides = {}) => ({
  enabled: true,
  ownerSecret: secret,
  sourceAddress: "192.0.2.10",
  redeem: async () => ({ device: { deviceId: targetDeviceId, label: "New iPhone", revoked: false } }),
  ...overrides,
});

test("public recovery handlers enforce disabled, bounded, non-cacheable responses", async () => {
  const disabled = [
    await handleOwnerRecoveryIssue(request("/issue", {}), issueDependencies({ enabled: false })),
    await handleOwnerRecoveryRedeem(request("/redeem", {}), redeemDependencies({ enabled: false })),
    await handleOwnerRecoveryCancel(request("/cancel", {}), cancelDependencies({ enabled: false })),
  ];
  for (const response of disabled) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal((await handleOwnerRecoveryIssue(request("/issue", "x".repeat(4_097)), issueDependencies())).status, 400);
  assert.equal((await handleOwnerRecoveryRedeem(request("/redeem", "x".repeat(4_097)), redeemDependencies())).status, 400);
  assert.equal((await handleOwnerRecoveryCancel(request("/cancel", "x".repeat(4_097)), cancelDependencies())).status, 400);
});

test("public recovery handlers stop reading request streams at the byte limit", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls > 128) return controller.close();
      controller.enqueue(new Uint8Array(1_024));
    },
    cancel() { cancelled = true; },
  });
  const streamed = new Request("https://owner.example/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const response = await handleOwnerRecoveryRedeem(streamed, redeemDependencies());
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.ok(pulls < 20, `expected early stream cancellation, observed ${pulls} pulls`);
});

test("issue and cancel behavior denies stale or revoked sessions before Broker mutation", async () => {
  let calls = 0;
  const issueResponse = await handleOwnerRecoveryIssue(request("/issue", {}), issueDependencies({
    verifyFreshSession: async () => null,
    issue: async () => { calls += 1; return { code: validBody.code, expiresAt: 1300 }; },
  }));
  const cancelResponse = await handleOwnerRecoveryCancel(request("/cancel", {}), cancelDependencies({
    verifyFreshSession: async () => null,
    cancel: async () => { calls += 1; return { cancelled: true }; },
  }));
  assert.equal(issueResponse.status, 401);
  assert.equal(cancelResponse.status, 401);
  assert.equal(calls, 0);
});

test("redeem rejects malformed keys before Broker mutation", async () => {
  let calls = 0;
  const response = await handleOwnerRecoveryRedeem(request("/redeem", {
    ...validBody,
    publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
  }), redeemDependencies({
    redeem: async () => { calls += 1; return { device: { deviceId: targetDeviceId, label: "New iPhone", revoked: false } }; },
  }));
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("redeem maps domain rejection to 403 and dependency outage to 503", async () => {
  const rejected = await handleOwnerRecoveryRedeem(request("/redeem", validBody), redeemDependencies({
    redeem: async () => { throw new OwnerRecoveryBrokerError(409); },
  }));
  const unavailable = await handleOwnerRecoveryRedeem(request("/redeem", validBody), redeemDependencies({
    redeem: async () => { throw new OwnerRecoveryBrokerError(503); },
  }));
  assert.equal(rejected.status, 403);
  assert.equal(unavailable.status, 503);
});

test("Broker connection refusal is a retryable dependency error", async () => {
  const previous = { broker: process.env.JARVIS_BROKER_URL, token: process.env.JARVIS_OWNER_TOKEN };
  process.env.JARVIS_BROKER_URL = `http://127.0.0.1:${await unusedPort()}`;
  process.env.JARVIS_OWNER_TOKEN = "broker-token-for-runtime-route-test";
  try {
    await assert.rejects(
      redeemOwnerRecovery({
        code: validBody.code,
        deviceId: targetDeviceId,
        label: "New iPhone",
        publicKeyThumbprint: "T".repeat(43),
        sourceBucket: "S".repeat(43),
      }),
      (error: unknown) => error instanceof OwnerRecoveryBrokerError && error.status === 503,
    );
  } finally {
    if (previous.broker === undefined) delete process.env.JARVIS_BROKER_URL; else process.env.JARVIS_BROKER_URL = previous.broker;
    if (previous.token === undefined) delete process.env.JARVIS_OWNER_TOKEN; else process.env.JARVIS_OWNER_TOKEN = previous.token;
  }
});
