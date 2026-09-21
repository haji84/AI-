export type ProductRollbackState =
  | "not-needed"
  | "blocked"
  | "awaiting-physical"
  | "ready-for-human-gate";

export interface ProductRollbackCandidate {
  component: string;
  deployedVersion: string;
  rollbackFromVersion: string;
  targetVersion: string;
  artifactSha256: string;
  artifactEvidence: string[];
  knownGoodEvidence: string[];
  compatibilityEvidence: string[];
  rollbackTestEvidence: string[];
  securityEvidence: string[];
  verificationEvidence: string[];
  dependsOn: string[];
  physicalEvidenceRequired: boolean;
  physicalEvidence: string[];
}

export interface ProductRollbackAssessment {
  component: string;
  state: ProductRollbackState;
  reasons: string[];
  deployedVersion: string;
  rollbackFromVersion: string;
  targetVersion: string;
}

export interface ProductRollbackPlan {
  state: ProductRollbackState;
  assessments: ProductRollbackAssessment[];
  /** Dependents are ordered before their dependencies for rollback. */
  executionOrder: string[];
  /**
   * This is a readiness/plan contract only. A separate Human Gate and an
   * explicitly authorized mutation path are required before any rollback.
   */
  applyAuthorized: false;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const stateRank: Record<ProductRollbackState, number> = {
  "not-needed": 0,
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

function uniqueNonBlank(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function assessCandidate(candidate: ProductRollbackCandidate): ProductRollbackAssessment {
  const reasons: string[] = [];
  const component = candidate.component.trim();
  const deployedVersion = candidate.deployedVersion.trim();
  const rollbackFromVersion = candidate.rollbackFromVersion.trim();
  const targetVersion = candidate.targetVersion.trim();

  if (!component) reasons.push("component_required");
  if (!deployedVersion) reasons.push("deployed_version_required");
  if (!rollbackFromVersion) reasons.push("rollback_from_version_required");
  if (!targetVersion) reasons.push("target_version_required");

  if (reasons.length === 0 && deployedVersion === targetVersion) {
    return {
      component,
      state: "not-needed",
      reasons: [],
      deployedVersion,
      rollbackFromVersion,
      targetVersion,
    };
  }

  if (deployedVersion && rollbackFromVersion && deployedVersion !== rollbackFromVersion) {
    reasons.push("source_version_mismatch");
  }
  if (deployedVersion && targetVersion && deployedVersion === targetVersion) {
    reasons.push("rollback_target_must_differ_from_deployed");
  }
  if (!SHA256.test(candidate.artifactSha256.trim())) reasons.push("verified_rollback_artifact_digest_required");
  if (!hasEvidence(candidate.artifactEvidence)) reasons.push("artifact_evidence_required");
  if (!hasEvidence(candidate.knownGoodEvidence)) reasons.push("known_good_evidence_required");
  if (!hasEvidence(candidate.compatibilityEvidence)) reasons.push("compatibility_evidence_required");
  if (!hasEvidence(candidate.rollbackTestEvidence)) reasons.push("rollback_test_evidence_required");
  if (!hasEvidence(candidate.securityEvidence)) reasons.push("security_evidence_required");
  if (!hasEvidence(candidate.verificationEvidence)) reasons.push("post_rollback_verification_evidence_required");

  if (reasons.length > 0) {
    return {
      component,
      state: "blocked",
      reasons,
      deployedVersion,
      rollbackFromVersion,
      targetVersion,
    };
  }

  if (candidate.physicalEvidenceRequired && !hasEvidence(candidate.physicalEvidence)) {
    return {
      component,
      state: "awaiting-physical",
      reasons: ["physical_evidence_required"],
      deployedVersion,
      rollbackFromVersion,
      targetVersion,
    };
  }

  return {
    component,
    state: "ready-for-human-gate",
    reasons: ["separate_human_gate_required_before_mutation"],
    deployedVersion,
    rollbackFromVersion,
    targetVersion,
  };
}

function addReason(assessment: ProductRollbackAssessment, reason: string): void {
  assessment.state = "blocked";
  if (!assessment.reasons.includes(reason)) assessment.reasons.push(reason);
}

function validateDependencies(
  candidates: ProductRollbackCandidate[],
  assessments: ProductRollbackAssessment[],
): string[] {
  const byComponent = new Map<string, ProductRollbackCandidate>();
  for (const candidate of candidates) {
    const component = candidate.component.trim();
    if (component) byComponent.set(component, candidate);
  }

  const assessmentByComponent = new Map(
    assessments.filter((entry) => entry.component).map((entry) => [entry.component, entry] as const),
  );

  for (const candidate of candidates) {
    const component = candidate.component.trim();
    if (!component) continue;
    const assessment = assessmentByComponent.get(component);
    if (!assessment) continue;

    const rawDependencies = candidate.dependsOn.map((value) => value.trim()).filter(Boolean);
    const dependencies = uniqueNonBlank(candidate.dependsOn);
    if (rawDependencies.length !== dependencies.length) addReason(assessment, "duplicate_dependency");
    for (const dependency of dependencies) {
      if (dependency === component) addReason(assessment, "self_dependency");
      else if (!byComponent.has(dependency)) addReason(assessment, `missing_dependency:${dependency}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  let cycle = false;

  const visit = (component: string, trail: string[]): void => {
    if (visited.has(component)) return;
    if (visiting.has(component)) {
      cycle = true;
      for (const member of trail.slice(trail.indexOf(component))) {
        const assessment = assessmentByComponent.get(member);
        if (assessment) addReason(assessment, "dependency_cycle");
      }
      const assessment = assessmentByComponent.get(component);
      if (assessment) addReason(assessment, "dependency_cycle");
      return;
    }

    visiting.add(component);
    const candidate = byComponent.get(component);
    if (candidate) {
      for (const dependency of uniqueNonBlank(candidate.dependsOn)) {
        if (byComponent.has(dependency)) visit(dependency, [...trail, component]);
      }
    }
    visiting.delete(component);
    visited.add(component);
    order.push(component);
  };

  for (const component of byComponent.keys()) visit(component, []);
  if (cycle) return [];

  // DFS places dependencies before dependents. Rollback must invert that order so
  // dependents are restored before the components they depend on.
  return order.reverse();
}

export function planProductRollback(candidates: ProductRollbackCandidate[]): ProductRollbackPlan {
  if (candidates.length === 0) {
    return {
      state: "blocked",
      assessments: [{
        component: "",
        state: "blocked",
        reasons: ["rollback_candidate_required"],
        deployedVersion: "",
        rollbackFromVersion: "",
        targetVersion: "",
      }],
      executionOrder: [],
      applyAuthorized: false,
    };
  }

  const assessments = candidates.map(assessCandidate);
  const counts = new Map<string, number>();
  for (const assessment of assessments) {
    if (!assessment.component) continue;
    counts.set(assessment.component, (counts.get(assessment.component) ?? 0) + 1);
  }
  for (const assessment of assessments) {
    if (assessment.component && (counts.get(assessment.component) ?? 0) > 1) {
      addReason(assessment, "duplicate_component");
    }
  }

  const executionOrder = validateDependencies(candidates, assessments);
  const state = assessments.reduce<ProductRollbackState>((worst, assessment) => (
    stateRank[assessment.state] > stateRank[worst] ? assessment.state : worst
  ), "not-needed");

  return {
    state,
    assessments,
    executionOrder: state === "blocked" ? [] : executionOrder,
    applyAuthorized: false,
  };
}
