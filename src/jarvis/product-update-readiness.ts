export type ProductUpdateState =
  | "up-to-date"
  | "blocked"
  | "awaiting-physical"
  | "ready-for-human-gate";

export interface ProductUpdateCandidate {
  component: string;
  currentVersion: string;
  candidateVersion: string;
  rollbackVersion: string;
  artifactSha256: string;
  artifactEvidence: string[];
  compatibilityEvidence: string[];
  testEvidence: string[];
  securityEvidence: string[];
  rollbackEvidence: string[];
  physicalEvidenceRequired: boolean;
  physicalEvidence: string[];
}

export interface ProductUpdateAssessment {
  component: string;
  state: ProductUpdateState;
  reasons: string[];
  currentVersion: string;
  candidateVersion: string;
  rollbackVersion: string;
}

export interface ProductUpdatePlan {
  state: ProductUpdateState;
  assessments: ProductUpdateAssessment[];
  /**
   * This contract is intentionally planning-only. Mutation authority is never
   * produced by CI/readiness evidence and must be handled by a separate gate.
   */
  applyAuthorized: false;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const stateRank: Record<ProductUpdateState, number> = {
  "up-to-date": 0,
  "ready-for-human-gate": 1,
  "awaiting-physical": 2,
  blocked: 3,
};

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function hasEvidence(values: string[]): boolean {
  return values.some((value) => nonBlank(value));
}

function assessCandidate(candidate: ProductUpdateCandidate): ProductUpdateAssessment {
  const reasons: string[] = [];
  const component = candidate.component.trim();
  const currentVersion = candidate.currentVersion.trim();
  const candidateVersion = candidate.candidateVersion.trim();
  const rollbackVersion = candidate.rollbackVersion.trim();

  if (!component) reasons.push("component_required");
  if (!currentVersion) reasons.push("current_version_required");
  if (!candidateVersion) reasons.push("candidate_version_required");

  if (reasons.length === 0 && currentVersion === candidateVersion) {
    return {
      component,
      state: "up-to-date",
      reasons: [],
      currentVersion,
      candidateVersion,
      rollbackVersion,
    };
  }

  if (!rollbackVersion) reasons.push("rollback_version_required");
  if (rollbackVersion && rollbackVersion === candidateVersion) reasons.push("rollback_must_not_equal_candidate");
  if (!SHA256.test(candidate.artifactSha256.trim())) reasons.push("verified_artifact_digest_required");
  if (!hasEvidence(candidate.artifactEvidence)) reasons.push("artifact_evidence_required");
  if (!hasEvidence(candidate.compatibilityEvidence)) reasons.push("compatibility_evidence_required");
  if (!hasEvidence(candidate.testEvidence)) reasons.push("test_evidence_required");
  if (!hasEvidence(candidate.securityEvidence)) reasons.push("security_evidence_required");
  if (!hasEvidence(candidate.rollbackEvidence)) reasons.push("rollback_evidence_required");

  if (reasons.length > 0) {
    return { component, state: "blocked", reasons, currentVersion, candidateVersion, rollbackVersion };
  }

  if (candidate.physicalEvidenceRequired && !hasEvidence(candidate.physicalEvidence)) {
    return {
      component,
      state: "awaiting-physical",
      reasons: ["physical_evidence_required"],
      currentVersion,
      candidateVersion,
      rollbackVersion,
    };
  }

  return {
    component,
    state: "ready-for-human-gate",
    reasons: ["separate_human_gate_required_before_mutation"],
    currentVersion,
    candidateVersion,
    rollbackVersion,
  };
}

export function planProductUpdate(candidates: ProductUpdateCandidate[]): ProductUpdatePlan {
  if (candidates.length === 0) {
    return {
      state: "blocked",
      assessments: [{
        component: "",
        state: "blocked",
        reasons: ["update_candidate_required"],
        currentVersion: "",
        candidateVersion: "",
        rollbackVersion: "",
      }],
      applyAuthorized: false,
    };
  }

  const assessments = candidates.map(assessCandidate);
  const counts = new Map<string, number>();
  for (const assessment of assessments) {
    const key = assessment.component;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const assessment of assessments) {
    if (assessment.component && (counts.get(assessment.component) ?? 0) > 1) {
      assessment.state = "blocked";
      if (!assessment.reasons.includes("duplicate_component")) assessment.reasons.push("duplicate_component");
    }
  }

  const state = assessments.reduce<ProductUpdateState>((worst, assessment) => (
    stateRank[assessment.state] > stateRank[worst] ? assessment.state : worst
  ), "up-to-date");

  return { state, assessments, applyAuthorized: false };
}
