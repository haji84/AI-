import type { WorkerPlatform } from "./worker-runtime.ts";

export interface DeviceRunRecord {
  taskId: string;
  workerId: string;
  platform: WorkerPlatform;
  passed: boolean;
  durationMs: number;
  outputFingerprint?: string;
}

export interface CrossDeviceComparison {
  taskId: string;
  comparedWorkers: string[];
  sameOutcome: boolean;
  passRate: number;
  fastestWorkerId: string | null;
  durationSpreadMs: number | null;
}

export function compareCrossDevice(records: DeviceRunRecord[]): CrossDeviceComparison[] {
  const byTask = new Map<string, DeviceRunRecord[]>();
  for (const record of records) {
    const list = byTask.get(record.taskId) ?? [];
    list.push(record);
    byTask.set(record.taskId, list);
  }

  return [...byTask.entries()].map(([taskId, taskRecords]) => {
    const sorted = [...taskRecords].sort((a, b) => a.durationMs - b.durationMs);
    const outcomes = new Set(taskRecords.map((item) => item.passed));
    const durations = taskRecords.map((item) => item.durationMs);
    return {
      taskId,
      comparedWorkers: taskRecords.map((item) => item.workerId).sort(),
      sameOutcome: outcomes.size <= 1,
      passRate: taskRecords.length ? taskRecords.filter((item) => item.passed).length / taskRecords.length : 0,
      fastestWorkerId: sorted[0]?.workerId ?? null,
      durationSpreadMs: durations.length ? Math.max(...durations) - Math.min(...durations) : null,
    };
  });
}

export function summarizeDeviceEffect(comparisons: CrossDeviceComparison[]): {
  tasks: number;
  outcomeAgreementRate: number | null;
  divergentTasks: string[];
} {
  if (!comparisons.length) return { tasks: 0, outcomeAgreementRate: null, divergentTasks: [] };
  const agreed = comparisons.filter((item) => item.sameOutcome).length;
  return {
    tasks: comparisons.length,
    outcomeAgreementRate: agreed / comparisons.length,
    divergentTasks: comparisons.filter((item) => !item.sameOutcome).map((item) => item.taskId),
  };
}
