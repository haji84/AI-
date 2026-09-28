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
  if (request.requireGpu === true &&
      resources.gpuAvailable !== true &&
      request.allowCpuFallbackForGpu !== true) {
    return { eligible: false, score: -1000, reasons: ["gpu"] };
  }
  if (request.maxCpuLoadPercent !== undefined) {
    const load = percent(resources.cpuLoadPercent);
    if (load === undefined || load > request.maxCpuLoadPercent) {
      return { eligible: false, score: -1000, reasons: ["cpu-load"] };
    }
  }
  if (request.maxGpuLoadPercent !== undefined) {
    const load = percent(resources.gpuLoadPercent);
    if (load === undefined || load > request.maxGpuLoadPercent) {
      return { eligible: false, score: -1000, reasons: ["gpu-load"] };
    }
  }
  if (request.requireThermalSafe === true &&
      (!resources.thermalState || resources.thermalState === "serious" || resources.thermalState === "critical")) {
    return { eligible: false, score: -1000, reasons: ["thermal"] };
  }
  const reasons: string[] = [];
  let score = 0;
  if (activeTasks !== undefined) {
    const slots = Math.max(0, descriptor.maxParallelTasks - activeTasks);
    score += Math.min(4, slots) * 1.5;
    reasons.push(`slots:${slots}`);
  }
  const cpuLoad = percent(resources.cpuLoadPercent);
  if (cpuLoad !== undefined) {
    score += (100 - cpuLoad) / 25;
    reasons.push(`cpu:${cpuLoad}`);
  }
  return { eligible: true, score, reasons };
}
