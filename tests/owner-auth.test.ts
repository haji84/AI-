import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerSessionToken,
  OWNER_SESSION_FUTURE_TOLERANCE_SECONDS,
  OWNER_SESSION_MAX_AGE_SECONDS,
  verifyOwnerPasscode,
  verifyOwnerSessionToken,
} from "../src/app/owner-auth.ts";

const secret = "owner-secret-a";
const issuedAtSeconds = 2_000_000_000;
const nonce = "A".repeat(24);

test("owner session token validates only with the configured secret", () => {
  const token = createOwnerSessionToken(secret, { issuedAtSeconds, nonce });
  assert.equal(verifyOwnerSessionToken(secret, token, { nowSeconds: issuedAtSeconds }), true);
  assert.equal(verifyOwnerSessionToken("owner-secret-b", token, { nowSeconds: issuedAtSeconds }), false);
});

test("owner session token fails closed on tampering and malformed legacy-shaped input", () => {
  const token = createOwnerSessionToken(secret, { issuedAtSeconds, nonce });
  const parts = token.split(".");
  const signature = parts[3];
  const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

  assert.equal(verifyOwnerSessionToken(secret, `${parts[0]}.${parts[1]}.${parts[2]}.${tamperedSignature}`, { nowSeconds: issuedAtSeconds }), false);
  assert.equal(verifyOwnerSessionToken(secret, `v1.${issuedAtSeconds}.${nonce}.${signature}`, { nowSeconds: issuedAtSeconds }), false);
  assert.equal(verifyOwnerSessionToken(secret, "", { nowSeconds: issuedAtSeconds }), false);
});

test("owner session token enforces expiry and future clock tolerance", () => {
  const token = createOwnerSessionToken(secret, { issuedAtSeconds, nonce });

  assert.equal(
    verifyOwnerSessionToken(secret, token, { nowSeconds: issuedAtSeconds + OWNER_SESSION_MAX_AGE_SECONDS }),
    true,
  );
  assert.equal(
    verifyOwnerSessionToken(secret, token, { nowSeconds: issuedAtSeconds + OWNER_SESSION_MAX_AGE_SECONDS + 1 }),
    false,
  );

  const futureToken = createOwnerSessionToken(secret, {
    issuedAtSeconds: issuedAtSeconds + OWNER_SESSION_FUTURE_TOLERANCE_SECONDS + 1,
    nonce: "B".repeat(24),
  });
  assert.equal(verifyOwnerSessionToken(secret, futureToken, { nowSeconds: issuedAtSeconds }), false);
});

test("owner sessions include a fresh nonce when one is not supplied", () => {
  const first = createOwnerSessionToken(secret, { issuedAtSeconds });
  const second = createOwnerSessionToken(secret, { issuedAtSeconds });

  assert.notEqual(first, second);
  assert.equal(verifyOwnerSessionToken(secret, first, { nowSeconds: issuedAtSeconds }), true);
  assert.equal(verifyOwnerSessionToken(secret, second, { nowSeconds: issuedAtSeconds }), true);
});

test("owner passcode comparison rejects mismatches", () => {
  assert.equal(verifyOwnerPasscode("secret-a", "secret-a"), true);
  assert.equal(verifyOwnerPasscode("secret-a", "secret-b"), false);
});
