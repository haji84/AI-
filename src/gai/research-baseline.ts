import { summarizeBenchmark, type BenchmarkSummary } from "./benchmark.ts";
import type { ModelTier, TaskProfile } from "./types.ts";

export const BASELINE_ARTIFACT_SCHEMA = "gai-research-baseline:v1" as const;

export interface BaselineTask extends TaskProfile {
  transferTask?: boolean;
}

export interface BaselineRuntimeResult {
  passed: boolean;
  humanInterventionCount: number;
  retryCount?: number;
  failureTaxonomy?: string[];
  evidence?: string[];
}

export interface BaselineRuntimeAdapter {
  id: string;
  provider: string;
  modelTier: ModelTier;
  additionalApiCost: 0;
  isAvailable(): Promise<boolean>;
  execute(task: BaselineTask): Promise<BaselineRuntimeResult>;
}

export interface BaselineCaseArtifact {
  id: string;
  passed: boolean;
  humanInterventionCount: number;
  durationMs: number;
  transferTask: boolean;
  retryCount: number;
  modelTier: ModelTier;
  provider: string;
  failureTaxonomy: string[];
  evidence: string[];
}

export interface BaselineRunArtifact {
  schema: typeof BASELINE_ARTIFACT_SCHEMA;
  mode: "preflight" | "real";
  generatedAt: string;
  runtime: {
    adapterId: string | null;
    provider: string | null;
    modelTier: ModelTier | null;
    additionalApiCost: 0;
    available: boolean;
  };
  summary: BenchmarkSummary | null;
  cases: BaselineCaseArtifact[];
  refusalReason?: string;
  resumeCommand: string;
}

export interface BaselinePreflight {
  canRunRealBaseline: boolean;
  reason?: string;
  adapter: BaselineRuntimeAdapter | null;
}

export async function preflightBaseline(adapter: BaselineRuntimeAdapter | null): Promise<BaselinePreflight> {
  if (!adapter) {
    return {
      canRunRealBaseline: false,
      reason: "No real model/runtime adapter was supplied. CI fixtures are not a real baseline.",
      adapter: null,
    };
  }
  if (adapter.additionalApiCost !== 0) {
    return {
      canRunRealBaseline: false,
      reason: "The supplied adapter does not satisfy the zero-additional-API-cost policy.",
      adapter,
    };
  }
  if (!(await adapter.isAvailable())) {
    return {
      canRunRealBaseline: false,
      reason: `Runtime adapter ${adapter.id} is unavailable on this machine.`,
      adapter,
    };
  }
  return { canRunRealBaseline: true, adapter };
}

export function createPreflightArtifact(input: {
  adapter: BaselineRuntimeAdapter | null;
  reason: string;
  resumeCommand: string;
  generatedAt?: string;
}): BaselineRunArtifact {
  return {
    schema: BASELINE_ARTIFACT_SCHEMA,
    mode: "preflight",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    runtime: {
      adapterId: input.adapter?.id ?? null,
      provider: input.adapter?.provider ?? null,
      modelTier: input.adapter?.modelTier ?? null,
      additionalApiCost: 0,
      available: false,
    },
    summary: null,
    cases: [],
    refusalReason: input.reason,
    resumeCommand: input.resumeCommand,
  };
}

export async function runRealBaseline(input: {
  tasks: BaselineTask[];
  adapter: BaselineRuntimeAdapter;
  resumeCommand: string;
  generatedAt?: string;
}): Promise<BaselineRunArtifact> {
  if (input.tasks.length === 0) throw new Error("A real baseline requires at least one task.");

  const preflight = await preflightBaseline(input.adapter);
  if (!preflight.canRunRealBaseline) {
    throw new Error(preflight.reason ?? "Real baseline preflight failed.");
  }

  const cases: BaselineCaseArtifact[] = [];
  for (const task of input.tasks) {
    const startedAt = Date.now();
    const result = await input.adapter.execute(task);
    cases.push({
      id: task.id,
      passed: result.passed,
      humanInterventionCount: result.humanInterventionCount,
      durationMs: Date.now() - startedAt,
      transferTask: Boolean(task.transferTask),
      retryCount: result.retryCount ?? 0,
      modelTier: input.adapter.modelTier,
      provider: input.adapter.provider,
      failureTaxonomy: result.failureTaxonomy ?? [],
      evidence: result.evidence ?? [],
    });
  }

  return {
    schema: BASELINE_ARTIFACT_SCHEMA,
    mode: "real",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    runtime: {
      adapterId: input.adapter.id,
      provider: input.adapter.provider,
      modelTier: input.adapter.modelTier,
      additionalApiCost: 0,
      available: true,
    },
    summary: summarizeBenchmark(cases),
    cases,
    resumeCommand: input.resumeCommand,
  };
}
