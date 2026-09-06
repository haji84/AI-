import assert from "node:assert/strict";
import test from "node:test";
import { approvalReadinessFromEnv } from "../src/app/approval-readiness.ts";

test("approval readiness reports both required settings when absent", () => {
  const state = approvalReadinessFromEnv({});
  assert.equal(state.ready, false);
  assert.deepEqual(state.missing, ["オーナー認証コード", "GitHub承認トークン"]);
  assert.equal(state.repository, "haji84/AI-");
});

test("approval readiness is ready only when owner secret and GitHub token are present", () => {
  const state = approvalReadinessFromEnv({
    AI_COMPANY_OWNER_SECRET: "owner-secret",
    AI_COMPANY_GITHUB_TOKEN: "token",
    AI_COMPANY_GITHUB_REPOSITORY: "haji84/AI-",
  });
  assert.equal(state.ready, true);
  assert.deepEqual(state.missing, []);
});
