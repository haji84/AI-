import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { parseTrustedDeviceCredential } from "../src/app/trusted-device-auth.ts";
import {
  cancelOwnerRecoveryEnrollment,
  issueOwnerRecoveryEnrollment,
  ownerRecoverySourceBucket,
  redeemOwnerRecoveryEnrollment,
} from "../src/app/owner-recovery-service.ts";

const ownerSecret = "owner-secret-for-recovery-service-tests";
const issuerDeviceId = "issuer_1234567890abcdef";
const targetDeviceId = "target_1234567890abcdef";
const code = "OR-AAAA-AAAA-AAAA-AAAA";
const sourceBucket = "S".repeat(43);
const publicKeyJwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });

test("issue and cancel validate the bound issuer before calling the Broker boundary", async () => {
  const issued: string[] = [];
  const cancelled: string[] = [];
  assert.deepEqual(await issueOwnerRecoveryEnrollment(issuerDeviceId, async id => {
    issued.push(id);
    return { code, expiresAt: 1300 };
  }), { code, expiresAt: 1300 });
  assert.deepEqual(await cancelOwnerRecoveryEnrollment(issuerDeviceId, async id => {
    cancelled.push(id);
    return { cancelled: true };
  }), { cancelled: true });
  assert.deepEqual(issued, [issuerDeviceId]);
  assert.deepEqual(cancelled, [issuerDeviceId]);
  await assert.rejects(issueOwnerRecoveryEnrollment("bad/id", async () => ({ code, expiresAt: 1300 })), /invalid recovery issuer/);
  await assert.rejects(cancelOwnerRecoveryEnrollment("bad/id", async () => ({ cancelled: false })), /invalid recovery issuer/);
});

test("redeem validates input, constructs the existing credential, then mutates Broker state", async () => {
  let credentialCreated = false;
  let brokerInput: Record<string, unknown> | undefined;
  const result = await redeemOwnerRecoveryEnrollment({ code, deviceId: targetDeviceId, label: "  New iPhone  ", publicKeyJwk, sourceBucket }, {
    ownerSecret,
    createCredential: (secret, input) => {
      assert.equal(secret, ownerSecret);
      assert.equal(input.label, "New iPhone");
      credentialCreated = true;
      return "trusted-device-credential";
    },
    redeem: async input => {
      assert.equal(credentialCreated, true);
      brokerInput = input;
      return { device: { deviceId: targetDeviceId, label: "New iPhone", revoked: false } };
    },
  });
  assert.equal(result.credential, "trusted-device-credential");
  assert.equal(result.device.deviceId, targetDeviceId);
  assert.deepEqual(brokerInput, {
    code,
    deviceId: targetDeviceId,
    label: "New iPhone",
    publicKeyThumbprint: brokerInput?.publicKeyThumbprint,
    sourceBucket,
  });
  assert.match(String(brokerInput?.publicKeyThumbprint), /^[A-Za-z0-9_-]{43}$/);
  assert.equal("credential" in brokerInput!, false);
  assert.equal("publicKeyJwk" in brokerInput!, false);
});

test("redeem returns no credential when atomic Broker registration rejects", async () => {
  await assert.rejects(redeemOwnerRecoveryEnrollment({ code, deviceId: targetDeviceId, label: "New iPhone", publicKeyJwk, sourceBucket }, {
    ownerSecret,
    createCredential: () => "must-not-escape",
    redeem: async () => { throw new Error("broker rejected"); },
  }), /broker rejected/);
});

test("redeem rejects malformed codes, targets, labels, and non-P-256 keys", async () => {
  const dependencies = {
    ownerSecret,
    createCredential: () => "credential",
    redeem: async () => ({ device: { deviceId: targetDeviceId, label: "New iPhone", revoked: false } }),
  };
  const invalid = [
    { code: "owner-password", deviceId: targetDeviceId, label: "New iPhone", publicKeyJwk, sourceBucket },
    { code, deviceId: "bad/id", label: "New iPhone", publicKeyJwk, sourceBucket },
    { code, deviceId: targetDeviceId, label: "   ", publicKeyJwk, sourceBucket },
    { code, deviceId: targetDeviceId, label: "New iPhone", publicKeyJwk: { ...publicKeyJwk, crv: "P-384" }, sourceBucket },
    { code, deviceId: targetDeviceId, label: "New iPhone", publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, sourceBucket },
    { code, deviceId: targetDeviceId, label: "New iPhone", publicKeyJwk: { kty: "EC", crv: "P-256", x: Buffer.alloc(31).toString("base64url"), y: Buffer.alloc(32).toString("base64url") }, sourceBucket },
    { code, deviceId: targetDeviceId, label: "New iPhone", publicKeyJwk: { kty: "EC", crv: "P-256", x: Buffer.alloc(32).toString("base64url"), y: Buffer.alloc(32).toString("base64url") }, sourceBucket },
  ];
  for (const input of invalid) await assert.rejects(redeemOwnerRecoveryEnrollment(input, dependencies), /invalid recovery enrollment/);
});

test("a successful service credential has the existing trusted-device format and source addresses are HMACed", async () => {
  const result = await redeemOwnerRecoveryEnrollment({ code, deviceId: targetDeviceId, label: "New iPhone", publicKeyJwk, sourceBucket }, {
    ownerSecret,
    redeem: async () => ({ device: { deviceId: targetDeviceId, label: "New iPhone", revoked: false } }),
  });
  assert.equal(parseTrustedDeviceCredential(ownerSecret, result.credential)?.deviceId, targetDeviceId);
  const address = ownerRecoverySourceBucket(ownerSecret, "192.0.2.45");
  assert.match(address, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(address.includes("192.0.2.45"), false);
  assert.equal(ownerRecoverySourceBucket(ownerSecret, undefined), ownerRecoverySourceBucket(ownerSecret, undefined));
  assert.notEqual(address, ownerRecoverySourceBucket(ownerSecret, undefined));
});
