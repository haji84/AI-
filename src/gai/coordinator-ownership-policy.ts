import type { CoordinatorClaim, DistributedCoordinatorRuntime } from "./distributed-coordinator.ts";

export type WorkloadClass = "MIGRATABLE" | "RESTARTABLE" | "PINNED" | "SIDE_EFFECTING";

export interface WorkloadClaim {
  taskId: string;
  nodeId: string;
  epoch: number;
  token: string;
  coordinator: CoordinatorClaim;
}

export async function assertCurrentWorkloadClaim(
  runtime: DistributedCoordinatorRuntime,
  presented: WorkloadClaim,
  persisted: WorkloadClaim,
  now = new Date(),
): Promise<void> {
  if (!presented.taskId || presented.taskId !== persisted.taskId ||
      !presented.nodeId || presented.nodeId !== persisted.nodeId ||
      !Number.isSafeInteger(presented.epoch) || presented.epoch < 1 ||
      presented.epoch !== persisted.epoch ||
      !presented.token || presented.token !== persisted.token ||
      presented.coordinator.epoch !== persisted.coordinator.epoch ||
      presented.coordinator.fencingToken !== persisted.coordinator.fencingToken) {
    throw new Error("STALE_WORKLOAD_CLAIM");
  }
  await runtime.assertAuthoritative(presented.coordinator, now);
}

export function canReassignWorkload(kind: WorkloadClass, checkpointVerified: boolean, effectReconciled: boolean): boolean {
  switch (kind) {
    case "MIGRATABLE": return checkpointVerified;
    case "RESTARTABLE": return true;
    case "PINNED": return false;
    case "SIDE_EFFECTING": return effectReconciled;
  }
}
