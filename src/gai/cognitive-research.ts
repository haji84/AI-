import { createHash } from "node:crypto";
import type { CognitiveLearningExperience, CognitiveLearningPartition } from "./cognitive-learning.ts";
import { validateCognitiveOperation, type CognitiveOperation } from "./cognitive-operation.ts";
import { decideExperiment, type ResearchExperiment, type ResearchHypothesis } from "./research-loop.ts";
import { evaluateCalibration } from "./world-model-calibration.ts";

type ExperimentInput = Parameters<typeof decideExperiment>[0];
export interface CognitiveResearchSummary {
  operation: CognitiveOperation;
  status: "INSUFFICIENT_EVIDENCE" | "INVALID_EVIDENCE" | "ACCEPTED" | "REJECTED";
  trainCount: number; evaluationCount: number;
  confidence?: number; baselineBrier?: number; candidateBrier?: number; experimentId?: string;
}
export interface CognitiveResearchReport extends CognitiveResearchSummary {
  hypothesis?: ResearchHypothesis; experimentInput?: ExperimentInput;
}
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const samePartition = (a: CognitiveLearningPartition, b: CognitiveLearningPartition) => a.tenantId === b.tenantId && a.principalId === b.principalId;

/** Fixed offline experiment. No IO, tools, external inference or authority promotion. */
export function evaluateCognitiveResearch(records: readonly CognitiveLearningExperience[], query: {
  partition: CognitiveLearningPartition; goalId: string; task: string; environment: string;
}): CognitiveResearchReport[] {
  if (!Array.isArray(records) || records.length > 2000) throw Error("Research experience bound exceeded");
  const trainingIds = new Set<string>(), trainingGoals = new Set<string>(), trainingEvidence = new Set<string>();
  for (const e of records.filter(e => samePartition(e.partition, query.partition) && e.split !== "heldout")) {
    trainingIds.add(e.id); trainingGoals.add(e.goalId); for (const ref of e.evidenceRefs) trainingEvidence.add(ref);
  }
  const matching: CognitiveLearningExperience[] = records.filter(e => samePartition(e.partition, query.partition) && e.goalId !== query.goalId &&
    normalize(e.task) === normalize(query.task) && e.environment === query.environment && e.learningOperation &&
    e.verified === true && e.externalCalls === 0 && e.source !== "external-expert");
  const operations = [...new Set(matching.map(e => validateCognitiveOperation(e.learningOperation)))];
  return operations.map(operation => {
    const group = matching.filter(e => e.learningOperation === operation);
    for (const e of group) {
      if ((e.split !== undefined && e.split !== "train" && e.split !== "heldout") || !Number.isFinite(e.prediction.confidence) || e.prediction.confidence < 0 || e.prediction.confidence > 1 ||
          typeof e.observation.success !== "boolean" || !Array.isArray(e.evidenceRefs) || !e.evidenceRefs.length ||
          e.evidenceRefs.some(ref => typeof ref !== "string" || !ref) || !Number.isSafeInteger(e.humanInterventions ?? 0) || (e.humanInterventions ?? 0) < 0) throw Error("Invalid research measurement/confidence");
    }
    const firstHeldout = group.findIndex(e => e.split === "heldout");
    // Candidate is frozen from the first four train outcomes preceding any evaluation.
    // Later train cannot tune it against already seen heldout outcomes.
    const train = group.slice(0, firstHeldout < 0 ? group.length : firstHeldout).filter(e => e.split !== "heldout").slice(0, 4);
    const heldout = group.filter(e => e.split === "heldout");
    const summary = { operation, trainCount: train.length, evaluationCount: heldout.length };
    if (train.length < 4 || heldout.length < 4) return { ...summary, status: "INSUFFICIENT_EVIDENCE" };
    // Any same-partition training use invalidates an evaluation identity, even if
    // outside this operation/task or the frozen four fitting observations.
    if (heldout.some(e => trainingIds.has(e.id) || trainingGoals.has(e.goalId) || e.evidenceRefs.some(ref => trainingEvidence.has(ref)))) return { ...summary, status: "INVALID_EVIDENCE" };
    const used = [...train, ...heldout], goals = new Set<string>(), ids = new Set<string>(), evidence = new Set<string>();
    for (const e of used) {
      if (goals.has(e.goalId) || ids.has(e.id) || e.evidenceRefs.some(ref => evidence.has(ref))) return { ...summary, status: "INVALID_EVIDENCE" };
      goals.add(e.goalId); ids.add(e.id); for (const ref of e.evidenceRefs) evidence.add(ref);
    }
    const confidence = (train.filter(e => e.observation.success).length + 1) / (train.length + 2);
    const rows = heldout.map(e => ({ id: e.id, confidence: e.prediction.confidence, occurred: e.observation.success }));
    const baselineBrier = evaluateCalibration(rows).brierScore;
    const candidateBrier = evaluateCalibration(rows.map(row => ({ ...row, confidence }))).brierScore;
    const sampleContract = (e: CognitiveLearningExperience) => [e.id, e.goalId, e.actionId, e.evidenceRefs, e.prediction.confidence, e.observation.success, e.humanInterventions ?? 0];
    const hypothesisId = `calibration:${digest(["laplace-first-four-v1", 0.01, [query.partition.tenantId, query.partition.principalId], normalize(query.task), query.environment, operation, train.map(sampleContract)])}`;
    const id = `calibration:${digest([hypothesisId, heldout.map(sampleContract)])}`;
    const interventionRate = heldout.filter(e => (e.humanInterventions ?? 0) > 0).length / heldout.length;
    const experimentInput: ExperimentInput = { id, hypothesisId, benchmarkBefore: 1 - baselineBrier,
      benchmarkAfter: 1 - candidateBrier, humanInterventionBefore: interventionRate, humanInterventionAfter: interventionRate,
      additionalApiCost: 0, safetyRegression: false, minimumGain: 0.01 };
    // Additional cost and intervention change are zero because only stored numbers are evaluated.
    // Accepted means lower prediction error on these observations, not better task execution.
    const decision = decideExperiment(experimentInput);
    return { ...summary, confidence, baselineBrier, candidateBrier, experimentId: id,
      status: decision.decision === "accepted" ? "ACCEPTED" : "REJECTED",
      hypothesis: { id: hypothesisId, bottleneck: "world-model", statement: "A fixed training-only Laplace estimate reduces independent outcome prediction error.", expectedGain: 0.01, evidenceCount: train.length, status: "proposed" },
      experimentInput };
  });
}
export function researchSummary(report: CognitiveResearchReport): CognitiveResearchSummary {
  const { hypothesis: _hypothesis, experimentInput: _experimentInput, ...summary } = report;
  void _hypothesis; void _experimentInput;
  return summary;
}
export function sameResearchMeasurement(saved: ResearchExperiment, input: ExperimentInput): boolean {
  return Object.entries(input).every(([key, value]) => saved[key as keyof ResearchExperiment] === value);
}
