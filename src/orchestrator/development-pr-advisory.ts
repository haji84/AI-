import { evaluateRiskPolicy, type RiskSignals } from "./risk-policy.ts";

export interface ExistingPr {
  number: number;
  repository: string;
  issueNumber: number;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed";
  merged: boolean;
}

export interface Ai09Receipt {
  reviewer: "AI-09";
  evidenceClass: "AI_ASSERTED";
  status: "NO_ACTIONABLE_FINDINGS" | "CHANGES_REQUESTED" | "INCONCLUSIVE" | "BLOCKED";
  scope: { baseSha: string; headSha: string };
  githubApprovalSatisfied: false;
  mergeAuthorized: false;
}

export interface Intake {
  repository: string;
  issueNumber: number;
  baseBranch: string;
  operation: "new_work" | "fix_existing_pr";
  inventoryComplete: boolean;
  pullRequests: ExistingPr[];
  riskEvidenceComplete: boolean;
  riskSignals: RiskSignals;
  comparison?: { baseSha: string; headSha: string };
  ai09?: Ai09Receipt;
  globallyPaused: boolean;
}

export interface Advice {
  executionAuthority: false;
  pr: { action: "REUSE" | "NEW_CANDIDATE" | "RECONCILE"; number?: number; reason: string };
  risk: ReturnType<typeof evaluateRiskPolicy> | null;
  gate: "ASSESSMENT_REQUIRED" | "ADVISORY_ONLY" | "HUMAN_REQUIRED" | "SECURITY_HOLD";
  review: "NOT_REVIEWED" | "STALE" | "INCONCLUSIVE" | "FINDINGS" | "CLEAR_ADVISORY";
  unrelatedSafeWorkMayContinue: boolean;
}

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RISK_KEYS = new Set<keyof RiskSignals>([
  "productionDeploy","secretsOrCredentialsChange","permissionChange","billingOrContractChange",
  "destructiveSchemaChange","destructiveOrHardToRecoverDelete","securityWeakening",
  "majorExternalPublicationChange","highRiskMainMerge","dependencyUpdate","crossComponentChange",
  "mainMerge","humanGatePolicyRelaxation","protectionOrAuditDisable","unrecoverableProductionDestruction",
]);

/** Non-authoritative proposal only. Cannot create PRs, grant approval, or merge. */
export function adviseDevelopmentIntake(input: Intake): Advice {
  if (!input || !REPO.test(input.repository) || !Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0 ||
      !input.baseBranch || input.baseBranch.includes("..") ||
      !["new_work","fix_existing_pr"].includes(input.operation) ||
      typeof input.inventoryComplete !== "boolean" || !Array.isArray(input.pullRequests) ||
      typeof input.riskEvidenceComplete !== "boolean" || !input.riskSignals ||
      typeof input.riskSignals !== "object" || typeof input.globallyPaused !== "boolean" ||
      Object.entries(input.riskSignals).some(([k,v]) => !RISK_KEYS.has(k as keyof RiskSignals) || typeof v !== "boolean") ||
      input.pullRequests.some(p => !Number.isSafeInteger(p.number) || p.number <= 0 ||
        !Number.isSafeInteger(p.issueNumber) || p.issueNumber <= 0 || !REPO.test(p.repository) ||
        !p.baseBranch || !p.headBranch || !["open","closed"].includes(p.state) || typeof p.merged !== "boolean"))
    throw Error("invalid_intake");

  if (input.comparison && (!SHA.test(input.comparison.baseSha) || !SHA.test(input.comparison.headSha)))
    throw Error("invalid_comparison");
  const relevant = input.pullRequests.filter(p =>
    p.repository === input.repository && p.issueNumber === input.issueNumber && p.baseBranch === input.baseBranch);
  const open = relevant.filter(p => p.state === "open" && !p.merged && p.headBranch !== input.baseBranch);
  const identities = input.pullRequests.map(p => p.repository + "#" + p.number);
  const inconsistent = !input.inventoryComplete || new Set(identities).size !== identities.length ||
    open.length > 1 || relevant.some(p => p.state === "open" && (p.merged || p.headBranch === input.baseBranch));
  let pr: Advice["pr"];
  if (inconsistent) pr = { action:"RECONCILE", reason:"incomplete_or_conflicting_inventory" };
  else if (open.length === 1) pr = { action:"REUSE", number:open[0].number, reason:"reuse_issue_pr" };
  else if (input.operation === "fix_existing_pr" || relevant.length)
    pr = { action:"RECONCILE", reason:"do_not_create_replacement_correction_pr" };
  else pr = { action:"NEW_CANDIDATE", reason:"new_issue_work_only" };

  const risk = input.riskEvidenceComplete ? evaluateRiskPolicy(input.riskSignals) : null;
  const gate: Advice["gate"] = !risk ? "ASSESSMENT_REQUIRED" :
    risk.executionBlocked ? "SECURITY_HOLD" : risk.humanApprovalRequired ? "HUMAN_REQUIRED" : "ADVISORY_ONLY";

  let review: Advice["review"] = "NOT_REVIEWED";
  const r = input.ai09;
  if (r) {
    if (r.reviewer !== "AI-09" || r.evidenceClass !== "AI_ASSERTED" ||
        r.githubApprovalSatisfied !== false || r.mergeAuthorized !== false ||
        !r.scope || !SHA.test(r.scope.baseSha) || !SHA.test(r.scope.headSha) ||
        !["NO_ACTIONABLE_FINDINGS","CHANGES_REQUESTED","INCONCLUSIVE","BLOCKED"].includes(r.status))
      review = "INCONCLUSIVE";
    else if (!input.comparison || r.scope.baseSha !== input.comparison.baseSha ||
             r.scope.headSha !== input.comparison.headSha) review = "STALE";
    else review = r.status === "NO_ACTIONABLE_FINDINGS" ? "CLEAR_ADVISORY" :
      r.status === "CHANGES_REQUESTED" ? "FINDINGS" : "INCONCLUSIVE";
  }
  return { executionAuthority:false, pr, risk, gate, review,
    unrelatedSafeWorkMayContinue:!input.globallyPaused };
}


