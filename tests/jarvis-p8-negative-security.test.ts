import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  createOwnerSessionToken,
  OWNER_SESSION_FUTURE_TOLERANCE_SECONDS,
  OWNER_SESSION_MAX_AGE_SECONDS,
  verifyOwnerPasscode,
  verifyOwnerSessionToken,
} from "../src/app/owner-auth.ts";
import { evaluateJarvisPolicy } from "../src/jarvis/policy-engine.ts";
import {
  JarvisNonceRegistry,
  canonicalWorkerRequest,
  verifyWorkerRequest,
  type JarvisSignedWorkerRequest,
  type JarvisWorkerIdentity,
} from "../src/jarvis/worker-auth.ts";
import type { JarvisNode, JarvisTask } from "../src/jarvis/types.ts";

const NOW = new Date("2026-09-17T00:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function signedRequest(overrides: Partial<JarvisSignedWorkerRequest> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const identity: JarvisWorkerIdentity = {
    nodeId: "android-001",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    enrolledAt: "2026-09-16T23:00:00.000Z",
    algorithm: "ed25519",
  };
  const unsigned = {
    nodeId: "android-001",
    timestamp: NOW.toISOString(),
    nonce: "nonce-001",
    method: "POST",
    path: "/worker/result",
    bodySha256: createHash("sha256").update("{\"ok\":true}").digest("hex"),
    ...overrides,
  };
  const signatureBase64 = sign(null, Buffer.from(canonicalWorkerRequest(unsigned), "utf8"), privateKey).toString("base64");
  return { identity, privateKey, request: { ...unsigned, signatureBase64 } satisfies JarvisSignedWorkerRequest };
}

function node(overrides: Partial<JarvisNode> = {}): JarvisNode {
  return {
    id: "android-001",
    label: "Android 001",
    kind: "android",
    status: "ready",
    capabilities: ["remote-control"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: true,
      requireHumanForLockedDevice: true,
    },
    telemetry: { checkedAt: NOW.toISOString() },
    enrollment: "full",
    lastSeenAt: NOW.toISOString(),
    ...overrides,
  };
}

