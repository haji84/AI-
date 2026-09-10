import type { BenchmarkSummary } from "./benchmark.ts";
import type { LongHorizonSummary } from "./long-horizon-evaluation.ts";

export interface AgiGapInput {
  taskBenchmark: BenchmarkSummary;
  longHorizon: LongHorizonSummary;
  heldOutSelfImprovementGain: number | null;
  transferSuccessRate: number | null;
  worldModelCalibrationError: number | null;
  additionalApiCost: number;
}

export interface AgiGapReport {
  agiClaimAllowed: false;
  readinessScore: number;
  passedDimensions: string[];
  gaps: string[];
  conclusion: string;
}

export function buildAgiGapReport(input: AgiGapInput): AgiGapReport {
  const dimensions: Array<[string, boolean]> = [
    ["unknown-task success >= 80%", input.taskBenchmark.total >= 100 && input.taskBenchmark.successRate >= 0.8],
    ["human intervention < 10%", input.taskBenchmark.humanInterventionRate < 0.1],
    ["long-horizon verified completion >= 80%", input.longHorizon.totalSteps >= 10 && input.longHorizon.verifiedCompletionRate >= 0.8],
    ["positive held-out self-improvement", (input.heldOutSelfImprovementGain ?? 0) > 0],
    ["transfer success measured and >= 60%", input.transferSuccessRate !== null && input.transferSuccessRate >= 0.6],
    ["world-model calibration error <= 20%", input.worldModelCalibrationError !== null && input.worldModelCalibrationError <= 0.2],
    ["zero incremental paid API cost", input.additionalApiCost === 0],
  ];
  const passedDimensions = dimensions.filter(([, passed]) => passed).map(([name]) => name);
  const gaps = dimensions.filter(([, passed]) => !passed).map(([name]) => name);
  const readinessScore = dimensions.length ? passedDimensions.length / dimensions.length : 0;
  return {
    agiClaimAllowed: false,
    readinessScore,
    passedDimensions,
    gaps,
    conclusion: gaps.length === 0
      ? "All current project gates passed, but this is still an AGI candidate research milestone, not proof of AGI. External independent evaluation remains required."
      : `AGI is not demonstrated. ${gaps.length} project readiness dimensions remain below target.`,
  };
}
