import type { ResearchEvidence, ResearchStageId } from "./research-ops-program.ts";

export interface EvidenceBuildResult {
  accepted: boolean;
  reasons: string[];
  evidence: ResearchEvidence[];
}

const base = (stage: ResearchStageId, runId: string, source: string, collectedAt: string, metrics: Record<string, number | string | boolean>) => ({
  stage,
  verified: true,
  source,
  collectedAt,
  metrics,
} as const);

const reject = (...reasons: string[]): EvidenceBuildResult => ({ accepted: false, reasons, evidence: [] });
const accept = (evidence: ResearchEvidence[]): EvidenceBuildResult => ({ accepted: true, reasons: [], evidence });

export function buildR2ImprovementEvidence(input: {
  runId: string; source: string; collectedAt: string; heldoutBefore: number; heldoutAfter: number;
  humanInterventionBefore: number; humanInterventionAfter: number; safetyRegression: boolean; additionalApiCost: number;
}): EvidenceBuildResult {
  const gain = input.heldoutAfter - input.heldoutBefore;
  const reasons: string[] = [];
  if (gain < 0.01) reasons.push("heldout gain is below 0.01");
  if (input.humanInterventionAfter > input.humanInterventionBefore) reasons.push("human intervention regressed");
  if (input.safetyRegression) reasons.push("safety regression detected");
  if (input.additionalApiCost !== 0) reasons.push("additional pay-as-you-go API cost is non-zero");
  if (reasons.length) return reject(...reasons);
  const common = base("R2", input.runId, input.source, input.collectedAt, { heldoutBefore: input.heldoutBefore, heldoutAfter: input.heldoutAfter, gain, additionalApiCost: input.additionalApiCost });
  return accept([
    { ...common, id: `R2-heldout-${input.runId}`, kind: "heldout-evaluation" },
    { ...common, id: `R2-research-loop-${input.runId}`, kind: "research-loop" },
    { ...common, id: `R2-safety-${input.runId}`, kind: "safety-regression" },
    { ...common, id: `R2-cost-${input.runId}`, kind: "cost-regression" },
  ]);
}

export function buildR4LongHorizonEvidence(input: {
  runId: string; source: string; collectedAt: string; totalSteps: number; verifiedCompletionRate: number;
  humanInterventionsPerStep: number; safetyRegression: boolean;
}): EvidenceBuildResult {
  const reasons: string[] = [];
  if (input.totalSteps < 20) reasons.push("R4 requires at least 20 steps");
  if (!Number.isFinite(input.verifiedCompletionRate)) reasons.push("verified completion rate is invalid");
  if (!Number.isFinite(input.humanInterventionsPerStep)) reasons.push("human intervention rate is invalid");
  if (input.safetyRegression) reasons.push("safety regression detected");
  if (reasons.length) return reject(...reasons);
  const common = base("R4", input.runId, input.source, input.collectedAt, { totalSteps: input.totalSteps, verifiedCompletionRate: input.verifiedCompletionRate, humanInterventionsPerStep: input.humanInterventionsPerStep });
  return accept([
    { ...common, id: `R4-long-${input.runId}`, kind: "long-horizon" },
    { ...common, id: `R4-safety-${input.runId}`, kind: "safety-regression" },
  ]);
}

export function buildR6BenchmarkEvidence(input: {
  runId: string; source: string; collectedAt: string; runMode: string; total: number; heldoutTotal: number;
  successRate: number; heldoutSuccessRate: number; suiteSha256: string;
}): EvidenceBuildResult {
  const reasons: string[] = [];
  if (input.runMode !== "REAL_SELF_HOSTED_LOCAL_MODEL") reasons.push("R6 requires a real self-hosted local-model run");
  if (input.total < 100) reasons.push("R6 requires at least 100 cases");
  if (input.heldoutTotal <= 0) reasons.push("R6 requires heldout cases");
  if (!/^[a-f0-9]{64}$/i.test(input.suiteSha256)) reasons.push("suite SHA-256 is invalid");
  if (reasons.length) return reject(...reasons);
  const common = base("R6", input.runId, input.source, input.collectedAt, { total: input.total, heldoutTotal: input.heldoutTotal, successRate: input.successRate, heldoutSuccessRate: input.heldoutSuccessRate, suiteSha256: input.suiteSha256 });
  return accept([
    { ...common, id: `R6-baseline-${input.runId}`, kind: "internal-baseline" },
    { ...common, id: `R6-heldout-${input.runId}`, kind: "heldout-evaluation" },
  ]);
}

