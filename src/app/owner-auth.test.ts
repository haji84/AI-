import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createOwnerSessionToken,
  OWNER_SESSION_FUTURE_TOLERANCE_SECONDS,
  OWNER_SESSION_MAX_AGE_SECONDS,
  verifyOwnerSessionToken,
  ownerSessionDeviceId,
  verifyOwnerSessionBinding,
} from "./owner-auth.ts";

const SECRET = "owner-secret";
const ISSUED_AT = 2_000_000_000;
const NONCE = "A".repeat(24);

test("owner sessions are versioned, signed, and rotate per login", () => {
  const first = createOwnerSessionToken(SECRET);
  const second = createOwnerSessionToken(SECRET);

  assert.match(first, /^v2\.\d+\.[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(verifyOwnerSessionToken(SECRET, first), true);
  assert.equal(verifyOwnerSessionToken(SECRET, second), true);
});

test("trusted Owner session binds its device ID to the signature", () => {
  const token = createOwnerSessionToken(SECRET, { issuedAtSeconds: ISSUED_AT, deviceId: "device_1234567890abcdef" });
  assert.equal(verifyOwnerSessionToken(SECRET, token, { nowSeconds: ISSUED_AT }), true);
  assert.equal(ownerSessionDeviceId(SECRET, token, { nowSeconds: ISSUED_AT }), "device_1234567890abcdef");
  assert.equal(verifyOwnerSessionToken(SECRET, token.replace("device_1234567890abcdef", "device_abcdef1234567890"), { nowSeconds: ISSUED_AT }), false);
  assert.equal(ownerSessionDeviceId(SECRET, createOwnerSessionToken(SECRET, { issuedAtSeconds: ISSUED_AT }), { nowSeconds: ISSUED_AT }), null);
});

test("trusted Owner session is denied after revocation or registry failure", async () => {
  const token = createOwnerSessionToken(SECRET, { deviceId: "device_1234567890abcdef" });
  assert.equal(await verifyOwnerSessionBinding(SECRET, token, async () => false), true);
  assert.equal(await verifyOwnerSessionBinding(SECRET, token, async () => true), false);
  assert.equal(await verifyOwnerSessionBinding(SECRET, token, async () => { throw new Error("offline"); }), false);
  assert.equal(await verifyOwnerSessionBinding(SECRET, token, async () => undefined), false);
  const legacy = createOwnerSessionToken(SECRET);
  assert.equal(await verifyOwnerSessionBinding(SECRET, legacy, async () => { throw new Error("offline"); }), true);
});

test("owner session expires after the bounded lifetime", () => {
  const token = createOwnerSessionToken(SECRET, { issuedAtSeconds: ISSUED_AT, nonce: NONCE });

  assert.equal(verifyOwnerSessionToken(SECRET, token, { nowSeconds: ISSUED_AT + OWNER_SESSION_MAX_AGE_SECONDS }), true);
  assert.equal(verifyOwnerSessionToken(SECRET, token, { nowSeconds: ISSUED_AT + OWNER_SESSION_MAX_AGE_SECONDS + 1 }), false);
});

test("owner session rejects tokens issued too far in the future", () => {
  const token = createOwnerSessionToken(SECRET, { issuedAtSeconds: ISSUED_AT, nonce: NONCE });

  assert.equal(verifyOwnerSessionToken(SECRET, token, { nowSeconds: ISSUED_AT - OWNER_SESSION_FUTURE_TOLERANCE_SECONDS }), true);
  assert.equal(verifyOwnerSessionToken(SECRET, token, { nowSeconds: ISSUED_AT - OWNER_SESSION_FUTURE_TOLERANCE_SECONDS - 1 }), false);
});

test("owner session rejects tampering and the wrong owner secret", () => {
  const token = createOwnerSessionToken(SECRET, { issuedAtSeconds: ISSUED_AT, nonce: NONCE });
  const parts = token.split(".");
  parts[2] = "B".repeat(24);
  const tampered = parts.join(".");

  assert.equal(verifyOwnerSessionToken(SECRET, tampered, { nowSeconds: ISSUED_AT }), false);
  assert.equal(verifyOwnerSessionToken("different-secret", token, { nowSeconds: ISSUED_AT }), false);
});

test("owner session fails closed for missing secrets and malformed tokens", () => {
  const token = createOwnerSessionToken(SECRET, { issuedAtSeconds: ISSUED_AT, nonce: NONCE });

  assert.equal(verifyOwnerSessionToken("", token, { nowSeconds: ISSUED_AT }), false);
  assert.equal(verifyOwnerSessionToken(SECRET, undefined, { nowSeconds: ISSUED_AT }), false);
  assert.equal(verifyOwnerSessionToken(SECRET, "v2.not-a-time.invalid.invalid", { nowSeconds: ISSUED_AT }), false);
  assert.throws(() => createOwnerSessionToken("   "), /owner secret is required/);
});

test("legacy deterministic owner cookies are intentionally invalidated", () => {
  const legacy = createHmac("sha256", SECRET).update("ai-company-owner-v1").digest("hex");
  assert.equal(verifyOwnerSessionToken(SECRET, legacy, { nowSeconds: ISSUED_AT }), false);
});
