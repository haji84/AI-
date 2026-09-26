import assert from "node:assert/strict";
import test from "node:test";
import { GoogleOwnerEnrollmentStore, publicKeyThumbprint } from "../src/app/google-owner-enrollment.ts";

const key = { kty: "EC", crv: "P-256", x: "abc", y: "def" } as JsonWebKey;

test("context allows a two-minute physical Google login and remains single-use", () => {
  const store = new GoogleOwnerEnrollmentStore();
  const issued = store.issue({ deviceId: "device_1234567890abcdef", publicKeyJwk: key, state: "s1", nonce: "n1", pkceChallenge: "p1" }, 1000);
  assert.equal(issued.expiresAt, 1300);
  assert.throws(() => store.consume({ ...issued, deviceId: "device_other_1234567890", publicKeyThumbprint: publicKeyThumbprint(key), state: "s1", nonce: "n1" }, 1001));
  const result = store.consume({ ...issued, deviceId: "device_1234567890abcdef", publicKeyThumbprint: publicKeyThumbprint(key), state: "s1", nonce: "n1" }, 1120);
  assert.equal(result.pkceChallenge, "p1");
  assert.throws(() => store.consume({ ...issued, deviceId: "device_1234567890abcdef", publicKeyThumbprint: publicKeyThumbprint(key), state: "s1", nonce: "n1" }, 1121));
});

test("expired context fails closed", () => {
  const store = new GoogleOwnerEnrollmentStore();
  const issued = store.issue({ deviceId: "device_1234567890abcdef", publicKeyJwk: key, state: "s", nonce: "n", pkceChallenge: "p" }, 1000);
  assert.throws(() => store.consume({ ...issued, deviceId: "device_1234567890abcdef", publicKeyThumbprint: publicKeyThumbprint(key), state: "s", nonce: "n" }, 1301));
});
