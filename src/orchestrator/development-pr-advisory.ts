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
