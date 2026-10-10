import type { CoordinatorClaim, CoordinatorLease } from "./distributed-coordinator.ts";
import type { DurableTask, DurableTaskExecutionClaim, DurableTaskSnapshot } from "./durable-task-runtime.ts";

export interface SharedWorkloadSnapshot {
  version: 1;
  coordinator: CoordinatorLease | null;
  tasks: DurableTaskSnapshot;
  revision: number;
}

/**
 * A store implementation MUST provide cross-host linearizable CAS, durable writes,
 * and a single serialization point for BOTH coordinator and task state.
 * Local JSON files, per-process memory and eventually consistent replicas
 * do not satisfy this contract for production.
 */
export interface SharedWorkloadAuthorityStore {
  load(): Promise<SharedWorkloadSnapshot>;
  compareAndSwap(expectedRevision: number, next: SharedWorkloadSnapshot): Promise<boolean>;
}

export class SharedAuthorityUnavailable extends Error {
  constructor() { super("SHARED_AUTHORITY_UNAVAILABLE"); }
}

function assertLeader(current: CoordinatorLease | null, claim: CoordinatorClaim, now: Date): void {
  if (!current || current.clusterId !== claim.clusterId ||
      current.coordinatorId !== claim.coordinatorId ||
      current.epoch !== claim.epoch ||
      current.fencingToken !== claim.fencingToken ||
      current.leaseUntil !== claim.leaseUntil ||
      Date.parse(current.leaseUntil) <= now.getTime()) {
    throw new Error("STALE_COORDINATOR_CLAIM");
  }
}

function assertTask(task: DurableTask | undefined, claim: DurableTaskExecutionClaim, now: Date): asserts task is DurableTask {
  if (!task || task.id !== claim.taskId ||
      task.leaseOwner !== claim.owner ||
      task.executionEpoch !== claim.epoch ||
      task.fencingToken !== claim.fencingToken ||
      task.leaseUntil !== claim.leaseUntil ||
      Date.parse(claim.leaseUntil) <= now.getTime() ||
      !["leased", "running"].includes(task.status)) {
    throw new Error("STALE_WORKLOAD_CLAIM");
  }
}

/** One authority check and task transition within a single CAS transaction. */
export async function commitSharedWorkloadResult(
  store: SharedWorkloadAuthorityStore,
  coordinatorClaim: CoordinatorClaim,
  taskClaim: DurableTaskExecutionClaim,
  result: unknown,
  now = new Date(),
): Promise<DurableTask> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await store.load();
    if (state.version !== 1 || state.tasks.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0) {
      throw new SharedAuthorityUnavailable();
    }
    assertLeader(state.coordinator, coordinatorClaim, now);
    const task = state.tasks.tasks.find(item => item.id === taskClaim.taskId);
    assertTask(task, taskClaim, now);
    const updated: DurableTask = structuredClone(task);
    updated.status = "completed";
    updated.result = structuredClone(result);
    updated.updatedAt = now.toISOString();
    updated.leaseOwner = undefined;
    updated.leaseUntil = undefined;
    updated.fencingToken = undefined;
    updated.history.push({
      from: task.status, to: "completed", at: now.toISOString(),
      reason: "shared authority verified completion", actor: taskClaim.owner,
      evidence: { executionEpoch: taskClaim.epoch, coordinatorEpoch: coordinatorClaim.epoch },
    });
    const next: SharedWorkloadSnapshot = {
      ...state,
      revision: state.revision + 1,
      tasks: {
        ...state.tasks,
        savedAt: now.toISOString(),
        tasks: state.tasks.tasks.map(item => item.id === updated.id ? updated : item),
      },
    };
    if (await store.compareAndSwap(state.revision, next)) return structuredClone(updated);
  }
  throw new Error("SHARED_AUTHORITY_WRITE_CONFLICT");
}
