import { createHmac, timingSafeEqual } from "node:crypto";

export const OWNER_SESSION_COOKIE = "ai_company_owner_session";
const SESSION_PAYLOAD = "ai-company-owner-v1";

function digest(secret: string): string {
  return createHmac("sha256", secret).update(SESSION_PAYLOAD).digest("hex");
}

export function createOwnerSessionToken(secret: string): string {
  if (!secret.trim()) throw new Error("owner secret is required");
  return digest(secret);
}

export function verifyOwnerSessionToken(secret: string, token: string | undefined): boolean {
  if (!secret.trim() || !token) return false;
  const expected = Buffer.from(digest(secret), "utf8");
  const actual = Buffer.from(token, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyOwnerPasscode(secret: string, candidate: string): boolean {
  if (!secret.trim() || !candidate) return false;
  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