/** Proposal for the already existing Mobile Autonomy workflow. No dispatch operation is performed here. */
export interface ChatActionsHandoffInput {
  source: "chat";
  command: string;
  goalId: string;
  messageId: string;
  ownerIdentityVerifiedByTrustedHost: boolean;
  githubActionsAvailable: boolean;
  existingNonCodexBuilderAvailable: boolean;
  codexFallback?: {
    exhaustedAlternatives: string[];
    necessityEvidenceRef: string;
    existingCodexAuthorizationVerified: boolean;
  };
}

export interface ChatActionsHandoffAdvice {
  executionAuthority: false;
  workflow: "Mobile Autonomy";
  preferredEntry: "CHAT";
  executionHost: "GITHUB_ACTIONS";
  status: "PROPOSE_ONLY" | "OWNER_PROOF_REQUIRED" | "APPROVAL_REQUIRED" | "SECURITY_HOLD" |
    "RECONCILE_PR" | "ACTIONS_UNAVAILABLE" | "CAPABILITY_UNAVAILABLE";
  codex: "NOT_SELECTED" | "EXCEPTION_CANDIDATE";
  dedupeKey: string;
  /** Trusted caller must recheck scope/authorization and dispatch; this function never does. */
  commandJson: string | null;
  reason: string;
}

/**
 * Pure Chat -> Actions handoff proposal: the Chat envelope is untrusted until
 * a separate authenticated GitHub adapter verifies owner identity and scope.
 * Codex is only an exception candidate, never automatically selected here.
 */
export function adviseChatActionsHandoff(input: ChatActionsHandoffInput, prAdvice: Advice): ChatActionsHandoffAdvice {
  if (!input || input.source !== "chat" || typeof input.command !== "string" ||
      !input.command.trim() || input.command.length > 12_000 ||
      typeof input.goalId !== "string" || !input.goalId.trim() || input.goalId.length > 200 ||
      typeof input.messageId !== "string" || !/^[A-Za-z0-9._:-]{1,150}$/.test(input.messageId) ||
      typeof input.ownerIdentityVerifiedByTrustedHost !== "boolean" ||
      typeof input.githubActionsAvailable !== "boolean" ||
      typeof input.existingNonCodexBuilderAvailable !== "boolean" ||
      !prAdvice || prAdvice.executionAuthority !== false ||
      (input.codexFallback && (
        !Array.isArray(input.codexFallback.exhaustedAlternatives) ||
        input.codexFallback.exhaustedAlternatives.some(x => typeof x !== "string" || !x.trim() || x.length > 150) ||
        typeof input.codexFallback.necessityEvidenceRef !== "string" ||
        typeof input.codexFallback.existingCodexAuthorizationVerified !== "boolean"
      ))) throw Error("invalid_chat_actions_handoff");

  const dedupeKey = "chat:" + input.messageId;
  const result = (status: ChatActionsHandoffAdvice["status"], reason: string,
    codex: ChatActionsHandoffAdvice["codex"] = "NOT_SELECTED"): ChatActionsHandoffAdvice => ({
    executionAuthority: false, workflow: "Mobile Autonomy", preferredEntry: "CHAT",
    executionHost: "GITHUB_ACTIONS", status, codex, dedupeKey, commandJson: null, reason,
  });

  if (!input.ownerIdentityVerifiedByTrustedHost) return result("OWNER_PROOF_REQUIRED", "trusted_owner_identity_missing");
  if (prAdvice.gate === "SECURITY_HOLD") return result("SECURITY_HOLD", "existing_security_hold");
  if (prAdvice.gate === "ASSESSMENT_REQUIRED" || prAdvice.gate === "HUMAN_REQUIRED") {
    return result("APPROVAL_REQUIRED", "risk_assessment_or_human_gate_pending");
  }
  if (prAdvice.pr.action === "RECONCILE") return result("RECONCILE_PR", "review_current_issue_pr_inventory");
  if (!input.githubActionsAvailable) return result("ACTIONS_UNAVAILABLE", "existing_actions_host_unavailable");
  if (!input.existingNonCodexBuilderAvailable) {
    const fallback = input.codexFallback;
    const exceptional = fallback && fallback.exhaustedAlternatives.length > 0 &&
      fallback.necessityEvidenceRef.trim() && fallback.existingCodexAuthorizationVerified;
    return result("CAPABILITY_UNAVAILABLE",
      exceptional ? "codex_exception_must_be_separately_dispatched_under_existing_authority" :
        "no_verified_non_codex_builder; investigate_without_auto_escalation",
      exceptional ? "EXCEPTION_CANDIDATE" : "NOT_SELECTED");
  }
  // Source identity in JSON is metadata, not proof of sender authentication or scope.
  const commandJson = JSON.stringify({source:"chat", command:input.command.trim(), goalId:input.goalId.trim()});
  return { ...result("PROPOSE_ONLY", "authenticated_adapter_must_verify_and_dispatch"), commandJson };
}
