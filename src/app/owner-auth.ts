import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OWNER_SESSION_COOKIE = "ai_company_owner_session";
export const OWNER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
const OWNER_SESSION_VERSION = "v2";
const OWNER_SESSION_MAX_FUTURE_SKEW_MS = 60_000;
const SESSION_PAYLOAD = "ai-company-owner-session-v2";

function sessionPayload(issuedAtMs: number, nonce: string): string {
  return `${SESSION_PAYLOAD}\n${issuedAtMs}\n${nonce}`;
}

function digest(secret: string, issuedAtMs: number, nonce: string): string {
  return createHmac("sha256", secret).update(sessionPayload(issuedAtMs, nonce)).digest("hex");
}

function safeEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function createOwnerSessionToken(
  secret: string,
  options: { now?: Date; nonce?: string } = {},
): string {
  if (!secret.trim()) throw new Error("owner secret is required");
  const now = options.now ?? new Date();
  const issuedAtMs = now.getTime();
  if (!Number.isFinite(issuedAtMs)) throw new Error("valid owner session issue time is required");
  const nonce = options.nonce ?? randomBytes(18).toString("base64url");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) throw new Error("valid owner session nonce is required");
  return `${OWNER_SESSION_VERSION}.${issuedAtMs}.${nonce}.${digest(secret, issuedAtMs, nonce)}`;
}

export function verifyOwnerSessionToken(
  secret: string,
  token: string | undefined,
  options: { now?: Date } = {},
): boolean {
  if (!secret.trim() || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [version, issuedAtText, nonce, signature] = parts;
  if (version !== OWNER_SESSION_VERSION || !/^\d{10,16}$/.test(issuedAtText) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return false;

  const issuedAtMs = Number(issuedAtText);
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(now)) return false;
  if (issuedAtMs > now + OWNER_SESSION_MAX_FUTURE_SKEW_MS) return false;
  if (now - issuedAtMs > OWNER_SESSION_MAX_AGE_SECONDS * 1000) return false;

  return safeEqual(digest(secret, issuedAtMs, nonce), signature);
}

export function verifyOwnerPasscode(secret: string, candidate: string): boolean {
  if (!secret.trim() || !candidate) return false;
  return safeEqual(secret, candidate);
}
