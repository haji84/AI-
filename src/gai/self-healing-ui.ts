export type UiLookupStrategy = "exact" | "accessibility" | "semantic" | "vision" | "alternate-path";
export type UiActionKind = "click" | "type" | "select" | "read" | "navigate";

export interface UiTargetIntent {
  role?: string;
  name: string;
  semanticPurpose: string;
}

export interface UiActionRequest {
  taskId: string;
  action: UiActionKind;
  target: UiTargetIntent;
  value?: string;
  humanGateRequired?: boolean;
  humanGateApproved?: boolean;
}

export interface UiCandidate {
  id: string;
  strategy: UiLookupStrategy;
  role?: string;
  name?: string;
  semanticPurpose: string;
  confidence: number;
  evidence?: Record<string, unknown>;
}

export interface UiExecutionEvidence {
  attempt: number;
  strategy: UiLookupStrategy;
  candidateId?: string;
  outcome: "not-found" | "rejected" | "executed" | "verified" | "verification-failed" | "blocked";
  detail?: string;
}

export interface UiDriver {
  find(request: UiActionRequest, strategy: UiLookupStrategy): Promise<UiCandidate[]>;
  execute(request: UiActionRequest, candidate: UiCandidate): Promise<{ ok: boolean; evidence?: Record<string, unknown> }>;
}

export interface UiOutcomeVerifier {
  verify(request: UiActionRequest, candidate: UiCandidate): Promise<{ ok: boolean; detail?: string; evidence?: Record<string, unknown> }>;
}

export interface SelfHealingUiResult {
  ok: boolean;
  blocked?: boolean;
  reason?: "human-gate" | "target-not-found" | "attempt-budget-exhausted" | "verification-failed";
  candidate?: UiCandidate;
  evidence: UiExecutionEvidence[];
}

const STRATEGIES: UiLookupStrategy[] = ["exact", "accessibility", "semantic", "vision", "alternate-path"];

function candidateMatchesIntent(request: UiActionRequest, candidate: UiCandidate): boolean {
  if (candidate.semanticPurpose.trim().toLowerCase() !== request.target.semanticPurpose.trim().toLowerCase()) return false;
  if (request.target.role && candidate.role && request.target.role.toLowerCase() !== candidate.role.toLowerCase()) return false;
  return candidate.confidence >= 0.5;
}

export class SelfHealingUiRuntime {
  constructor(
    private readonly driver: UiDriver,
    private readonly verifier: UiOutcomeVerifier,
    private readonly maxAttempts = 5,
  ) {}

  async run(request: UiActionRequest): Promise<SelfHealingUiResult> {
    const evidence: UiExecutionEvidence[] = [];
    if (request.humanGateRequired && !request.humanGateApproved) {
      evidence.push({ attempt: 0, strategy: "exact", outcome: "blocked", detail: "human gate approval required" });
      return { ok: false, blocked: true, reason: "human-gate", evidence };
    }

    let attempt = 0;
    let sawVerificationFailure = false;
    for (const strategy of STRATEGIES) {
      if (attempt >= this.maxAttempts) break;
      attempt += 1;
      const candidates = await this.driver.find(request, strategy);
      const candidate = candidates
        .filter((item) => candidateMatchesIntent(request, item))
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (!candidate) {
        evidence.push({ attempt, strategy, outcome: "not-found" });
        continue;
      }

      const execution = await this.driver.execute(request, candidate);
      if (!execution.ok) {
        evidence.push({ attempt, strategy, candidateId: candidate.id, outcome: "rejected", detail: "driver execution failed" });
        continue;
      }
      evidence.push({ attempt, strategy, candidateId: candidate.id, outcome: "executed" });

      const verification = await this.verifier.verify(request, candidate);
      if (verification.ok) {
        evidence.push({ attempt, strategy, candidateId: candidate.id, outcome: "verified", detail: verification.detail });
        return { ok: true, candidate, evidence };
      }
      sawVerificationFailure = true;
      evidence.push({ attempt, strategy, candidateId: candidate.id, outcome: "verification-failed", detail: verification.detail });
    }

    const exhausted = attempt >= this.maxAttempts;
    return {
      ok: false,
      reason: exhausted ? "attempt-budget-exhausted" : sawVerificationFailure ? "verification-failed" : "target-not-found",
      evidence,
    };
  }
}
