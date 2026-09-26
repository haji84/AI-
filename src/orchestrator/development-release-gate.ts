import { evaluateTaskScopedAutoMergeEligibility } from "./auto-merge-policy.ts";
import type { DevelopmentJobPhase, DevelopmentRisk } from "./development-job.ts";
import {
  evaluateDevelopmentVerification,
  type DevelopmentVerificationEvidence,
  type DevelopmentVerificationPlan,
} from "./development-verification-plan.ts";
import {
  isTaskCompletionAuthorizationActive,
  isTaskProductionDeployAuthorizationActive,
  type TaskCompletionAuthorization,
} from "./task-authorization.ts";

export type NonBypassableDevelopmentGate =
  | "secrets_or_credentials"
  | "permission_or_token_scope"
  | "billing_or_contract"
  | "destructive_or_hard_to_recover"
  | "governance_or_safety_weakening";

export type DevelopmentReleaseAction =
  | "READY_TO_PUBLISH"
  | "HUMAN_GATE"
  | "BLOCKED"
  | "OPEN_PR"
  | "ENABLE_AUTO_MERGE"
  | "WAIT_FOR_MERGE"
  | "WAIT_MAIN_CI"
  | "DEPLOY_PRODUCTION"
  | "VERIFY_PRODUCTION"
  | "COMPLETE";

export interface DevelopmentPullRequestState {
  url: string;
  headRevision: string;
  baseBranch: string;
  draft: boolean;
  autoMergeEnabled: boolean;
  mergedRevision: string | null;
  reviewerPassed: boolean;
  unresolvedReviewThreads: number;
}

export interface DevelopmentReleaseGateInput {
  phase: DevelopmentJobPhase;
  connected: boolean;
  risk: DevelopmentRisk;
  taskScopeId: string;
  taskAuthorization?: TaskCompletionAuthorization;
  changedFiles: string[];
  verificationPlan: DevelopmentVerificationPlan;
  verificationEvidence: DevelopmentVerificationEvidence[];
  protectedConditions: NonBypassableDevelopmentGate[];
  pullRequest: DevelopmentPullRequestState | null;
  mainCi: { revision: string; passed: boolean } | null;
  deployment: { revision: string; artifactDigest: string; environment: "production" } | null;
  postDeploymentEvidence: {
    verifierId: string;
    revision: string;
    artifactDigest: string;
    passed: boolean;
    recordedAt: string;
  } | null;
  now?: Date;
}

export interface DevelopmentReleaseGateDecision {
  action: DevelopmentReleaseAction;
  reasons: string[];
}

function decision(action: DevelopmentReleaseAction, ...reasons: string[]): DevelopmentReleaseGateDecision {
  return { action, reasons };
}

export function evaluateDevelopmentReleaseGate(input: DevelopmentReleaseGateInput): DevelopmentReleaseGateDecision {
  const now = input.now ?? new Date();
  if (input.protectedConditions.length) {
    return decision("HUMAN_GATE", ...input.protectedConditions.map((item) => `non_bypassable:${item}`));
  }
  if (input.risk === "high" || input.risk === "critical") return decision("HUMAN_GATE", `risk_requires_human_gate:${input.risk}`);
  if (!isTaskCompletionAuthorizationActive(input.taskAuthorization, input.taskScopeId, now)) {
    return decision("HUMAN_GATE", "task_completion_authorization_missing_or_invalid");
  }
  const verification = evaluateDevelopmentVerification(input.verificationPlan, input.verificationEvidence);
  if (!verification.passed) return decision("BLOCKED", ...verification.reasons);
  if (!input.connected) return decision("READY_TO_PUBLISH", "publication_connectivity_unavailable");
  if (input.phase !== "READY_TO_PUBLISH" && input.phase !== "PUBLISHING" && input.phase !== "VERIFYING") {
    return decision("BLOCKED", `invalid_release_phase:${input.phase}`);
  }
  if (!input.pullRequest) return decision("OPEN_PR");
  if (input.pullRequest.headRevision !== input.verificationPlan.sourceRevision) return decision("BLOCKED", "pull_request_revision_mismatch");

  const autoMerge = evaluateTaskScopedAutoMergeEligibility({
    baseBranch: input.pullRequest.baseBranch,
    changedFiles: input.changedFiles,
    lintPassed: true,
    testsPassed: true,
    buildPassed: true,
    qaPassed: true,
    reviewerPassed: input.pullRequest.reviewerPassed,
    unresolvedReviewThreads: input.pullRequest.unresolvedReviewThreads,
    destructiveChangeAbsent: true,
    privilegedChangeAbsent: true,
    draft: input.pullRequest.draft,
    taskAuthorization: input.taskAuthorization,
    taskScopeId: input.taskScopeId,
  }, now);
  if (!autoMerge.eligible) return decision("BLOCKED", ...autoMerge.reasons);
  if (!input.pullRequest.autoMergeEnabled) return decision("ENABLE_AUTO_MERGE");
  if (!input.pullRequest.mergedRevision) return decision("WAIT_FOR_MERGE");
  if (!input.mainCi) return decision("WAIT_MAIN_CI", "main_ci_pending");
  if (input.mainCi.revision !== input.pullRequest.mergedRevision) return decision("BLOCKED", "main_ci_revision_mismatch");
  if (!input.mainCi.passed) return decision("BLOCKED", "main_ci_failed");
  if (!isTaskProductionDeployAuthorizationActive(input.taskAuthorization, input.taskScopeId, now)) {
    return decision("HUMAN_GATE", "production_deploy_authorization_missing_or_invalid");
  }
  if (!input.deployment) return decision("DEPLOY_PRODUCTION");
  if (input.deployment.revision !== input.pullRequest.mergedRevision) return decision("BLOCKED", "deployment_revision_mismatch");
  if (input.deployment.artifactDigest !== input.verificationPlan.artifactDigest) return decision("BLOCKED", "deployment_artifact_mismatch");
  if (!input.postDeploymentEvidence) return decision("VERIFY_PRODUCTION");
  const post = input.postDeploymentEvidence;
  if (!post.passed) return decision("BLOCKED", "post_deployment_verification_failed");
  if (post.revision !== input.deployment.revision) return decision("BLOCKED", "post_deployment_revision_mismatch");
  if (post.artifactDigest !== input.deployment.artifactDigest) return decision("BLOCKED", "post_deployment_artifact_mismatch");
  if (post.verifierId === input.verificationPlan.builderId) return decision("BLOCKED", "post_deployment_verifier_not_independent");
  if (!Number.isFinite(Date.parse(post.recordedAt))) return decision("BLOCKED", "post_deployment_timestamp_invalid");
  return decision("COMPLETE");
}
