import assert from "node:assert/strict";
import test from "node:test";
import { goalFailureCode } from "../scripts/zbook-goal-failure-code.ts";

test("diagnostics classify verifier failures without returning raw evidence", () => {
  assert.equal(goalFailureCode("changed surface needs reconciliation: src/app/jarvis/OwnerLogin.tsx"), "TRACEABILITY_STALE");
  assert.equal(goalFailureCode({ summary: "repository checks failed", secret: "opaque-test-value" }), "VERIFICATION_FAILED");
  assert.equal(goalFailureCode("approval_required"), "HUMAN_REQUIRED");
  assert.equal(goalFailureCode("spec_sync_pending:req-123"), "SPEC_SYNC_REQUIRED");
  assert.equal(goalFailureCode("something unexpected"), "UNCLASSIFIED_BLOCKER");
});
