import assert from "node:assert/strict";
import test from "node:test";
import {
  SECRET_OP_TTL_SECONDS,
  createSecretOpApprovalToken,
  verifySecretOpApprovalToken,
} from "../src/app/secret-op-approval.ts";

const secret = "owner-secret-for-test";
const expected = { action: "update_vercel_secret" as const, key: "AI_COMPANY_GITHUB_TOKEN" as const };

test("secret operation approval binds to action/key and expires quickly", () => {
  const now = Date.UTC(2026, 8, 12, 1, 0, 0);
  const token = createSecretOpApprovalToken(secret, expected, now);
  assert.equal(verifySecretOpApprovalToken(secret, token, expected, now + 1_000), true);
  assert.equal(verifySecretOpApprovalToken(secret, token, expected, now + SECRET_OP_TTL_SECONDS * 1000 + 1), false);
});

test("secret operation approval rejects tampering, wrong secret, and wrong key", () => {
  const now = Date.UTC(2026, 8, 12, 1, 0, 0);
  const token = createSecretOpApprovalToken(secret, expected, now);
  assert.equal(verifySecretOpApprovalToken("different", token, expected, now), false);
  assert.equal(verifySecretOpApprovalToken(secret, `${token}x`, expected, now), false);
  assert.equal(verifySecretOpApprovalToken(secret, token, { ...expected, key: "OTHER" as never }, now), false);
});
