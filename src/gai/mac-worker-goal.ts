import {
  createDevelopmentToolingCapabilityHandler,
  type DevelopmentToolingBridge,
  type DevelopmentToolingOperation,
} from "./development-tooling-capability.ts";
import { createMacbookWorkerAdapter } from "./initial-worker-adapters.ts";
import type { TaskProfile } from "./types.ts";
import type { WorkerExecutionResult } from "./worker-runtime.ts";

export const macWorkerGoalKinds = ["quality-gate"] as const;
export type MacWorkerGoalKind = (typeof macWorkerGoalKinds)[number];

export interface MacWorkerGoalRequest {
  goalId: string;
  kind: MacWorkerGoalKind;
  workspace: string;
  target?: string;
}

export interface MacWorkerStepEvidence {
  taskId: string;
  operation: DevelopmentToolingOperation;
  workerId: string;
  platform: string;
  executionPassed: boolean;
  verifierPassed: boolean;
  status: string | null;
  exitCode: number | null;
  checkIds: string[];
  artifactRefs: string[];
}

export interface MacWorkerGoalEvaluation {
  satisfied: boolean;
  verifiedOperations: DevelopmentToolingOperation[];
  blockers: string[];
}

export interface MacWorkerGoalResult {
  goalId: string;
  kind: MacWorkerGoalKind;
  status: "PASS" | "FAIL";
  verifierPassed: boolean;
  steps: MacWorkerStepEvidence[];
  blockers: string[];
}

export interface MacWorkerGoalExecutorOptions {
  bridge: DevelopmentToolingBridge;
  allowedWorkspaces: readonly string[];
  allowedTargets?: readonly string[];
}

const qualityGateOperations: readonly DevelopmentToolingOperation[] = ["lint", "test", "build"];
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const requestKeys = new Set(["goalId", "kind", "workspace", "target"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw new Error(`mac_worker_goal_invalid_${field}`);
  }
  return value;
}

function validateConfiguredIdentifiers(values: readonly string[], field: string): Set<string> {
  if (values.length === 0) throw new Error(`mac_worker_goal_empty_${field}_allowlist`);
  const normalized = values.map((value) => requireIdentifier(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`mac_worker_goal_duplicate_${field}_allowlist`);
  }
  return new Set(normalized);
}

function validateRequest(input: MacWorkerGoalRequest, options: MacWorkerGoalExecutorOptions): MacWorkerGoalRequest {
  if (!isRecord(input)) throw new Error("mac_worker_goal_invalid_request");
  if (Object.keys(input).some((key) => !requestKeys.has(key))) {
    throw new Error("mac_worker_goal_unexpected_field");
  }

  const goalId = requireIdentifier(input.goalId, "goal_id");
  if (input.kind !== "quality-gate") throw new Error("mac_worker_goal_invalid_kind");

  const workspace = requireIdentifier(input.workspace, "workspace");
  const workspaces = validateConfiguredIdentifiers(options.allowedWorkspaces, "workspace");
  if (!workspaces.has(workspace)) throw new Error("mac_worker_goal_workspace_not_allowed");

  let target: string | undefined;
  if (input.target !== undefined) {
    target = requireIdentifier(input.target, "target");
    const targets = validateConfiguredIdentifiers(options.allowedTargets ?? [], "target");
    if (!targets.has(target)) throw new Error("mac_worker_goal_target_not_allowed");
  }

  return { goalId, kind: "quality-gate", workspace, ...(target ? { target } : {}) };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return [...value] as string[];
}

function stepEvidence(
  operation: DevelopmentToolingOperation,
  taskId: string,
  result: WorkerExecutionResult,
): MacWorkerStepEvidence {
  const capabilityEvidence = isRecord(result.evidence?.capabilityEvidence)
    ? result.evidence.capabilityEvidence
    : undefined;
  const tooling = capabilityEvidence && isRecord(capabilityEvidence.developmentTooling)
    ? capabilityEvidence.developmentTooling
    : undefined;
  const checkIds = stringArray(tooling?.checkIds) ?? [];
  const artifactRefs = stringArray(tooling?.artifactRefs) ?? [];
  const exitCode = typeof tooling?.exitCode === "number" ? tooling.exitCode : null;
  const status = typeof tooling?.status === "string" ? tooling.status : null;
  const verifierPassed =
    result.ok === true &&
    result.workerId === "macbook" &&
    result.platform === "macos" &&
    tooling?.platform === "macos" &&
    tooling?.operation === operation &&
    status === "PASS" &&
    exitCode === 0 &&
    checkIds.length + artifactRefs.length > 0;

  return {
    taskId,
    operation,
    workerId: result.workerId,
    platform: result.platform,
    executionPassed: result.ok,
    verifierPassed,
    status,
    exitCode,
    checkIds,
    artifactRefs,
  };
}

