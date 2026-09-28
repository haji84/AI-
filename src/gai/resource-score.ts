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
  void descriptor;
  void health;
  void request;
  return { eligible: true, score: 0, reasons: [] };
}
