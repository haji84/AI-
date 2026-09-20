import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  createTrustedDeviceChallenge,
  createTrustedDeviceCredential,
  parseTrustedDeviceChallenge,
  parseTrustedDeviceCredential,
  revokedTrustedDeviceIds,
  verifyTrustedDeviceProof,
} from "../src/app/trusted-device-auth.ts";

const secret = "owner-secret";
const deviceId = "device_1234567890abcdef";
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeyJwk = pair.publicKey.export({ format: "jwk" });

test("trusted credential is owner-secret scoped", () => {
  const token = createTrustedDeviceCredential(secret, { deviceId, label: "iPhone", publicKeyJwk, issuedAt: 1000 });
  const parsed = parseTrustedDeviceCredential(secret, token, 1100);
  assert.equal(parsed?.deviceId, deviceId);
  assert.equal(parseTrustedDeviceCredential("wrong-secret", token, 1100), null);
});

test("trusted challenge expires", () => {
  const issued = createTrustedDeviceChallenge(secret, deviceId, 5000);
  assert.equal(parseTrustedDeviceChallenge(secret, issued.token, 5050)?.nonce, issued.challenge.nonce);
  assert.equal(parseTrustedDeviceChallenge(secret, issued.token, 5121), null);
});

test("trusted device proof verifies the device key", () => {
  const credentialToken = createTrustedDeviceCredential(secret, { deviceId, label: "ZBook", publicKeyJwk });
  const credential = parseTrustedDeviceCredential(secret, credentialToken);
  assert.ok(credential);
  const issued = createTrustedDeviceChallenge(secret, deviceId);
  const signature = sign("sha256", Buffer.from(issued.challenge.nonce, "utf8"), { key: pair.privateKey, dsaEncoding: "ieee-p1363" });
  assert.equal(verifyTrustedDeviceProof({
    credential,
    challenge: issued.challenge,
    signatureBase64Url: signature.toString("base64url"),
  }), true);
});

test("revocation list parses device ids", () => {
  assert.deepEqual([...revokedTrustedDeviceIds("a,b,,c")], ["a", "b", "c"]);
});
