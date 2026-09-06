import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerSessionToken, verifyOwnerPasscode, verifyOwnerSessionToken } from "../src/app/owner-auth.ts";

test("owner session token validates only with the configured secret", () => {
  const token = createOwnerSessionToken("secret-a");
  assert.equal(verifyOwnerSessionToken("secret-a", token), true);
  assert.equal(verifyOwnerSessionToken("secret-b", token), false);
});

test("owner passcode comparison rejects mismatches", () => {
  assert.equal(verifyOwnerPasscode("secret-a", "secret-a"), true);
  assert.equal(verifyOwnerPasscode("secret-a", "secret-b"), false);
});
