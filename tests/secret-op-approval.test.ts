import { describe, expect, it } from "vitest";
import {
  SECRET_OP_TTL_SECONDS,
  createSecretOpApprovalToken,
  verifySecretOpApprovalToken,
} from "../src/app/secret-op-approval.ts";

describe("secret operation approval", () => {
  const secret = "owner-secret-for-test";
  const expected = { action: "update_vercel_secret" as const, key: "AI_COMPANY_GITHUB_TOKEN" as const };

  it("binds approval to action/key and expires quickly", () => {
    const now = Date.UTC(2026, 8, 12, 1, 0, 0);
    const token = createSecretOpApprovalToken(secret, expected, now);
    expect(verifySecretOpApprovalToken(secret, token, expected, now + 1_000)).toBe(true);
    expect(verifySecretOpApprovalToken(secret, token, expected, now + SECRET_OP_TTL_SECONDS * 1000 + 1)).toBe(false);
  });

  it("rejects tampering, wrong secret, and wrong key", () => {
    const now = Date.UTC(2026, 8, 12, 1, 0, 0);
    const token = createSecretOpApprovalToken(secret, expected, now);
    expect(verifySecretOpApprovalToken("different", token, expected, now)).toBe(false);
    expect(verifySecretOpApprovalToken(secret, `${token}x`, expected, now)).toBe(false);
    expect(verifySecretOpApprovalToken(secret, token, { ...expected, key: "OTHER" as never }, now)).toBe(false);
  });
});
