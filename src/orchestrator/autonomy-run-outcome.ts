export interface StaleCommandInvalidationOutcome {
  status: "stale_command_invalidated";
  invalidatedIssue: number;
  verificationSummary: string;
}

export interface AwaitingCommandOutcome {
  status: "awaiting_command";
  invalidatedIssue: null;
  verificationSummary: string;
  nextAction: string;
}

export interface GoalDraftNotReadyOutcome {
  status: "goal_draft_not_ready";
  invalidatedIssue: null;
  verificationSummary: string;
  nextAction: string;
  goalReadinessReasons: string[];
}

export type AutonomyLifecycleOutcome = StaleCommandInvalidationOutcome | AwaitingCommandOutcome | GoalDraftNotReadyOutcome;

export function staleCommandInvalidationOutcome(issueNumber: number): StaleCommandInvalidationOutcome {
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    throw new Error("invalidated Issue number must be a positive integer");
  }

  return {
    status: "stale_command_invalidated",
    invalidatedIssue: issueNumber,
    verificationSummary: `Persisted command for closed Issue #${issueNumber} was invalidated without executing the autonomy loop`,
  };
}

export function awaitingCommandOutcome(): AwaitingCommandOutcome {
  return {
    status: "awaiting_command",
    invalidatedIssue: null,
    verificationSummary: "No persisted Chat/Work/Codex command is available; autonomy loop was not executed",
    nextAction: "Provide a fresh bounded Chat/Work/Codex command envelope to continue autonomous work",
  };
}

export function goalDraftNotReadyOutcome(reasons: readonly string[]): GoalDraftNotReadyOutcome {
  if (reasons.length === 0) throw new Error("goal readiness reasons are required");
  return {
    status: "goal_draft_not_ready",
    invalidatedIssue: null,
    verificationSummary: `Collaborative goal draft is not execution-ready: ${reasons.join(", ")}`,
    nextAction: "Resolve the remaining goal questions with the user and provide an execution-ready goal draft",
    goalReadinessReasons: [...reasons],
  };
}

export function isMissingPersistentCommandError(error: unknown): boolean {
  return error instanceof Error
    && error.message === "Chat/Work/Codex command handoff is required and no persisted command is available";
}
