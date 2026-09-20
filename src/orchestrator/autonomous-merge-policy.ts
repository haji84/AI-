export interface MergeGateInput {
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requiredChecks: Array<{ name: string; status: "success" | "failure" | "pending" | "expected" | "missing" }>;
  humanGateRequired: boolean;
  securityGatePassed: boolean;
  branchUpToDate: boolean;
  unresolvedReviewThreads: number;
  mergeable: boolean;
}

export interface MergeDecision {
  action: "MERGE_NOW" | "ENABLE_AUTO_MERGE" | "WAIT" | "HUMAN_GATE" | "BLOCK";
  reason: string;
}

export function decideAutonomousMerge(input: MergeGateInput): MergeDecision {
  if (input.humanGateRequired || input.risk === "HIGH" || input.risk === "CRITICAL") {
    return { action: "HUMAN_GATE", reason: "risk_or_policy_requires_human_approval" };
  }
  if (!input.securityGatePassed) {
    return { action: "BLOCK", reason: "security_gate_not_passed" };
  }
  if (!input.mergeable) {
    return { action: "BLOCK", reason: "pull_request_not_mergeable" };
  }
  if (!input.branchUpToDate) {
    return { action: "WAIT", reason: "branch_must_be_updated_and_reverified" };
  }
  if (input.unresolvedReviewThreads > 0) {
    return { action: "WAIT", reason: "unresolved_review_threads" };
  }
  if (input.requiredChecks.some((check) => check.status === "failure" || check.status === "missing")) {
    return { action: "BLOCK", reason: "required_check_failed_or_missing" };
  }
  if (input.requiredChecks.some((check) => check.status === "pending" || check.status === "expected")) {
    return { action: "ENABLE_AUTO_MERGE", reason: "required_checks_not_yet_merge-ready" };
  }
  return { action: "MERGE_NOW", reason: "all_required_gates_passed" };
}
