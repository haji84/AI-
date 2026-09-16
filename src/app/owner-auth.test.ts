import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createOwnerSessionToken,
  OWNER_SESSION_FUTURE_TOLERANCE_SECONDS,
  OWNER_SESSION_MAX_AGE_SECONDS,
  verifyOwnerSessionToken,
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
