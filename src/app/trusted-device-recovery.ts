import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createTrustedDeviceCredential } from "./trusted-device-auth.ts";

const REQUEST_VERSION = "tqr1";
const GRANT_VERSION = "tr1";
const GRANT_TTL_SECONDS = 10 * 60;

export type TrustedDeviceRecoveryRequest = {
  deviceId: string;
  label: string;
  publicKeyJwk: JsonWebKey;
};

export type TrustedDeviceRecoveryGrant = TrustedDeviceRecoveryRequest & {
  v: 1;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function signature(secret: string, value: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function safeSignature(secret: string, value: string, encoded: string): boolean {
  try {
    const expected = signature(secret, value);
    const actual = Buffer.from(encoded, "base64url");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function validateRequest(secret: string, request: TrustedDeviceRecoveryRequest, issuedAt: number): boolean {
  try {
    createTrustedDeviceCredential(secret, {
      deviceId: request.deviceId,
      label: request.label,
      publicKeyJwk: request.publicKeyJwk,
      issuedAt,
    });
    return true;
  } catch {
    return false;
  }
}

export function parseTrustedDeviceRecoveryRequest(secret: string, requestCode: string): TrustedDeviceRecoveryRequest | null {
  if (!secret.trim()) return null;
  const [version, body, extra] = requestCode.trim().split(".");
  if (extra !== undefined || version !== REQUEST_VERSION || !body) return null;
  const request = decode<TrustedDeviceRecoveryRequest>(body);
  if (!request) return null;
  return validateRequest(secret, request, Math.floor(Date.now() / 1000)) ? request : null;
}

export function createTrustedDeviceRecoveryGrant(
  secret: string,
  request: TrustedDeviceRecoveryRequest,
  nowSeconds = Math.floor(Date.now() / 1000),
): { grant: string; expiresAt: number } {
  if (!secret.trim()) throw new Error("owner secret is required");
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) throw new Error("invalid recovery grant time");
  if (!validateRequest(secret, request, nowSeconds)) throw new Error("trusted device recovery request is invalid");

  const payload: TrustedDeviceRecoveryGrant = {
    v: 1,
    ...request,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + GRANT_TTL_SECONDS,
    nonce: randomBytes(18).toString("base64url"),
  };
  const body = encode(payload);
  const signed = `${GRANT_VERSION}.${body}`;
  return {
    grant: `${signed}.${signature(secret, signed).toString("base64url")}`,
    expiresAt: payload.expiresAt,
  };
}

export function parseTrustedDeviceRecoveryGrant(
  secret: string,
  grant: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TrustedDeviceRecoveryGrant | null {
  if (!secret.trim()) return null;
  const [version, body, signed, extra] = grant.trim().split(".");
  if (extra !== undefined || version !== GRANT_VERSION || !body || !signed) return null;
  if (!safeSignature(secret, `${version}.${body}`, signed)) return null;
  const payload = decode<TrustedDeviceRecoveryGrant>(body);
  if (!payload || payload.v !== 1 || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)) return null;
  if (payload.issuedAt > nowSeconds + 60 || payload.expiresAt < nowSeconds || payload.expiresAt - payload.issuedAt > GRANT_TTL_SECONDS) return null;
  if (!/^[A-Za-z0-9_-]{24}$/.test(payload.nonce)) return null;
  return validateRequest(secret, payload, payload.issuedAt) ? payload : null;
}
