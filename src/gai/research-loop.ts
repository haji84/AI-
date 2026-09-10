import type { BenchmarkOutcomeRecord } from "./benchmark-history.ts";

export type ResearchBottleneck = "memory" | "planner" | "world_model" | "skill" | "tooling" | "model_reasoning";

export interface ResearchHypothesis {
  id: string;
  bottleneck: ResearchBottleneck;
  evidenceTaskIds: string[];
  failureCount: number;
  statement: string;
  expectedGain: number;
}

export interface ImprovementCandidate {
  id: string;
  hypothesisId: string;
  scope: ResearchBottleneck;
  description: string;
  reversible: true;
  changesGovernance: false;
  additionalApiCost: 0;
}

export interface CandidateEvaluation {
  candidateId: string;
  baselineSuccessRate: number;
  candidateSuccessRate: number;
  baselineInterventions: number;
  candidateInterventions: number;
  additionalApiCost: number;
  safetyRegression: boolean;
}

export interface CandidateDecision {
  accepted: boolean;
  reason: "meaningful_improvement" | "insufficient_gain" | "safety_regression" | "cost_regression" | "intervention_regression";
  gain: number;
}

export interface ResearchLoopPolicy {
  minFailureClusterSize: number;
  minHeldoutGain: number;
}

export const DEFAULT_RESEARCH_LOOP_POLICY: ResearchLoopPolicy = {
  minFailureClusterSize: 2,
  minHeldoutGain: 0.05,
};

export class BoundedResearchLoop {
  private readonly policy: ResearchLoopPolicy;

  constructor(policy: Partial<ResearchLoopPolicy> = {}) {
    this.policy = { ...DEFAULT_RESEARCH_LOOP_POLICY, ...policy };
  }

  generateHypotheses(records: BenchmarkOutcomeRecord[]): ResearchHypothesis[] {
    const failures = records.filter((record) => record.split === "train" && record.verified && !record.passed);
    const clusters = new Map<ResearchBottleneck, BenchmarkOutcomeRecord[]>();
    for (const failure of failures) {
      const bottleneck = classifyFailure(failure);
      const list = clusters.get(bottleneck) ?? [];
      list.push(failure);
      clusters.set(bottleneck, list);
    }

    return [...clusters.entries()]
      .filter(([, items]) => items.length >= this.policy.minFailureClusterSize)
      .map(([bottleneck, items]) => ({
        id: `hypothesis:${bottleneck}:${items.map((item) => item.taskId).sort().join(",")}`,
        bottleneck,
        evidenceTaskIds: [...new Set(items.map((item) => item.taskId))].sort(),
        failureCount: items.length,
        statement: hypothesisStatement(bottleneck),
        expectedGain: Math.min(0.25, 0.05 * items.length),
      }));
  }

  proposeCandidate(hypothesis: ResearchHypothesis): ImprovementCandidate {
    return {
      id: `candidate:${hypothesis.id}`,
      hypothesisId: hypothesis.id,
      scope: hypothesis.bottleneck,
      description: candidateDescription(hypothesis.bottleneck),
      reversible: true,
      changesGovernance: false,
      additionalApiCost: 0,
    };
  }

  evaluateHeldout(evaluation: CandidateEvaluation): CandidateDecision {
    const gain = evaluation.candidateSuccessRate - evaluation.baselineSuccessRate;
    if (evaluation.safetyRegression) return { accepted: false, reason: "safety_regression", gain };
    if (evaluation.additionalApiCost !== 0) return { accepted: false, reason: "cost_regression", gain };
    if (evaluation.candidateInterventions > evaluation.baselineInterventions) {
      return { accepted: false, reason: "intervention_regression", gain };
    }
    if (gain < this.policy.minHeldoutGain) return { accepted: false, reason: "insufficient_gain", gain };
    return { accepted: true, reason: "meaningful_improvement", gain };
  }
}

function classifyFailure(record: BenchmarkOutcomeRecord): ResearchBottleneck {
  const marker = `${record.actionId} ${record.selectedSkillId ?? ""}`.toLowerCase();
  if (marker.includes("memory") || marker.includes("recall")) return "memory";
  if (marker.includes("world") || marker.includes("predict")) return "world_model";
  if (marker.includes("skill") || record.selectedSkillId) return "skill";
  if (marker.includes("tool") || marker.includes("adapter")) return "tooling";
  if (marker.includes("model") || marker.includes("reason")) return "model_reasoning";
  return "planner";
}

function hypothesisStatement(bottleneck: ResearchBottleneck): string {
  return `Repeated ${bottleneck} failures may be reduced by a bounded, reversible ${bottleneck} improvement evaluated only on held-out benchmarks.`;
}

function candidateDescription(bottleneck: ResearchBottleneck): string {
  return `Sandbox a minimal ${bottleneck} change; do not alter governance, permissions, secrets, billing, deployment, or safety policy; accept only after held-out improvement.`;
}