function task(overrides: Partial<JarvisTask> = {}): JarvisTask {
  return {
    id: "task-001",
    idempotencyKey: "task-001",
    type: "device-status",
    payload: {},
    status: "queued",
    requiredCapabilities: [],
    priority: "normal",
    requiresOnline: false,
    attempts: 0,
    maxAttempts: 3,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

test("owner authentication fails closed for missing, wrong, tampered, expired, future, and malformed credentials", () => {
  const secret = "owner-secret-value";
  const validToken = createOwnerSessionToken(secret, {
    issuedAtSeconds: NOW_SECONDS,
    nonce: "abcdefghijklmnopqrstuvwx",
  });
  assert.equal(verifyOwnerPasscode(secret, secret), true);
  assert.equal(verifyOwnerSessionToken(secret, validToken, { nowSeconds: NOW_SECONDS }), true);

  assert.equal(verifyOwnerPasscode("", secret), false);
  assert.equal(verifyOwnerPasscode(secret, "wrong-owner-secret"), false);
  assert.equal(verifyOwnerSessionToken("", validToken, { nowSeconds: NOW_SECONDS }), false);
  assert.equal(verifyOwnerSessionToken(secret, undefined, { nowSeconds: NOW_SECONDS }), false);
  assert.equal(verifyOwnerSessionToken(secret, "not.a.valid.session", { nowSeconds: NOW_SECONDS }), false);

  const [version, issuedAt, nonce] = validToken.split(".");
  const tamperedToken = `${version}.${issuedAt}.${nonce}.${"A".repeat(43)}`;
  assert.equal(verifyOwnerSessionToken(secret, tamperedToken, { nowSeconds: NOW_SECONDS }), false);

  const expiredToken = createOwnerSessionToken(secret, {
    issuedAtSeconds: NOW_SECONDS - OWNER_SESSION_MAX_AGE_SECONDS - 1,
    nonce: "expiredsessionnonce000001",
  });
  assert.equal(verifyOwnerSessionToken(secret, expiredToken, { nowSeconds: NOW_SECONDS }), false);

  const futureToken = createOwnerSessionToken(secret, {
    issuedAtSeconds: NOW_SECONDS + OWNER_SESSION_FUTURE_TOLERANCE_SECONDS + 1,
    nonce: "futuresessionnonce0000002",
  });
  assert.equal(verifyOwnerSessionToken(secret, futureToken, { nowSeconds: NOW_SECONDS }), false);
});

test("signed worker request fails closed for tampering, stale time, identity mismatch, and revocation", () => {
  const valid = signedRequest();
  assert.deepEqual(verifyWorkerRequest({ identity: valid.identity, request: valid.request, now: NOW }), { ok: true });

  const tampered = { ...valid.request, path: "/worker/admin" };
  assert.deepEqual(verifyWorkerRequest({ identity: valid.identity, request: tampered, now: NOW }), {
    ok: false,
    reason: "invalid worker signature",
  });

  const stale = signedRequest({ timestamp: "2026-09-16T23:40:00.000Z", nonce: "nonce-stale" });
  assert.deepEqual(verifyWorkerRequest({ identity: stale.identity, request: stale.request, now: NOW, maxClockSkewMs: 5 * 60_000 }), {
    ok: false,
    reason: "worker timestamp outside allowed clock skew",
  });

  const mismatch = signedRequest({ nodeId: "android-002", nonce: "nonce-mismatch" });
  assert.deepEqual(verifyWorkerRequest({ identity: mismatch.identity, request: mismatch.request, now: NOW }), {
    ok: false,
    reason: "node identity mismatch",
  });

  assert.deepEqual(verifyWorkerRequest({
    identity: { ...valid.identity, revokedAt: "2026-09-16T23:59:00.000Z" },
    request: valid.request,
    now: NOW,
  }), { ok: false, reason: "worker identity revoked" });
});

test("signed worker request rejects malformed and future timestamps before trust", () => {
  const malformed = signedRequest({ timestamp: "not-a-date", nonce: "nonce-malformed-time" });
  assert.deepEqual(verifyWorkerRequest({ identity: malformed.identity, request: malformed.request, now: NOW }), {
    ok: false,
    reason: "invalid worker timestamp",
  });

  const future = signedRequest({ timestamp: "2026-09-17T00:05:00.001Z", nonce: "nonce-future-time" });
  assert.deepEqual(verifyWorkerRequest({ identity: future.identity, request: future.request, now: NOW, maxClockSkewMs: 5 * 60_000 }), {
    ok: false,
    reason: "worker timestamp outside allowed clock skew",
  });
});

test("signed worker request binds nonce and body digest to the signature and rejects invalid public keys", () => {
  const valid = signedRequest({ nonce: "nonce-bound-fields" });

  assert.deepEqual(verifyWorkerRequest({
    identity: valid.identity,
    request: { ...valid.request, nonce: "nonce-after-signing" },
    now: NOW,
  }), { ok: false, reason: "invalid worker signature" });

  assert.deepEqual(verifyWorkerRequest({
    identity: valid.identity,
    request: { ...valid.request, bodySha256: "0".repeat(64) },
    now: NOW,
  }), { ok: false, reason: "invalid worker signature" });

  assert.deepEqual(verifyWorkerRequest({
    identity: { ...valid.identity, publicKeyPem: "not-a-public-key" },
    request: valid.request,
    now: NOW,
  }), { ok: false, reason: "invalid worker public key or signature" });
});

test("recorded worker nonce is rejected as replay until its bounded registry TTL expires", () => {
  const signed = signedRequest({ nonce: "nonce-replay" });
  const registry = new JarvisNonceRegistry();
  const first = verifyWorkerRequest({
    identity: signed.identity,
    request: signed.request,
    now: NOW,
    seenNonce: (nodeId, nonce) => registry.has(nodeId, nonce, NOW.getTime()),
  });
  assert.deepEqual(first, { ok: true });
  registry.record(signed.request.nodeId, signed.request.nonce, 10 * 60_000, NOW.getTime());

  assert.deepEqual(verifyWorkerRequest({
    identity: signed.identity,
    request: signed.request,
    now: NOW,
    seenNonce: (nodeId, nonce) => registry.has(nodeId, nonce, NOW.getTime()),
  }), { ok: false, reason: "worker nonce already used" });

  assert.equal(registry.has(signed.request.nodeId, signed.request.nonce, NOW.getTime() + 10 * 60_000), false);
});

test("protected policy classes remain fail-closed and require Human Gate", () => {
  const protectedInputs = [
    { incrementalCostYen: 1 },
    { incrementalCostYen: 0, destructive: true },
    { incrementalCostYen: 0, externalPublication: true },
    { incrementalCostYen: 0, requiresSecret: true },
    { incrementalCostYen: 0, requiresPermissionChange: true },
  ];
  for (const input of protectedInputs) {
    const decision = evaluateJarvisPolicy({ task: task(), node: node(), ...input });
    assert.equal(decision.allowed, false);
    assert.equal(decision.requiresHumanGate, true);
  }
});

test("pointer and gesture input cannot authorize protected actions even when node policy allows them", () => {
  const permissiveNode = node({
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: true,
      allowExternalPublication: true,
      allowRemoteControl: true,
      requireHumanForLockedDevice: true,
    },
  });
  for (const interactionOrigin of ["pointer", "gesture"] as const) {
    const decision = evaluateJarvisPolicy({
      task: task(),
      node: permissiveNode,
      incrementalCostYen: 0,
      destructive: true,
      interactionOrigin,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.requiresHumanGate, true);
    assert.ok(decision.reasons.some((reason) => reason.includes("cannot authorize a Human-Gated action")));
  }
});

test("locked-device takeover and disabled remote control fail closed", () => {
  const locked = evaluateJarvisPolicy({
    task: task(),
    node: node({ status: "locked" }),
    incrementalCostYen: 0,
  });
  assert.equal(locked.allowed, false);
  assert.ok(locked.reasons.includes("locked personal device requires Human Takeover"));

  const remoteDisabled = evaluateJarvisPolicy({
    task: task({ type: "remote-control", requiredCapabilities: ["remote-control"] }),
    node: node({ policy: { ...node().policy, allowRemoteControl: false } }),
    incrementalCostYen: 0,
  });
  assert.equal(remoteDisabled.allowed, false);
  assert.ok(remoteDisabled.reasons.includes("remote control is disabled for this node"));
});
