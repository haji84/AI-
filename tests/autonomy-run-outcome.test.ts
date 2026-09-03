import assert from "node:assert/strict";
import test from "node:test";
import {
  awaitingCommandOutcome,
  goalDraftNotReadyOutcome,
  isMissingPersistentCommandError,
  staleCommandInvalidationOutcome,
} from "../src/orchestrator/autonomy-run-outcome.ts";

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

test("classifies missing persisted command as an idle ready state", () => {
  assert.deepEqual(awaitingCommandOutcome(), {
    status: "awaiting_command",
    invalidatedIssue: null,
    verificationSummary: "No persisted Chat/Work/Codex command is available; autonomy loop was not executed",
    nextAction: "Provide a fresh bounded Chat/Work/Codex command envelope to continue autonomous work",
  });
});

test("classifies a non-ready collaborative goal as a successful gated no-op", () => {
  assert.deepEqual(goalDraftNotReadyOutcome(["low_confidence", "user_approval_required"]), {
    status: "goal_draft_not_ready",
    invalidatedIssue: null,
    verificationSummary: "Collaborative goal draft is not execution-ready: low_confidence, user_approval_required",
    nextAction: "Resolve the remaining goal questions with the user and provide an execution-ready goal draft",
    goalReadinessReasons: ["low_confidence", "user_approval_required"],
  });
  assert.throws(() => goalDraftNotReadyOutcome([]), /readiness reasons are required/);
});

test("only recognizes the expected missing persisted command error", () => {
  assert.equal(
    isMissingPersistentCommandError(new Error("Chat/Work/Codex command handoff is required and no persisted command is available")),
    true,
  );
  assert.equal(isMissingPersistentCommandError(new Error("Chat/Work/Codex command handoff is not valid JSON")), false);
  assert.equal(isMissingPersistentCommandError("not an error"), false);
});
