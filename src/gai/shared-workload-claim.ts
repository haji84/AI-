import { randomUUID } from "node:crypto";
import type { CoordinatorClaim } from "./distributed-coordinator.ts";
import type { DurableTask, DurableTaskExecutionClaim } from "./durable-task-runtime.ts";
import type { SharedWorkloadAuthorityStore, SharedWorkloadSnapshot } from "./shared-workload-authority.ts";

function requireLeader(snapshot: SharedWorkloadSnapshot, claim: CoordinatorClaim, now: Date): void {
  const lease = snapshot.coordinator;
  if (!lease || lease.clusterId !== claim.clusterId || lease.coordinatorId !== claim.coordinatorId ||
      lease.epoch !== claim.epoch || lease.fencingToken !== claim.fencingToken ||
      lease.leaseUntil !== claim.leaseUntil || Date.parse(lease.leaseUntil) <= now.getTime()) {
    throw new Error("STALE_COORDINATOR_CLAIM");
  }
}

/** Claim is committed with the coordinator lease in ONE store CAS. */
export async function claimSharedWorkload(
  store: SharedWorkloadAuthorityStore,
  coordinator: CoordinatorClaim,
  taskId: string,
  workerNodeId: string,
  leaseMs = 120_000,
  now = new Date(),
): Promise<{ task: DurableTask; claim: DurableTaskExecutionClaim }> {
  if (!taskId.trim() || !workerNodeId.trim() || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new Error("INVALID_WORKLOAD_CLAIM_INPUT");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await store.load();
    if (state.version !== 1 || state.tasks.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0) {
      throw new Error("SHARED_AUTHORITY_UNAVAILABLE");
    }
    requireLeader(state, coordinator, now);
    const original = state.tasks.tasks.find(task => task.id === taskId);
    if (!original || !["queued", "retrying"].includes(original.status) ||
        (original.migrationClass === "PINNED" && original.pinnedNodeId !== workerNodeId) ||
        (original.nextAttemptAt && Date.parse(original.nextAttemptAt) > now.getTime())) {
      throw new Error("WORKLOAD_NOT_CLAIMABLE");
    }
    if (!Number.isSafeInteger(original.executionEpoch) || original.executionEpoch < 0) {
      throw new Error("INVALID_WORKLOAD_EPOCH");
    }
    const task: DurableTask = structuredClone(original);
    task.status = "leased";
    task.leaseOwner = workerNodeId;
    task.leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    task.executionEpoch += 1;
    task.fencingToken = randomUUID();
    task.updatedAt = now.toISOString();
    task.history.push({
      from: original.status, to: "leased", at: task.updatedAt,
      reason: "shared coordinator-fenced claim", actor: workerNodeId,
      evidence: { coordinatorEpoch: coordinator.epoch, executionEpoch: task.executionEpoch },
    });
    const next: SharedWorkloadSnapshot = {
      ...state,
      revision: state.revision + 1,
      tasks: {
        ...state.tasks,
        savedAt: task.updatedAt,
        tasks: state.tasks.tasks.map(item => item.id === taskId ? task : item),
      },
    };
    if (await store.compareAndSwap(state.revision, next)) {
      return {
        task: structuredClone(task),
        claim: {
          taskId, owner: workerNodeId, epoch: task.executionEpoch,
          fencingToken: task.fencingToken, leaseUntil: task.leaseUntil,
        },
      };
    }
  }
  throw new Error("SHARED_AUTHORITY_WRITE_CONFLICT");
}
