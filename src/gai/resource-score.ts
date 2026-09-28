import type { WorkerDescriptor, WorkerExecutionRequest, WorkerHealth } from "./worker-runtime.ts";

export type ResourceScore = { eligible: boolean; score: number; reasons: string[] };

function percent(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value! >= 0 && value! <= 100 ? value : undefined;
}

export function scoreResourceFit(
  descriptor: WorkerDescriptor,
  health: WorkerHealth,
  request: WorkerExecutionRequest,
): ResourceScore {
  const activeTasks = health.runtimeState?.activeTasks;
  if (activeTasks !== undefined && activeTasks >= descriptor.maxParallelTasks) {
    return { eligible: false, score: -1000, reasons: ["capacity"] };
  }
  const resources = health.resources ?? {};
  if (request.minMemoryAvailableMb !== undefined &&
      (resources.memoryAvailableMb === undefined || resources.memoryAvailableMb < request.minMemoryAvailableMb)) {
    return { eligible: false, score: -1000, reasons: ["memory"] };
  }
  if (request.minDiskAvailableMb !== undefined &&
      (resources.diskAvailableMb === undefined || resources.diskAvailableMb < request.minDiskAvailableMb)) {
    return { eligible: false, score: -1000, reasons: ["disk"] };
  }
  return { eligible: true, score: 0, reasons: [] };
}
