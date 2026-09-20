import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OWNER_SESSION_COOKIE = "ai_company_owner_session";
export const OWNER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
export const OWNER_SESSION_FUTURE_TOLERANCE_SECONDS = 60;

const OWNER_SESSION_VERSION = "v2";
const OWNER_SESSION_NONCE_BYTES = 18;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type CreateOwnerSessionOptions = {
  issuedAtSeconds?: number;
  nonce?: string;
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

function sessionPayload(issuedAtSeconds: number, nonce: string): string {
  return `${OWNER_SESSION_VERSION}.${issuedAtSeconds}.${nonce}`;
}

export function createOwnerSessionToken(secret: string, options: CreateOwnerSessionOptions = {}): string {
  if (!secret.trim()) throw new Error("owner secret is required");

  const issuedAtSeconds = options.issuedAtSeconds ?? currentUnixSeconds();
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0) throw new Error("owner session issued-at must be a positive integer");

  const nonce = options.nonce ?? randomBytes(OWNER_SESSION_NONCE_BYTES).toString("base64url");
  if (!NONCE_PATTERN.test(nonce)) throw new Error("owner session nonce is invalid");

  const payload = sessionPayload(issuedAtSeconds, nonce);
  const signature = signSessionPayload(secret, payload).toString("base64url");
  return `${payload}.${signature}`;
}

export function verifyOwnerSessionToken(secret: string, token: string | undefined, options: VerifyOwnerSessionOptions = {}): boolean {
  if (!secret.trim() || !token) return false;

  const [version, issuedAtRaw, nonce, signature, extra] = token.split(".");
  if (extra !== undefined || version !== OWNER_SESSION_VERSION || !issuedAtRaw || !nonce || !signature) return false;
  if (!/^\d+$/.test(issuedAtRaw) || !NONCE_PATTERN.test(nonce) || !SIGNATURE_PATTERN.test(signature)) return false;

  const issuedAtSeconds = Number(issuedAtRaw);
  const nowSeconds = options.nowSeconds ?? currentUnixSeconds();
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0 || !Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) return false;
  if (issuedAtSeconds > nowSeconds + OWNER_SESSION_FUTURE_TOLERANCE_SECONDS) return false;
  if (nowSeconds - issuedAtSeconds > OWNER_SESSION_MAX_AGE_SECONDS) return false;

  const payload = sessionPayload(issuedAtSeconds, nonce);
  const expected = signSessionPayload(secret, payload);
  const actual = Buffer.from(signature, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyOwnerPasscode(secret: string, candidate: string): boolean {
  if (!secret.trim() || !candidate) return false;
  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}


export const OWNER_RECOVERY_RESTRICTED_COOKIE = "jarvis_owner_recovery_restricted";
const OWNER_RECOVERY_RESTRICTION_VERSION = "rr1";

export function createOwnerRecoveryRestrictionToken(secret: string, restrictedUntilSeconds: number): string {
  if (!secret.trim() || !Number.isSafeInteger(restrictedUntilSeconds) || restrictedUntilSeconds <= 0) throw new Error("invalid recovery restriction");
  const nonce = randomBytes(OWNER_SESSION_NONCE_BYTES).toString("base64url");
  const payload = `${OWNER_RECOVERY_RESTRICTION_VERSION}.${restrictedUntilSeconds}.${nonce}`;
  const signature = signSessionPayload(secret, payload).toString("base64url");
  return `${payload}.${signature}`;
}

export function verifyOwnerRecoveryRestrictionToken(secret: string, token: string | undefined, nowSeconds = currentUnixSeconds()): boolean {
  if (!secret.trim() || !token) return false;
  const [version, untilRaw, nonce, signature, extra] = token.split(".");
  if (extra !== undefined || version !== OWNER_RECOVERY_RESTRICTION_VERSION || !/^\d+$/.test(untilRaw || "") || !NONCE_PATTERN.test(nonce || "") || !SIGNATURE_PATTERN.test(signature || "")) return false;
  const until = Number(untilRaw);
  if (!Number.isSafeInteger(until) || until <= nowSeconds) return false;
  const payload = `${version}.${until}.${nonce}`;
  const expected = signSessionPayload(secret, payload);
  const actual = Buffer.from(signature, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