export function buildR7StatisticsEvidence(input: {
  runId: string; source: string; collectedAt: string; sampleSize: number; repeatRuns: number; confidenceIntervalWidth: number; pairedComparison: boolean;
}): EvidenceBuildResult {
  const reasons: string[] = [];
  if (input.sampleSize < 30) reasons.push("sample size below 30");
  if (input.repeatRuns < 2) reasons.push("at least two repeat runs are required");
  if (!input.pairedComparison) reasons.push("paired comparison was not performed");
  if (!Number.isFinite(input.confidenceIntervalWidth) || input.confidenceIntervalWidth < 0) reasons.push("confidence interval is invalid");
  if (reasons.length) return reject(...reasons);
  const common = base("R7", input.runId, input.source, input.collectedAt, { sampleSize: input.sampleSize, repeatRuns: input.repeatRuns, confidenceIntervalWidth: input.confidenceIntervalWidth, pairedComparison: input.pairedComparison });
  return accept([
    { ...common, id: `R7-heldout-${input.runId}`, kind: "heldout-evaluation" },
    { ...common, id: `R7-repro-${input.runId}`, kind: "reproducibility" },
  ]);
}

export function buildR8TransferEvidence(input: {
  runId: string; source: string; collectedAt: string; transferTasks: number; heldoutTasks: number; meanTransfer: number; negativeTransferRate: number;
}): EvidenceBuildResult {
  if (input.transferTasks <= 0 || input.heldoutTasks <= 0) return reject("R8 requires transfer and heldout tasks");
  const common = base("R8", input.runId, input.source, input.collectedAt, { transferTasks: input.transferTasks, heldoutTasks: input.heldoutTasks, meanTransfer: input.meanTransfer, negativeTransferRate: input.negativeTransferRate });
  return accept([
    { ...common, id: `R8-memory-${input.runId}`, kind: "memory-transfer" },
    { ...common, id: `R8-heldout-${input.runId}`, kind: "heldout-evaluation" },
  ]);
}

export function buildR9CalibrationEvidence(input: {
  runId: string; source: string; collectedAt: string; observations: number; brierScore: number; expectedCalibrationError: number; heldoutEvaluated: boolean;
}): EvidenceBuildResult {
  if (input.observations <= 0 || !input.heldoutEvaluated) return reject("R9 requires real observations and heldout evaluation");
  const common = base("R9", input.runId, input.source, input.collectedAt, { observations: input.observations, brierScore: input.brierScore, expectedCalibrationError: input.expectedCalibrationError });
  return accept([
    { ...common, id: `R9-calibration-${input.runId}`, kind: "world-model-calibration" },
    { ...common, id: `R9-heldout-${input.runId}`, kind: "heldout-evaluation" },
  ]);
}

export function buildR10RouterEvidence(input: {
  runId: string; source: string; collectedAt: string; evaluatedTasks: number; fallbackVerified: boolean; safetyRegression: boolean; additionalApiCost: number;
}): EvidenceBuildResult {
  const reasons: string[] = [];
  if (input.evaluatedTasks <= 0) reasons.push("no routing tasks evaluated");
  if (!input.fallbackVerified) reasons.push("fallback path was not verified");
  if (input.safetyRegression) reasons.push("safety regression detected");
  if (input.additionalApiCost !== 0) reasons.push("additional pay-as-you-go API cost is non-zero");
  if (reasons.length) return reject(...reasons);
  const common = base("R10", input.runId, input.source, input.collectedAt, { evaluatedTasks: input.evaluatedTasks, fallbackVerified: input.fallbackVerified, additionalApiCost: input.additionalApiCost });
  return accept([
    { ...common, id: `R10-router-${input.runId}`, kind: "planner-router" },
    { ...common, id: `R10-cost-${input.runId}`, kind: "cost-regression" },
    { ...common, id: `R10-safety-${input.runId}`, kind: "safety-regression" },
  ]);
}

export function buildR11RecoveryEvidence(input: {
  runId: string; source: string; collectedAt: string; injectedFailures: number; resumedFromCheckpoint: boolean; heldoutTasks: number; verifiedPrefixRetained: boolean;
}): EvidenceBuildResult {
  if (input.injectedFailures <= 0 || !input.resumedFromCheckpoint || input.heldoutTasks <= 0 || !input.verifiedPrefixRetained) return reject("R11 recovery campaign requirements were not all met");
  const common = base("R11", input.runId, input.source, input.collectedAt, { injectedFailures: input.injectedFailures, resumedFromCheckpoint: input.resumedFromCheckpoint, heldoutTasks: input.heldoutTasks, verifiedPrefixRetained: input.verifiedPrefixRetained });
  return accept([
    { ...common, id: `R11-long-${input.runId}`, kind: "long-horizon" },
    { ...common, id: `R11-heldout-${input.runId}`, kind: "heldout-evaluation" },
  ]);
}

export function buildR13CrossDeviceEvidence(input: {
  runId: string; source: string; collectedAt: string; commonTasks: number; outcomeAgreementRate: number; workerCount: number; resumeAfterWorkerLossVerified: boolean;
}): EvidenceBuildResult {
  if (input.commonTasks <= 0 || input.workerCount < 2 || !input.resumeAfterWorkerLossVerified) return reject("R13 requires common tasks on at least two workers and verified resume after worker loss");
  const common = base("R13", input.runId, input.source, input.collectedAt, { commonTasks: input.commonTasks, outcomeAgreementRate: input.outcomeAgreementRate, workerCount: input.workerCount, resumeAfterWorkerLossVerified: input.resumeAfterWorkerLossVerified });
  return accept([
    { ...common, id: `R13-device-${input.runId}`, kind: "cross-device" },
    { ...common, id: `R13-repro-${input.runId}`, kind: "reproducibility" },
  ]);
}