export function evaluateMacWorkerGoalEvidence(input: {
  expectedOperations?: readonly DevelopmentToolingOperation[];
  steps: MacWorkerStepEvidence[];
}): MacWorkerGoalEvaluation {
  const expected = [...(input.expectedOperations ?? qualityGateOperations)];
  const blockers: string[] = [];

  if (expected.length === 0 || new Set(expected).size !== expected.length) {
    blockers.push("expected operations must be non-empty and unique");
  }

  const stepByOperation = new Map<DevelopmentToolingOperation, MacWorkerStepEvidence>();
  const taskIds = new Set<string>();
  for (const step of input.steps) {
    if (!expected.includes(step.operation)) {
      blockers.push(`unexpected operation evidence: ${step.operation}`);
      continue;
    }
    if (stepByOperation.has(step.operation)) {
      blockers.push(`duplicate operation evidence: ${step.operation}`);
      continue;
    }
    if (taskIds.has(step.taskId)) {
      blockers.push(`duplicate task evidence: ${step.taskId}`);
      continue;
    }
    stepByOperation.set(step.operation, step);
    taskIds.add(step.taskId);
  }

  const verifiedOperations: DevelopmentToolingOperation[] = [];
  for (const operation of expected) {
    const step = stepByOperation.get(operation);
    if (!step) {
      blockers.push(`missing operation evidence: ${operation}`);
      continue;
    }
    if (!step.executionPassed) blockers.push(`execution failed: ${operation}`);
    if (!step.verifierPassed) blockers.push(`verifier did not PASS: ${operation}`);
    if (step.workerId !== "macbook" || step.platform !== "macos") {
      blockers.push(`non-Mac worker evidence: ${operation}`);
    }
    if (step.verifierPassed && step.executionPassed && step.workerId === "macbook" && step.platform === "macos") {
      verifiedOperations.push(operation);
    }
  }

  return { satisfied: blockers.length === 0, verifiedOperations, blockers };
}

export function createMacWorkerGoalExecutor(options: MacWorkerGoalExecutorOptions) {
  if (options.bridge.platform !== "macos") throw new Error("mac_worker_goal_requires_macos_bridge");
  validateConfiguredIdentifiers(options.allowedWorkspaces, "workspace");
  if (options.allowedTargets) validateConfiguredIdentifiers(options.allowedTargets, "target");

  const handler = createDevelopmentToolingCapabilityHandler({
    bridge: options.bridge,
    allowedOperations: qualityGateOperations,
    allowedWorkspaces: options.allowedWorkspaces,
    ...(options.allowedTargets ? { allowedTargets: options.allowedTargets } : {}),
  });
  const worker = createMacbookWorkerAdapter({ handlers: { "macos-tooling": handler } });

  return async (input: MacWorkerGoalRequest): Promise<MacWorkerGoalResult> => {
    const request = validateRequest(input, options);
    const steps: MacWorkerStepEvidence[] = [];

    for (const operation of qualityGateOperations) {
      const taskId = `${request.goalId}:${operation}`;
      const task: TaskProfile = {
        id: taskId,
        description: `Mac Worker quality gate ${operation}`,
        difficulty: 5,
        requiresToolUse: true,
        risk: "LOW",
      };
      const result = await worker.execute({
        task,
        input: JSON.stringify({
          operation,
          workspace: request.workspace,
          ...(request.target ? { target: request.target } : {}),
        }),
        requestedCapability: "macos-tooling",
        preferredPlatform: "macos",
      });
      const evidence = stepEvidence(operation, taskId, result);
      steps.push(evidence);
      if (!evidence.verifierPassed) break;
    }

    const evaluation = evaluateMacWorkerGoalEvidence({ steps });
    return {
      goalId: request.goalId,
      kind: request.kind,
      status: evaluation.satisfied ? "PASS" : "FAIL",
      verifierPassed: evaluation.satisfied,
      steps,
      blockers: evaluation.blockers,
    };
  };
}
