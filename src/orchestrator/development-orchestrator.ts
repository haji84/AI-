import { createHash } from "node:crypto";
import { assessCompletionPath, type CompletionInput, type CompletionCycle } from "./completion-path.ts";
import type { WorkState } from "./work-state.ts";
import { completionDigest, type CompletionRequirement } from './completion-path.ts';
import type { BoundCompletionCandidate, CompletionSource, CompletionSnapshot } from './completion-execution.ts';
import { evaluateRiskPolicy } from './risk-policy.ts';
import {
  createDevelopmentJob,
  type DevelopmentFailure,
  type DevelopmentJob,
  type DevelopmentRisk,
  type DevelopmentWorkItem,
} from "./development-job.ts";

export interface DevelopmentPlanningInput {
  jobId: string;
  goalId: string;
  objective: string;
  requirementIds: string[];
  acceptanceCriteria: string[];
  baseRevision: string;
  taskScopeId: string;
  maxRisk: DevelopmentRisk;
  targetFiles: string[];
  contextDigest: string;
  priorFailures?: DevelopmentFailure[];
}
export interface DevelopmentPlan {
  job: DevelopmentJob;
  strategy: { id: string; hypothesis: string; reason: string };
  targetFiles: string[];
  contextDigest: string;
  rollbackPlan: string;
  releaseAuthority: false;
}

function capabilities(paths: string[]): string[] {
  const result = new Set(["filesystem"]);
  if (paths.some((path) => /(?:ios|iphone|\.swift$|\.xcodeproj)/i.test(path))) result.add("ios-tooling");
  if (paths.some((path) => /(?:windows|\.ps1$)/i.test(path))) result.add("windows-tooling");
  return [...result];
}

function workItems(input: DevelopmentPlanningInput): DevelopmentWorkItem[] {
  const platformCapabilities = capabilities(input.targetFiles);
  const testId = `${input.jobId}:test`;
  const implementationId = `${input.jobId}:implement`;
  return [
    {
      id: testId,
      objective: `Write a failing acceptance test for: ${input.objective}`,
      dependsOn: [],
      requiredCapabilities: [...new Set(["code-builder", ...platformCapabilities])],
    },
    {
      id: implementationId,
      objective: `Implement the smallest change that passes the new test: ${input.objective}`,
      dependsOn: [testId],
      requiredCapabilities: [...new Set(["code-builder", ...platformCapabilities])],
    },
    {
      id: `${input.jobId}:verify`,
      objective: `Independently verify the implementation and affected regressions: ${input.objective}`,
      dependsOn: [implementationId],
      requiredCapabilities: platformCapabilities,
    },
  ];
}

export class DevelopmentOrchestrator {
  /** Bind existing job work items to host-registered actions; context/HTTP cannot register executors. */
  completionSource(plan: DevelopmentPlan, input: {
    requirements: CompletionRequirement[];
    bindings: Record<string, Omit<BoundCompletionCandidate, 'workItem' | 'strategyId'>>;
    /** Explicit host mapping from planning roles to existing registered capability names. */
    capabilityBindings?: Record<string, string>;
    capabilities(): Promise<CompletionSnapshot['capabilities']>;
    evidence(): Promise<CompletionSnapshot['evidence']>;
    observe: CompletionSource['observe'];
  }): CompletionSource {
    const job = structuredClone(plan.job);
    const bindings = structuredClone(input.bindings);
    const requirements = structuredClone(input.requirements);
    const capabilityBindings = structuredClone(input.capabilityBindings ?? {});
    const strategyId = plan.strategy.id;
    for (const item of job.workItems) item.requiredCapabilities = [...new Set(item.requiredCapabilities.map(role => {
      const name = capabilityBindings[role] ?? role;
      if (typeof name !== 'string' || !name.trim()) throw Error('invalid planning capability binding');
      return name;
    }))];
    if (Object.keys(bindings).length !== job.workItems.length || job.workItems.some(item => !bindings[item.id])) throw Error('every existing work item requires an exact action binding');
    const rank = { low: 0, medium: 1, high: 2, critical: 3 };
    for (const item of job.workItems) {
      const binding = bindings[item.id];
      const risk = evaluateRiskPolicy({ ...binding.riskSignals, ...binding.action.riskSignals, ...Object.fromEntries(Object.entries(binding.riskSignals).filter(([, v]) => v === true)) });
      if (Math.max(rank[binding.action.risk], rank[risk.level.toLowerCase() as keyof typeof rank]) > rank[job.approvalScope.maxRisk]) throw Error('completion binding exceeds existing job approval scope');
    }
    return {
      async inspect(state) {
        if (state.goalId !== job.goalId || completionDigest(state.definitionOfDone.map(c => [c.id, c.description])) !== completionDigest(job.definitionOfDone.map(c => [c.id, c.description]))) throw Error('completion job and authoritative Goal mismatch');
        if (job.approvalScope.expiresAt && Date.parse(job.approvalScope.expiresAt) <= Date.now()) throw Error('completion job approval scope expired');
        return { requirements: structuredClone(requirements), candidates: job.workItems.map(workItem => ({ ...structuredClone(bindings[workItem.id]), workItem: structuredClone(workItem), strategyId })),
          capabilities: await input.capabilities(), evidence: await input.evidence() };
      },
      observe: input.observe,
    };
  }

  /** Advisory preflight only. The existing plan/execution authority remains unchanged. */
  assessCompletionPath(state: WorkState, input: CompletionInput, history: CompletionCycle[] = []): CompletionCycle {
    return assessCompletionPath(state, input, history);
  }

  plan(input: DevelopmentPlanningInput, now = new Date()): DevelopmentPlan {
    if (!input.objective.trim() || !input.acceptanceCriteria.length || !input.targetFiles.length) {
      throw new Error("development objective, acceptance criteria, and target files are required");
    }
    const failures = input.priorFailures ?? [];
    const hypothesis = failures.length
      ? `Replace failed strategy ${failures.at(-1)!.strategyId} using a smaller isolated implementation and its verifier evidence`
      : "A focused failing test followed by the smallest implementation will satisfy the accepted criteria";
    const strategyId = createHash("sha256").update(JSON.stringify({
      objective: input.objective,
      targetFiles: [...new Set(input.targetFiles)].sort(),
      contextDigest: input.contextDigest,
      hypothesis,
      rejected: failures.map((failure) => failure.strategyId).sort(),
    })).digest("hex");
    const job = createDevelopmentJob({
      jobId: input.jobId,
      goalId: input.goalId,
      requirementIds: input.requirementIds,
      acceptanceCriteria: input.acceptanceCriteria,
      definitionOfDone: input.acceptanceCriteria.map((criterion, index) => ({
        id: `criterion-${index + 1}`,
        description: criterion,
        required: true,
      })),
      baseRevision: input.baseRevision,
      approvalScope: { taskScopeId: input.taskScopeId, maxRisk: input.maxRisk },
      workItems: workItems(input),
    }, now);
    return {
      job,
      strategy: {
        id: strategyId,
        hypothesis,
        reason: failures.length
          ? "Prior failure evidence requires a materially different TDD strategy"
          : "TDD minimizes unverified implementation and preserves independent completion evidence",
      },
      targetFiles: [...new Set(input.targetFiles)],
      contextDigest: input.contextDigest,
      rollbackPlan: `Restore the affected Change Set to base revision ${input.baseRevision} and rerun all affected verification`,
      releaseAuthority: false,
    };
  }
}
