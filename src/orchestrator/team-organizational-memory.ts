import type { CapabilityAssignment, CapabilityTeamPlan } from "./dynamic-capability-team.ts";
import type { Goal } from "./goal-loop.ts";

export type TeamLifecycle = "experimental" | "reusable" | "standing_candidate" | "demoted";

export interface TeamOutcome {
  ok: boolean;
  verified: boolean;
  score?: number;
  summary?: string;
}

export interface TeamBlueprint {
  id: string;
  name: string;
  goalTerms: string[];
  assignments: CapabilityAssignment[];
  parentId?: string;
  generation: number;
  uses: number;
  successes: number;
  verifiedSuccesses: number;
  failures: number;
  scoreTotal: number;
  lifecycle: TeamLifecycle;
}

export interface TeamRecallCandidate {
  blueprint: TeamBlueprint;
  similarity: number;
  performance: number;
  rankScore: number;
  missingCapabilities: string[];
  recallable: boolean;
}

export interface PromotionPolicy {
  minimumUses: number;
  minimumVerifiedSuccesses: number;
  minimumSuccessRate: number;
}

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  minimumUses: 3,
  minimumVerifiedSuccesses: 3,
  minimumSuccessRate: 0.8,
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalize).filter(Boolean))].sort();
}

export function goalTerms(goal: Goal): string[] {
  return unique([goal.title, goal.description ?? "", ...goal.successCriteria]
    .flatMap((value) => value.split(/[^\p{L}\p{N}_.-]+/u)));
}

export function createTeamBlueprint(input: {
  id: string;
  name: string;
  goal: Goal;
  team: CapabilityTeamPlan;
}): TeamBlueprint {
  if (input.team.blocked) throw new Error("cannot persist a blocked team as a reusable blueprint");
  return {
    id: input.id,
    name: input.name,
    goalTerms: goalTerms(input.goal),
    assignments: input.team.assignments.map((assignment) => ({ ...assignment })),
    generation: 1,
    uses: 0,
    successes: 0,
    verifiedSuccesses: 0,
    failures: 0,
    scoreTotal: 0,
    lifecycle: "experimental",
  };
}

export function recordTeamOutcome(
  blueprint: TeamBlueprint,
  outcome: TeamOutcome,
  policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY,
): TeamBlueprint {
  const uses = blueprint.uses + 1;
  const successes = blueprint.successes + (outcome.ok ? 1 : 0);
  const verifiedSuccesses = blueprint.verifiedSuccesses + (outcome.ok && outcome.verified ? 1 : 0);
  const failures = blueprint.failures + (outcome.ok ? 0 : 1);
  const score = Math.max(0, Math.min(1, outcome.score ?? (outcome.ok && outcome.verified ? 1 : outcome.ok ? 0.7 : 0)));
  const successRate = successes / uses;

  let lifecycle: TeamLifecycle = blueprint.lifecycle;
  if (uses >= policy.minimumUses && verifiedSuccesses >= policy.minimumVerifiedSuccesses && successRate >= policy.minimumSuccessRate) {
    lifecycle = "standing_candidate";
  } else if (uses >= 3 && successRate < 0.5) {
    lifecycle = "demoted";
  } else if (verifiedSuccesses > 0) {
    lifecycle = "reusable";
  }

  return { ...blueprint, uses, successes, verifiedSuccesses, failures, scoreTotal: blueprint.scoreTotal + score, lifecycle };
}

function similarity(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const intersection = [...left].filter((term) => right.has(term)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function performance(blueprint: TeamBlueprint): number {
  if (blueprint.uses === 0) return 0;
  const successRate = blueprint.successes / blueprint.uses;
  const verificationRate = blueprint.verifiedSuccesses / blueprint.uses;
  const averageScore = blueprint.scoreTotal / blueprint.uses;
  return (successRate * 0.4) + (verificationRate * 0.4) + (averageScore * 0.2);
}

export function rankTeamBlueprints(input: {
  goal: Goal;
  blueprints: TeamBlueprint[];
  availableCapabilities: string[];
}): TeamRecallCandidate[] {
  const targetTerms = goalTerms(input.goal);
  const available = new Set(input.availableCapabilities.map(normalize));
  return input.blueprints.map((blueprint) => {
    const missingCapabilities = unique(blueprint.assignments
      .map((assignment) => assignment.capability)
      .filter((capability) => !available.has(normalize(capability))));
    const sim = similarity(targetTerms, blueprint.goalTerms);
    const perf = performance(blueprint);
    const lifecyclePenalty = blueprint.lifecycle === "demoted" ? 0.25 : 0;
    return {
      blueprint,
      similarity: sim,
      performance: perf,
      rankScore: (sim * 0.6) + (perf * 0.4) - lifecyclePenalty,
      missingCapabilities,
      recallable: missingCapabilities.length === 0 && blueprint.lifecycle !== "demoted",
    };
  }).sort((a, b) => b.rankScore - a.rankScore || a.blueprint.id.localeCompare(b.blueprint.id));
}

export function recallBestTeam(input: {
  goal: Goal;
  blueprints: TeamBlueprint[];
  availableCapabilities: string[];
  minimumSimilarity?: number;
}): TeamBlueprint | null {
  return rankTeamBlueprints(input).find((candidate) =>
    candidate.recallable && candidate.similarity >= (input.minimumSimilarity ?? 0.15))?.blueprint ?? null;
}

export function deriveTeamBlueprint(input: {
  parent: TeamBlueprint;
  id: string;
  name?: string;
  goal: Goal;
  replaceAssignments?: CapabilityAssignment[];
}): TeamBlueprint {
  return {
    ...input.parent,
    id: input.id,
    name: input.name ?? input.parent.name,
    goalTerms: goalTerms(input.goal),
    assignments: (input.replaceAssignments ?? input.parent.assignments).map((assignment) => ({ ...assignment })),
    parentId: input.parent.id,
    generation: input.parent.generation + 1,
    uses: 0,
    successes: 0,
    verifiedSuccesses: 0,
    failures: 0,
    scoreTotal: 0,
    lifecycle: "experimental",
  };
}

export class TeamMemory {
  private readonly blueprints = new Map<string, TeamBlueprint>();

  save(blueprint: TeamBlueprint): void {
    this.blueprints.set(blueprint.id, structuredClone(blueprint));
  }

  get(id: string): TeamBlueprint | null {
    const blueprint = this.blueprints.get(id);
    return blueprint ? structuredClone(blueprint) : null;
  }

  list(): TeamBlueprint[] {
    return [...this.blueprints.values()].map((blueprint) => structuredClone(blueprint));
  }

  record(id: string, outcome: TeamOutcome, policy?: PromotionPolicy): TeamBlueprint {
    const current = this.blueprints.get(id);
    if (!current) throw new Error(`unknown team blueprint: ${id}`);
    const updated = recordTeamOutcome(current, outcome, policy);
    this.save(updated);
    return updated;
  }

  recall(goal: Goal, availableCapabilities: string[]): TeamBlueprint | null {
    return recallBestTeam({ goal, blueprints: this.list(), availableCapabilities });
  }
}