import type { ImprovementCandidate } from "./types.ts";

export interface ImprovementDecision {
  accept: boolean;
  reason: string;
}

export function evaluateImprovement(
  candidate: ImprovementCandidate,
  minimumGain = 0.01,
): ImprovementDecision {
  if (candidate.benchmarkAfter === undefined) {
    return { accept: false, reason: "Candidate has not been benchmarked." };
  }

  const gain = candidate.benchmarkAfter - candidate.benchmarkBefore;
  if (gain < minimumGain) {
    return {
      accept: false,
      reason: `Held-out benchmark gain ${gain.toFixed(4)} is below required ${minimumGain.toFixed(4)}.`,
    };
  }

  return {
    accept: true,
    reason: `Held-out benchmark improved by ${gain.toFixed(4)}.`,
  };
}

export function finalizeCandidate(
  candidate: ImprovementCandidate,
  minimumGain = 0.01,
): ImprovementCandidate {
  const decision = evaluateImprovement(candidate, minimumGain);
  return { ...candidate, status: decision.accept ? "accepted" : "rejected" };
}
