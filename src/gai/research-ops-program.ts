export type ResearchStageId =
  | "R1" | "R2" | "R3" | "R4" | "R5"
  | "R6" | "R7" | "R8" | "R9" | "R10"
  | "R11" | "R12" | "R13" | "R14" | "R15"
  | "R16" | "R17" | "R18" | "R19" | "R20";

export type EvidenceKind =
  | "internal-baseline"
  | "heldout-evaluation"
  | "external-benchmark"
  | "long-horizon"
  | "memory-transfer"
  | "world-model-calibration"
  | "planner-router"
  | "cross-device"
  | "continual-learning"
  | "adversarial-curriculum"
  | "research-loop"
  | "self-modification"
  | "model-adaptation"
  | "independent-replication"
  | "safety-regression"
  | "cost-regression"
  | "reproducibility"
  | "agi-gap-review";

export interface ResearchEvidence {
  id: string;
  stage: ResearchStageId;
  kind: EvidenceKind;
  verified: boolean;
  source: string;
  collectedAt: string;
  metrics?: Record<string, number | string | boolean>;
  notes?: string;
}

export interface ResearchStageDefinition {
  id: ResearchStageId;
  title: string;
  dependencies: ResearchStageId[];
  requiredEvidence: EvidenceKind[];
  objective: string;
  exitCriteria: string[];
  externalValidationRequired?: boolean;
}

export interface ResearchStageAssessment {
  stage: ResearchStageId;
  status: "blocked" | "ready" | "complete";
  missingDependencies: ResearchStageId[];
  missingEvidence: EvidenceKind[];
  verifiedEvidenceIds: string[];
}

const stage = (
  id: ResearchStageId,
  title: string,
  dependencies: ResearchStageId[],
  requiredEvidence: EvidenceKind[],
  objective: string,
  exitCriteria: string[],
  externalValidationRequired = false,
): ResearchStageDefinition => ({
  id,
  title,
  dependencies,
  requiredEvidence,
  objective,
  exitCriteria,
  externalValidationRequired,
});

export const RESEARCH_STAGES: readonly ResearchStageDefinition[] = [
  stage("R1", "Benchmark Suite v1 and real baseline", [], ["internal-baseline", "heldout-evaluation", "safety-regression", "cost-regression"], "Establish the first reproducible real-model baseline.", [">=100 real cases", "train/heldout isolation", "failure taxonomy", "AGI-gap snapshot", "additional pay-as-you-go API cost = 0"]),
  stage("R2", "Evidence-driven iterative improvement", ["R1"], ["heldout-evaluation", "research-loop", "safety-regression", "cost-regression"], "Improve measured capability without training on heldout outcomes.", ["candidate changes evaluated on heldout", "positive accepted gain", "no safety regression", "no cost regression"]),
  stage("R3", "Real external benchmark campaign", ["R1"], ["external-benchmark", "reproducibility"], "Measure capability on real external benchmarks.", ["real harness execution", "version/model/runtime provenance", "no inferred external scores"], true),
  stage("R4", "Long-horizon autonomous endurance", ["R1"], ["long-horizon", "safety-regression"], "Measure multi-step autonomy, recovery and memory continuity.", [">=20-step tasks", "restart/resume", "tool-failure recovery", "human intervention accounting"]),
  stage("R5", "Independent AGI-gap review", ["R2", "R3", "R4"], ["agi-gap-review", "reproducibility"], "Produce an evidence-based independent capability gap review.", ["strengths/weaknesses", "sample-size caveats", "ranked next experiments", "no automatic AGI claim"], true),
  stage("R6", "Benchmark Suite v1.1 hardening", ["R1"], ["internal-baseline", "heldout-evaluation"], "Harden the internal suite against formatting artifacts, leakage and narrow synthetic repetition.", ["diverse task families", "contamination guard", "stable verifier normalization", "frozen suite hash"]),
  stage("R7", "Statistical evaluation and uncertainty", ["R6"], ["heldout-evaluation", "reproducibility"], "Add uncertainty, repeatability and significance checks to comparisons.", ["confidence intervals", "paired comparison", "minimum sample-size warnings", "repeat-run variance"]),
  stage("R8", "Memory and transfer campaign", ["R2", "R6"], ["memory-transfer", "heldout-evaluation"], "Measure reusable memory, abstraction and transfer without heldout leakage.", ["episodic-to-semantic promotion measured", "cross-task transfer measured", "negative transfer tracked", "heldout isolated"]),
  stage("R9", "World-model calibration campaign", ["R2", "R6"], ["world-model-calibration", "heldout-evaluation"], "Measure prediction quality and prediction-error learning.", ["calibration error", "confidence buckets", "prediction-error trend", "heldout gain"]),
  stage("R10", "Planner and model-router optimization", ["R7", "R8", "R9"], ["planner-router", "cost-regression", "safety-regression"], "Optimize planning, tool choice and model tier routing under zero-additional-cost policy.", ["quality/cost frontier", "fallback verified", "no pay-as-you-go route", "safety gates preserved"]),
  stage("R11", "Long-horizon recovery v2", ["R4", "R10"], ["long-horizon", "heldout-evaluation"], "Stress recovery, checkpoints, strategy pivots and partial-progress preservation.", ["failure injection", "checkpoint resume", "bounded retry budgets", "verified-prefix retention"]),
  stage("R12", "Interactive environment generalization", ["R3", "R11"], ["external-benchmark", "long-horizon"], "Evaluate interactive agent behavior in compatible computer-use or environment benchmarks.", ["stateful interaction", "environment reset", "provenance", "no fabricated score"], true),
  stage("R13", "Cross-device distributed research workers", ["R10"], ["cross-device", "reproducibility"], "Use heterogeneous workers without changing scientific conclusions.", ["same-case cross-device subset", "worker provenance", "resume after worker loss", "result equivalence checks"]),
  stage("R14", "Continual learning and forgetting", ["R8", "R13"], ["continual-learning", "memory-transfer"], "Measure learning across campaigns while detecting catastrophic forgetting.", ["forward transfer", "backward transfer", "forgetting score", "promotion/rollback policy"]),
  stage("R15", "Adversarial curriculum generation", ["R7", "R14"], ["adversarial-curriculum", "heldout-evaluation"], "Generate harder tasks from verified failure clusters without contaminating heldout evaluation.", ["failure-driven curriculum", "difficulty progression", "deduplication", "heldout firewall"]),
  stage("R16", "Autonomous research scientist loop", ["R10", "R15"], ["research-loop", "reproducibility"], "Let the system propose, run and evaluate bounded research hypotheses.", ["hypothesis provenance", "sandbox experiment", "automatic accept/reject", "failed hypotheses retained"]),
  stage("R17", "Governed self-modification", ["R16"], ["self-modification", "safety-regression", "heldout-evaluation"], "Permit bounded self-modification only when verified evaluation improves.", ["sandbox-only mutation", "diff provenance", "heldout improvement", "rollback", "HIGH/CRITICAL Human Gate"]),
  stage("R18", "Local model adaptation lab", ["R14", "R17"], ["model-adaptation", "cost-regression", "heldout-evaluation"], "Evaluate low-cost local adaptation only when architecture evidence identifies a model bottleneck.", ["baseline before adaptation", "LoRA/QLoRA/distillation candidate", "heldout comparison", "forgetting check", "zero pay-as-you-go cost"]),
  stage("R19", "Independent replication package", ["R5", "R12", "R18"], ["independent-replication", "reproducibility", "external-benchmark"], "Prepare evidence so another environment can reproduce material claims.", ["frozen manifests", "raw result provenance", "environment capture", "replication delta report"], true),
  stage("R20", "AGI evidence dossier and gate review", ["R19"], ["agi-gap-review", "independent-replication", "safety-regression", "cost-regression", "reproducibility"], "Assemble the strongest evidence dossier while preventing unsupported AGI claims.", ["all project gates evaluated", "contradictory evidence included", "independent validation status explicit", "AGI claim remains false unless external scientific validation exists"], true),
] as const;