export function buildR14ContinualEvidence(input: {
  runId: string; source: string; collectedAt: string; commonTasks: number; forwardTransfer: number; backwardTransfer: number; forgetting: number;
}): EvidenceBuildResult {
  if (input.commonTasks <= 0) return reject("R14 requires common tasks across sequential campaigns");
  const common = base("R14", input.runId, input.source, input.collectedAt, { commonTasks: input.commonTasks, forwardTransfer: input.forwardTransfer, backwardTransfer: input.backwardTransfer, forgetting: input.forgetting });
  return accept([
    { ...common, id: `R14-continual-${input.runId}`, kind: "continual-learning" },
    { ...common, id: `R14-transfer-${input.runId}`, kind: "memory-transfer" },
  ]);
}

export function buildR15CurriculumEvidence(input: {
  runId: string; source: string; collectedAt: string; generatedTasks: number; heldoutLeakageCount: number; heldoutBefore: number; heldoutAfter: number;
}): EvidenceBuildResult {
  if (input.generatedTasks <= 0) return reject("R15 requires generated curriculum tasks");
  if (input.heldoutLeakageCount !== 0) return reject("heldout leakage detected");
  const common = base("R15", input.runId, input.source, input.collectedAt, { generatedTasks: input.generatedTasks, heldoutLeakageCount: input.heldoutLeakageCount, heldoutBefore: input.heldoutBefore, heldoutAfter: input.heldoutAfter });
  return accept([
    { ...common, id: `R15-curriculum-${input.runId}`, kind: "adversarial-curriculum" },
    { ...common, id: `R15-heldout-${input.runId}`, kind: "heldout-evaluation" },
  ]);
}

export function buildR16ResearchLoopEvidence(input: {
  runId: string; source: string; collectedAt: string; hypothesesTested: number; accepted: number; rejected: number; reproducible: boolean;
}): EvidenceBuildResult {
  if (input.hypothesesTested <= 0 || input.accepted + input.rejected !== input.hypothesesTested || !input.reproducible) return reject("R16 requires reproducible accepted/rejected hypothesis cycles");
  const common = base("R16", input.runId, input.source, input.collectedAt, { hypothesesTested: input.hypothesesTested, accepted: input.accepted, rejected: input.rejected, reproducible: input.reproducible });
  return accept([
    { ...common, id: `R16-loop-${input.runId}`, kind: "research-loop" },
    { ...common, id: `R16-repro-${input.runId}`, kind: "reproducibility" },
  ]);
}

export function buildR17SelfModificationEvidence(input: {
  runId: string; source: string; collectedAt: string; heldoutBefore: number; heldoutAfter: number; rollbackVerified: boolean; safetyRegression: boolean; humanApproved: boolean;
}): EvidenceBuildResult {
  const reasons: string[] = [];
  if (!input.humanApproved) reasons.push("R17 requires explicit human approval for governed self-modification evidence");
  if (!input.rollbackVerified) reasons.push("rollback was not verified");
  if (input.safetyRegression) reasons.push("safety regression detected");
  if (input.heldoutAfter <= input.heldoutBefore) reasons.push("heldout did not improve");
  if (reasons.length) return reject(...reasons);
  const common = base("R17", input.runId, input.source, input.collectedAt, { heldoutBefore: input.heldoutBefore, heldoutAfter: input.heldoutAfter, rollbackVerified: input.rollbackVerified, humanApproved: input.humanApproved });
  return accept([
    { ...common, id: `R17-selfmod-${input.runId}`, kind: "self-modification" },
    { ...common, id: `R17-safety-${input.runId}`, kind: "safety-regression" },
    { ...common, id: `R17-heldout-${input.runId}`, kind: "heldout-evaluation" },
  ]);
}

export function buildR18AdaptationEvidence(input: {
  runId: string; source: string; collectedAt: string; accepted: boolean; heldoutBefore: number; heldoutAfter: number; forgetting: number; additionalApiCost: number;
}): EvidenceBuildResult {
  if (!input.accepted) return reject("model adaptation candidate was not accepted by the adaptation gate");
  if (input.additionalApiCost !== 0) return reject("additional pay-as-you-go API cost is non-zero");
  const common = base("R18", input.runId, input.source, input.collectedAt, { heldoutBefore: input.heldoutBefore, heldoutAfter: input.heldoutAfter, forgetting: input.forgetting, additionalApiCost: input.additionalApiCost });
  return accept([
    { ...common, id: `R18-adapt-${input.runId}`, kind: "model-adaptation" },
    { ...common, id: `R18-cost-${input.runId}`, kind: "cost-regression" },
    { ...common, id: `R18-heldout-${input.runId}`, kind: "heldout-evaluation" },
  ]);
}
