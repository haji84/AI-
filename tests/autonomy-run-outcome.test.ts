import assert from "node:assert/strict";
import test from "node:test";
import { staleCommandInvalidationOutcome } from "../src/orchestrator/autonomy-run-outcome.ts";

test("classifies stale persisted Issue invalidation as a successful no-op outcome", () => {
  assert.deepEqual(staleCommandInvalidationOutcome(125), {
    status: "stale_command_invalidated",
    invalidatedIssue: 125,
    verificationSummary: "Persisted command for closed Issue #125 was invalidated without executing the autonomy loop",
  });
});

test("rejects invalid Issue numbers for stale command outcomes", () => {
  assert.throws(() => staleCommandInvalidationOutcome(0), /positive integer/);
  assert.throws(() => staleCommandInvalidationOutcome(1.5), /positive integer/);
});
