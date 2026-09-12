import { createHmac, timingSafeEqual } from "node:crypto";

export const SECRET_OP_APPROVAL_COOKIE = "ai_company_secret_op_approval";
export const SECRET_OP_TTL_SECONDS = 300;

export type SecretOpApproval = {
  version: 1;
  action: "update_vercel_secret";
  key: "AI_COMPANY_GITHUB_TOKEN";
  issuedAt: number;
  expiresAt: number;
};

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSecretOpApprovalToken(
  secret: string,
  input: Pick<SecretOpApproval, "action" | "key">,
  now = Date.now(),
): string {
  if (!secret.trim()) throw new Error("owner secret is required");
  const approval: SecretOpApproval = {
    version: 1,
    action: input.action,
    key: input.key,
    issuedAt: now,
    expiresAt: now + SECRET_OP_TTL_SECONDS * 1000,
  };
  const payload = Buffer.from(JSON.stringify(approval), "utf8").toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySecretOpApprovalToken(
  secret: string,
  token: string | undefined,
  expected: Pick<SecretOpApproval, "action" | "key">,
  now = Date.now(),
): boolean {
  if (!secret.trim() || !token) return false;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) return false;
  const expectedSignature = Buffer.from(sign(secret, payload), "utf8");
  const actualSignature = Buffer.from(signature, "utf8");
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) return false;
  try {
    const approval = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SecretOpApproval;
    return approval.version === 1
      && approval.action === expected.action
      && approval.key === expected.key
      && Number.isFinite(approval.issuedAt)
      && Number.isFinite(approval.expiresAt)
      && approval.issuedAt <= now
      && approval.expiresAt >= now
      && approval.expiresAt - approval.issuedAt <= SECRET_OP_TTL_SECONDS * 1000;
  } catch {
    return false;
  }
}
