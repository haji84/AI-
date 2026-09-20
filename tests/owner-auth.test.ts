import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerRecoveryRestrictionToken,
  createOwnerSessionToken,
  parseOwnerRecoveryRestrictionUnlockAt,
  verifyOwnerPasscode,
  verifyOwnerRecoveryRestrictionToken,
  verifyOwnerSessionToken,
} from "../src/app/owner-auth.ts";

test("owner session token validates only with the configured secret", () => {
  const token = createOwnerSessionToken("secret-a");
  assert.equal(verifyOwnerSessionToken("secret-a", token), true);
  assert.equal(verifyOwnerSessionToken("secret-b", token), false);
});

test("owner passcode comparison rejects mismatches", () => {
  assert.equal(verifyOwnerPasscode("secret-a", "secret-a"), true);
  assert.equal(verifyOwnerPasscode("secret-a", "secret-b"), false);
});

test("recovery restriction proof is not a normal owner session", () => {
  const unlockAt = 2_000_000_000;
  const token = createOwnerRecoveryRestrictionToken("secret-a", unlockAt);
  assert.equal(verifyOwnerSessionToken("secret-a", token, { nowSeconds: unlockAt - 60 }), false);
  assert.equal(verifyOwnerRecoveryRestrictionToken("secret-a", token, unlockAt - 60), true);
  assert.equal(verifyOwnerRecoveryRestrictionToken("secret-a", token, unlockAt), false);
  assert.equal(parseOwnerRecoveryRestrictionUnlockAt("secret-a", token), unlockAt);
  assert.equal(parseOwnerRecoveryRestrictionUnlockAt("secret-b", token), null);
});
