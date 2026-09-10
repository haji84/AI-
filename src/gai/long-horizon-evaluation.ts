import type { BenchmarkSummary } from "./benchmark.ts";

export interface LongHorizonCheckpoint {
  step: number;
  completed: boolean;
  verified: boolean;
  humanInterventions: number;
  elapsedMs: number;
}

export interface LongHorizonSummary {
  totalSteps: number;
  completedSteps: number;
  verifiedCompletionRate: number;
  humanInterventionsPerStep: number;
  elapsedMs: number;
  longestVerifiedPrefix: number;
}

export interface ExternalBenchmarkAdapter {
  id: "arc-agi" | "swe-bench" | "osworld" | "memgym" | "custom";
  name: string;
  enabled: boolean;
  requiresExternalRuntime: boolean;
  notes: string;
}

export function summarizeLongHorizon(checkpoints: LongHorizonCheckpoint[]): LongHorizonSummary {
  const ordered = [...checkpoints].sort((a, b) => a.step - b.step);
  let prefix = 0;
  for (const checkpoint of ordered) {
    if (!checkpoint.completed || !checkpoint.verified || checkpoint.step !== prefix + 1) break;
    prefix += 1;
  }
  const completed = ordered.filter((item) => item.completed && item.verified).length;
  const total = ordered.length;
  return {
    totalSteps: total,
    completedSteps: completed,
    verifiedCompletionRate: total ? completed / total : 0,
    humanInterventionsPerStep: total ? ordered.reduce((sum, item) => sum + item.humanInterventions, 0) / total : 0,
    elapsedMs: ordered.reduce((sum, item) => sum + item.elapsedMs, 0),
    longestVerifiedPrefix: prefix,
  };
}

export function defaultExternalBenchmarkAdapters(): ExternalBenchmarkAdapter[] {
  return [
    { id: "arc-agi", name: "ARC-AGI", enabled: false, requiresExternalRuntime: true, notes: "Adapter contract ready; execution requires benchmark assets/runtime." },
    { id: "swe-bench", name: "SWE-bench", enabled: false, requiresExternalRuntime: true, notes: "Adapter contract ready; execution requires isolated repository environments." },
    { id: "osworld", name: "OSWorld", enabled: false, requiresExternalRuntime: true, notes: "Adapter contract ready; execution requires supported computer-use environment." },
    { id: "memgym", name: "MemGym", enabled: false, requiresExternalRuntime: true, notes: "Adapter contract ready; execution requires benchmark dataset/runtime." },
  ];
}

export function longHorizonTargetPasses(long: LongHorizonSummary, task: BenchmarkSummary): boolean {
  return long.totalSteps >= 10 && long.verifiedCompletionRate >= 0.8 && long.humanInterventionsPerStep < 0.1 && task.successRate >= 0.8;
}
