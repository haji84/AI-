import { createHash } from "node:crypto";
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
  plan(input: DevelopmentPlanningInput): DevelopmentPlan {
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
    });
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
