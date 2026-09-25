import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OWNER_SESSION_COOKIE = "ai_company_owner_session";
export const OWNER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
export const OWNER_SESSION_FUTURE_TOLERANCE_SECONDS = 60;

const OWNER_SESSION_VERSION = "v2";
const TRUSTED_SESSION_VERSION = "v3";
const TRUSTED_DEVICE_ID = /^[A-Za-z0-9_-]{16,96}$/;
const OWNER_SESSION_NONCE_BYTES = 18;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type CreateOwnerSessionOptions = {
  issuedAtSeconds?: number;
  nonce?: string;
  deviceId?: string;
};

type VerifyOwnerSessionOptions = {
  nowSeconds?: number;
};

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function signSessionPayload(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function sessionPayload(issuedAtSeconds: number, nonce: string, deviceId?: string): string {
  return deviceId ? `${TRUSTED_SESSION_VERSION}.${issuedAtSeconds}.${nonce}.${deviceId}` : `${OWNER_SESSION_VERSION}.${issuedAtSeconds}.${nonce}`;
}

export function createOwnerSessionToken(secret: string, options: CreateOwnerSessionOptions = {}): string {
  if (!secret.trim()) throw new Error("owner secret is required");

  const issuedAtSeconds = options.issuedAtSeconds ?? currentUnixSeconds();
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0) throw new Error("owner session issued-at must be a positive integer");

  const nonce = options.nonce ?? randomBytes(OWNER_SESSION_NONCE_BYTES).toString("base64url");
  if (!NONCE_PATTERN.test(nonce)) throw new Error("owner session nonce is invalid");
  if (options.deviceId !== undefined && !TRUSTED_DEVICE_ID.test(options.deviceId)) throw new Error("trusted device id is invalid");

  const payload = sessionPayload(issuedAtSeconds, nonce, options.deviceId);
  const signature = signSessionPayload(secret, payload).toString("base64url");
  return `${payload}.${signature}`;
}

export function verifyOwnerSessionToken(secret: string, token: string | undefined, options: VerifyOwnerSessionOptions = {}): boolean {
  if (!secret.trim() || !token) return false;

  const parts = token.split(".");
  const [version, issuedAtRaw, nonce] = parts;
  const trusted = version === TRUSTED_SESSION_VERSION;
  if (trusted ? parts.length !== 5 || !TRUSTED_DEVICE_ID.test(parts[3]) : parts.length !== 4 || version !== OWNER_SESSION_VERSION) return false;
  const deviceId = trusted ? parts[3] : undefined;
  const signature = parts[trusted ? 4 : 3];
  if (!issuedAtRaw || !nonce || !signature) return false;
  if (!/^\d+$/.test(issuedAtRaw) || !NONCE_PATTERN.test(nonce) || !SIGNATURE_PATTERN.test(signature)) return false;

  const issuedAtSeconds = Number(issuedAtRaw);
  const nowSeconds = options.nowSeconds ?? currentUnixSeconds();
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0 || !Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) return false;
  if (issuedAtSeconds > nowSeconds + OWNER_SESSION_FUTURE_TOLERANCE_SECONDS) return false;
  if (nowSeconds - issuedAtSeconds > OWNER_SESSION_MAX_AGE_SECONDS) return false;

  const payload = sessionPayload(issuedAtSeconds, nonce, deviceId);
  const expected = signSessionPayload(secret, payload);
  const actual = Buffer.from(signature, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function ownerSessionDeviceId(secret: string, token: string | undefined, options: VerifyOwnerSessionOptions = {}): string | null {
  if (!verifyOwnerSessionToken(secret, token, options)) return null;
  return token?.startsWith(`${TRUSTED_SESSION_VERSION}.`) ? token.split(".")[3] : null;
}

export async function verifyOwnerSessionBinding(secret: string, token: string | undefined, isRevoked: (deviceId: string) => Promise<unknown>): Promise<boolean> {
  if (!verifyOwnerSessionToken(secret, token)) return false;
  const deviceId = ownerSessionDeviceId(secret, token);
  if (!deviceId) return true;
  try { return (await isRevoked(deviceId)) === false; }
  catch { return false; }
}

export function verifyOwnerPasscode(secret: string, candidate: string): boolean {
  if (!secret.trim() || !candidate) return false;
  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
