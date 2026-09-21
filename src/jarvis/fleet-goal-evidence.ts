import type { JarvisTask } from "./types.ts";

export interface JarvisFleetGoalTaskVerification {
  taskId: string;
  verifierPassed: boolean;
}

export interface JarvisFleetGoalEvidenceResult {
  goalId: string;
  satisfied: boolean;
  expectedTaskIds: string[];
  completedTaskIds: string[];
  verifiedTaskIds: string[];
  distinctNodeIds: string[];
  blockers: string[];
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Read-only acceptance predicate for a Goal that intentionally uses multiple
 * devices. It does not replace the Goal Controller or verifier. Callers must
 * supply verifier outcomes produced by the authoritative verification path.
 */
export function evaluateJarvisFleetGoalEvidence(input: {
  goalId: string;
  expectedTaskIds: string[];
  tasks: JarvisTask[];
  verification: JarvisFleetGoalTaskVerification[];
  minDistinctNodes?: number;
}): JarvisFleetGoalEvidenceResult {
  const goalId = input.goalId.trim();
  const expectedTaskIds = input.expectedTaskIds.map((taskId) => taskId.trim());
  const minDistinctNodes = input.minDistinctNodes ?? 2;
  const blockers: string[] = [];

  if (!goalId) blockers.push("goal id is required");
  if (!Number.isSafeInteger(minDistinctNodes) || minDistinctNodes < 2) {
    blockers.push("multi-device Goal requires at least two distinct nodes");
  }
  if (expectedTaskIds.length < 2) blockers.push("multi-device Goal requires at least two expected tasks");
  if (expectedTaskIds.some((taskId) => !taskId)) blockers.push("expected task ids must be non-empty");
  if (hasDuplicates(expectedTaskIds)) blockers.push("expected task ids must be unique");

  const taskById = new Map<string, JarvisTask>();
  for (const task of input.tasks) {
    if (taskById.has(task.id)) {
      blockers.push(`duplicate task state for ${task.id}`);
      continue;
    }
    taskById.set(task.id, task);
  }

  const verificationByTaskId = new Map<string, boolean>();
  for (const item of input.verification) {
    if (verificationByTaskId.has(item.taskId)) {
      blockers.push(`duplicate verifier evidence for ${item.taskId}`);
      continue;
    }
    verificationByTaskId.set(item.taskId, item.verifierPassed);
    if (!expectedTaskIds.includes(item.taskId)) blockers.push(`verifier evidence references unexpected task ${item.taskId}`);
  }

  const completedTaskIds: string[] = [];
  const verifiedTaskIds: string[] = [];
  const distinctNodeIds = new Set<string>();

  for (const taskId of expectedTaskIds) {
    const task = taskById.get(taskId);
    if (!task) {
      blockers.push(`missing task state for ${taskId}`);
      continue;
    }
    if (task.status !== "completed") {
      blockers.push(`task ${taskId} is ${task.status}, not completed`);
    } else {
      completedTaskIds.push(taskId);
    }

    if (!task.assignedNodeId) {
      blockers.push(`task ${taskId} has no assigned node`);
    } else {
      distinctNodeIds.add(task.assignedNodeId);
    }

    if (verificationByTaskId.get(taskId) !== true) {
      blockers.push(`task ${taskId} lacks verifier PASS`);
    } else {
      verifiedTaskIds.push(taskId);
    }
  }

  if (Number.isSafeInteger(minDistinctNodes) && distinctNodeIds.size < minDistinctNodes) {
    blockers.push(`only ${distinctNodeIds.size} distinct node(s) observed; ${minDistinctNodes} required`);
  }

  return {
    goalId,
    satisfied: blockers.length === 0,
    expectedTaskIds: [...expectedTaskIds],
    completedTaskIds: completedTaskIds.sort(),
    verifiedTaskIds: verifiedTaskIds.sort(),
    distinctNodeIds: [...distinctNodeIds].sort(),
    blockers,
  };
}
