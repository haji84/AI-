import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createTrustedDeviceRecoveryGrant,
  parseTrustedDeviceRecoveryGrant,
  parseTrustedDeviceRecoveryRequest,
  type TrustedDeviceRecoveryRequest,
} from "../src/app/trusted-device-recovery.ts";

function validRequest(): TrustedDeviceRecoveryRequest {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    deviceId: "device_recovery_1234567890",
    label: "Recovery browser",
    publicKeyJwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
  };
}

function requestCode(request: TrustedDeviceRecoveryRequest): string {
  return `tqr1.${Buffer.from(JSON.stringify(request), "utf8").toString("base64url")}`;
}

test("trusted-device recovery request accepts only a valid target public key", () => {
  const request = validRequest();
  assert.deepEqual(parseTrustedDeviceRecoveryRequest("owner-secret", requestCode(request)), request);
  assert.equal(parseTrustedDeviceRecoveryRequest("owner-secret", "tqr1.invalid"), null);
});

test("trusted-device recovery grant is signed, target-bound and short lived", () => {
  const request = validRequest();
  const now = 2_000_000_000;
  const { grant, expiresAt } = createTrustedDeviceRecoveryGrant("owner-secret", request, now);
  assert.equal(expiresAt, now + 600);
  const parsed = parseTrustedDeviceRecoveryGrant("owner-secret", grant, now + 1);
  assert.equal(parsed?.deviceId, request.deviceId);
  assert.deepEqual(parsed?.publicKeyJwk, request.publicKeyJwk);
  assert.equal(parseTrustedDeviceRecoveryGrant("wrong-secret", grant, now + 1), null);
  assert.equal(parseTrustedDeviceRecoveryGrant("owner-secret", grant, now + 601), null);

  const [version, body, signature] = grant.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  payload.deviceId = "different_device_123456789";
  const tampered = `${version}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${signature}`;
  assert.equal(parseTrustedDeviceRecoveryGrant("owner-secret", tampered, now + 1), null);
});