const byId = new Map(RESEARCH_STAGES.map((item) => [item.id, item]));

export function getResearchStage(id: ResearchStageId): ResearchStageDefinition {
  const found = byId.get(id);
  if (!found) throw new Error(`Unknown research stage: ${id}`);
  return found;
}

export function assessResearchStage(
  id: ResearchStageId,
  completedStages: ReadonlySet<ResearchStageId>,
  evidence: readonly ResearchEvidence[],
): ResearchStageAssessment {
  const definition = getResearchStage(id);
  const missingDependencies = definition.dependencies.filter((dep) => !completedStages.has(dep));
  const verifiedForStage = evidence.filter((item) => item.stage === id && item.verified);
  const verifiedKinds = new Set(verifiedForStage.map((item) => item.kind));
  const missingEvidence = definition.requiredEvidence.filter((kind) => !verifiedKinds.has(kind));
  const status = missingDependencies.length > 0
    ? "blocked"
    : missingEvidence.length > 0
      ? "ready"
      : "complete";

  return {
    stage: id,
    status,
    missingDependencies,
    missingEvidence,
    verifiedEvidenceIds: verifiedForStage.map((item) => item.id),
  };
}

export function assessResearchProgram(evidence: readonly ResearchEvidence[]): ResearchStageAssessment[] {
  const completed = new Set<ResearchStageId>();
  const assessments: ResearchStageAssessment[] = [];
  for (const definition of RESEARCH_STAGES) {
    const assessment = assessResearchStage(definition.id, completed, evidence);
    assessments.push(assessment);
    if (assessment.status === "complete") completed.add(definition.id);
  }
  return assessments;
}

export function nextExecutableResearchStages(evidence: readonly ResearchEvidence[]): ResearchStageId[] {
  return assessResearchProgram(evidence)
    .filter((item) => item.status === "ready")
    .map((item) => item.stage);
}

export interface AgiClaimGateInput {
  assessments: readonly ResearchStageAssessment[];
  independentExternalValidation: boolean;
  unresolvedSafetyRegression: boolean;
  additionalPaygApiCost: number;
}

export interface AgiClaimGateDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateAgiClaimGate(input: AgiClaimGateInput): AgiClaimGateDecision {
  const reasons: string[] = [];
  const r20 = input.assessments.find((item) => item.stage === "R20");
  if (!r20 || r20.status !== "complete") reasons.push("R20 evidence dossier is incomplete");
  if (!input.independentExternalValidation) reasons.push("independent external scientific validation is missing");
  if (input.unresolvedSafetyRegression) reasons.push("an unresolved safety regression exists");
  if (input.additionalPaygApiCost > 0) reasons.push("zero-additional-pay-as-you-go-cost policy was violated");
  return { allowed: reasons.length === 0, reasons };
}
