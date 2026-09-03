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

export type AutonomyLifecycleOutcome = StaleCommandInvalidationOutcome | AwaitingCommandOutcome;

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

export function isMissingPersistentCommandError(error: unknown): boolean {
  return error instanceof Error
    && error.message === "Chat/Work/Codex command handoff is required and no persisted command is available";
}
