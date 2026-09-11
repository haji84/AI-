import {
  assessResearchProgram,
  evaluateAgiClaimGate,
  type ResearchEvidence,
  type ResearchStageAssessment,
} from "./research-ops-program.ts";

export interface DossierContradiction {
  id: string;
  description: string;
  severity: "low" | "medium" | "high";
  resolved: boolean;
}

export interface ResearchDossier {
  generatedAt: string;
  evidenceCount: number;
  verifiedEvidenceCount: number;
  assessments: ResearchStageAssessment[];
  contradictions: DossierContradiction[];
  unresolvedContradictions: number;
  independentExternalValidation: boolean;
  agiClaim: { allowed: boolean; reasons: string[] };
}

export function buildResearchDossier(input: {
  evidence: readonly ResearchEvidence[];
  contradictions?: readonly DossierContradiction[];
  independentExternalValidation: boolean;
  unresolvedSafetyRegression: boolean;
  additionalPaygApiCost: number;
  generatedAt?: string;
}): ResearchDossier {
  const assessments = assessResearchProgram(input.evidence);
  const contradictions = [...(input.contradictions ?? [])];
  const unresolvedContradictions = contradictions.filter((item) => !item.resolved).length;
  const gate = evaluateAgiClaimGate({
    assessments,
    independentExternalValidation: input.independentExternalValidation,
    unresolvedSafetyRegression: input.unresolvedSafetyRegression || contradictions.some((item) => !item.resolved && item.severity === "high"),
    additionalPaygApiCost: input.additionalPaygApiCost,
  });
  if (unresolvedContradictions > 0 && gate.allowed) {
    gate.allowed = false;
    gate.reasons.push("unresolved contradictory evidence remains in the dossier");
  }
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    evidenceCount: input.evidence.length,
    verifiedEvidenceCount: input.evidence.filter((item) => item.verified).length,
    assessments,
    contradictions,
    unresolvedContradictions,
    independentExternalValidation: input.independentExternalValidation,
    agiClaim: gate,
  };
}
