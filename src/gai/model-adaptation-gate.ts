export interface ModelAdaptationCandidate {
  id: string;
  method: "lora" | "qlora" | "distillation" | "specialist-model";
  baselineHeldout: number;
  adaptedHeldout: number;
  forgetting: number;
  safetyRegression: boolean;
  additionalPaygApiCost: number;
  benchmarkJustifiedBottleneck: boolean;
}

export interface ModelAdaptationDecision {
  accept: boolean;
  gain: number;
  reasons: string[];
}

export function evaluateModelAdaptation(
  candidate: ModelAdaptationCandidate,
  minimumGain = 0.01,
  maximumForgetting = 0.01,
): ModelAdaptationDecision {
  const gain = candidate.adaptedHeldout - candidate.baselineHeldout;
  const reasons: string[] = [];
  if (!candidate.benchmarkJustifiedBottleneck) reasons.push("model adaptation was not justified by a measured model bottleneck");
  if (gain < minimumGain) reasons.push(`heldout gain ${gain.toFixed(4)} is below required ${minimumGain.toFixed(4)}`);
  if (candidate.forgetting > maximumForgetting) reasons.push(`forgetting ${candidate.forgetting.toFixed(4)} exceeds maximum ${maximumForgetting.toFixed(4)}`);
  if (candidate.safetyRegression) reasons.push("safety regression detected");
  if (candidate.additionalPaygApiCost > 0) reasons.push("additional pay-as-you-go API cost is non-zero");
  return { accept: reasons.length === 0, gain, reasons };
}
