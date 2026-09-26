import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerSessionToken } from "../src/app/owner-auth.ts";
import { verifyFreshTrustedOwnerSessionAccess } from "../src/app/fresh-trusted-owner-session.ts";

const secret = "owner-secret-for-recovery-session-tests";
const deviceId = "device_1234567890abcdef";

test("fresh trusted access accepts the age boundary and rejects one second beyond it", async () => {
  const now = Math.floor(Date.now() / 1000);
  const boundary = createOwnerSessionToken(secret, { issuedAtSeconds: now - 120, deviceId });
  const stale = createOwnerSessionToken(secret, { issuedAtSeconds: now - 121, deviceId });
  assert.equal(await verifyFreshTrustedOwnerSessionAccess(secret, boundary, 120, async () => false, now), deviceId);
  assert.equal(await verifyFreshTrustedOwnerSessionAccess(secret, stale, 120, async () => false, now), null);
});

test("fresh trusted access rejects passcode sessions and revoked devices", async () => {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const trusted = createOwnerSessionToken(secret, { issuedAtSeconds, deviceId });
  const passcode = createOwnerSessionToken(secret, { issuedAtSeconds });
  assert.equal(await verifyFreshTrustedOwnerSessionAccess(secret, trusted, 120, async () => true, issuedAtSeconds), null);
  assert.equal(await verifyFreshTrustedOwnerSessionAccess(secret, passcode, 120, async () => false, issuedAtSeconds), null);
});

test("fresh trusted access fails closed when revocation state is unavailable", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createOwnerSessionToken(secret, { issuedAtSeconds: now, deviceId });
  assert.equal(await verifyFreshTrustedOwnerSessionAccess(secret, token, 120, async () => {
    throw new Error("registry unavailable");
  }, now), null);
});
