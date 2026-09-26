import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

const CREDENTIAL_VERSION = "td1";
const CHALLENGE_VERSION = "tc1";
const MAX_CREDENTIAL_AGE_SECONDS = 60 * 60 * 24 * 365;
const CHALLENGE_TTL_SECONDS = 120;
const DEVICE_ID = /^[A-Za-z0-9_-]{16,96}$/;

export function canonicalTrustedDevicePublicKey(jwk: JsonWebKey): JsonWebKey {
  if (jwk?.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || jwk.d !== undefined) {
    throw new Error("trusted device must use an ECDSA P-256 public key");
  }
  try {
    const canonical = createPublicKey({ key: JSON.parse(JSON.stringify(jwk)), format: "jwk" }).export({ format: "jwk" }) as JsonWebKey;
    if (canonical.kty !== "EC" || canonical.crv !== "P-256" || !canonical.x || !canonical.y || canonical.x !== jwk.x || canonical.y !== jwk.y) {
      throw new Error("invalid key");
    }
    return { kty: "EC", crv: "P-256", x: canonical.x, y: canonical.y };
  } catch { throw new Error("trusted device must use an ECDSA P-256 public key"); }
}

export type TrustedDeviceCredential = {
  v: 1;
  deviceId: string;
  label: string;
  publicKeyJwk: JsonWebKey;
  issuedAt: number;
};

export type TrustedDeviceChallenge = {
  v: 1;
  deviceId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function decode<T>(value: string): T | null {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T; } catch { return null; }
}
function hmac(secret: string, value: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}
function safeSignature(secret: string, value: string, encoded: string): boolean {
  try {
    const expected = hmac(secret, value);
    const actual = Buffer.from(encoded, "base64url");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

export function createTrustedDeviceCredential(secret: string, input: {
  deviceId: string;
  label: string;
  publicKeyJwk: JsonWebKey;
  issuedAt?: number;
}): string {
  if (!secret.trim()) throw new Error("owner secret is required");
  if (!DEVICE_ID.test(input.deviceId)) throw new Error("trusted device id is invalid");
  const label = input.label.trim().slice(0, 80);
  if (!label) throw new Error("trusted device label is required");
  const publicKeyJwk = canonicalTrustedDevicePublicKey(input.publicKeyJwk);
  const payload: TrustedDeviceCredential = {
    v: 1,
    deviceId: input.deviceId,
    label,
    publicKeyJwk,
    issuedAt: input.issuedAt ?? Math.floor(Date.now() / 1000),
  };
  const body = encode(payload);
  return `${CREDENTIAL_VERSION}.${body}.${hmac(secret, `${CREDENTIAL_VERSION}.${body}`).toString("base64url")}`;
}

export function parseTrustedDeviceCredential(secret: string, token: string, nowSeconds = Math.floor(Date.now() / 1000)): TrustedDeviceCredential | null {
  const [version, body, signature, extra] = token.split(".");
  if (extra !== undefined || version !== CREDENTIAL_VERSION || !body || !signature) return null;
  if (!safeSignature(secret, `${version}.${body}`, signature)) return null;
  const payload = decode<TrustedDeviceCredential>(body);
  if (!payload || payload.v !== 1 || !DEVICE_ID.test(payload.deviceId) || !payload.label || !Number.isSafeInteger(payload.issuedAt)) return null;
  try { payload.publicKeyJwk = canonicalTrustedDevicePublicKey(payload.publicKeyJwk); }
  catch { return null; }
  if (payload.issuedAt > nowSeconds + 60 || nowSeconds - payload.issuedAt > MAX_CREDENTIAL_AGE_SECONDS) return null;
  return payload;
}

export function revokedTrustedDeviceIds(value = process.env.JARVIS_REVOKED_TRUSTED_DEVICE_IDS || ""): Set<string> {
  return new Set(value.split(",").map(item => item.trim()).filter(Boolean));
}

export function createTrustedDeviceChallenge(secret: string, deviceId: string, nowSeconds = Math.floor(Date.now() / 1000)): { token: string; challenge: TrustedDeviceChallenge } {
  if (!secret.trim() || !DEVICE_ID.test(deviceId)) throw new Error("trusted device challenge context is invalid");
  const challenge: TrustedDeviceChallenge = {
    v: 1,
    deviceId,
    nonce: randomBytes(32).toString("base64url"),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + CHALLENGE_TTL_SECONDS,
  };
  const body = encode(challenge);
  return {
    challenge,
    token: `${CHALLENGE_VERSION}.${body}.${hmac(secret, `${CHALLENGE_VERSION}.${body}`).toString("base64url")}`,
  };
}

export function parseTrustedDeviceChallenge(secret: string, token: string, nowSeconds = Math.floor(Date.now() / 1000)): TrustedDeviceChallenge | null {
  const [version, body, signature, extra] = token.split(".");
  if (extra !== undefined || version !== CHALLENGE_VERSION || !body || !signature) return null;
  if (!safeSignature(secret, `${version}.${body}`, signature)) return null;
  const payload = decode<TrustedDeviceChallenge>(body);
  if (!payload || payload.v !== 1 || !DEVICE_ID.test(payload.deviceId) || !payload.nonce || !Number.isSafeInteger(payload.expiresAt)) return null;
  if (payload.expiresAt < nowSeconds || payload.issuedAt > nowSeconds + 60) return null;
  return payload;
}

export function verifyTrustedDeviceProof(input: {
  credential: TrustedDeviceCredential;
  challenge: TrustedDeviceChallenge;
  signatureBase64Url: string;
}): boolean {
  if (input.credential.deviceId !== input.challenge.deviceId) return false;
  try {
    const key = createPublicKey({ key: JSON.parse(JSON.stringify(input.credential.publicKeyJwk)), format: "jwk" });
    return verify(
      "sha256",
      Buffer.from(input.challenge.nonce, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(input.signatureBase64Url, "base64url"),
    );
  } catch { return false; }
}
