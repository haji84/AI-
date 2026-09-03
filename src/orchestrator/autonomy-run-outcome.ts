export interface StaleCommandInvalidationOutcome {
  status: "stale_command_invalidated";
  invalidatedIssue: number;
  verificationSummary: string;
}

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
