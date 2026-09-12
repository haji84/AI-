import type { WorkerCapability, WorkerPlatform } from "./worker-runtime.ts";

export type ResearchWorkKind =
  | "control"
  | "evidence"
  | "local-safe"
  | "local-model"
  | "gpu"
  | "cross-device"
  | "external-runtime"
  | "human-review";

export interface ResearchWorkerState {
  id: string;
  platform: WorkerPlatform;
  online: boolean;
  busy?: boolean;
  capabilities: WorkerCapability[];
}

export interface ResearchWorkRequest {
  id: string;
  kind: ResearchWorkKind;
  preferredWorkerId?: string;
}

export type ResearchRouteAction = "run-hosted" | "run-worker" | "defer";

export interface ResearchRouteDecision {
  requestId: string;
  action: ResearchRouteAction;
  workerId?: string;
  reason: string;
  queueState?: "WAITING_FOR_CAPABILITY" | "EXTERNAL_GATE" | "HUMAN_GATE";
}

const workerRequirements: Partial<Record<ResearchWorkKind, WorkerCapability[]>> = {
  "local-model": ["local-model"],
  gpu: ["local-model", "gpu"],
};

function satisfies(worker: ResearchWorkerState, required: WorkerCapability[]): boolean {
  return worker.online && !worker.busy && required.every((capability) => worker.capabilities.includes(capability));
}

export function routeResearchWork(
  request: ResearchWorkRequest,
  workers: readonly ResearchWorkerState[],
): ResearchRouteDecision {
  if (request.kind === "control" || request.kind === "evidence" || request.kind === "local-safe") {
    return {
      requestId: request.id,
      action: "run-hosted",
      reason: "deterministic control-plane work does not require a workstation",
    };
  }

  if (request.kind === "external-runtime") {
    return {
      requestId: request.id,
      action: "defer",
      queueState: "EXTERNAL_GATE",
      reason: "real external benchmark/runtime evidence is required",
    };
  }

  if (request.kind === "human-review") {
    return {
      requestId: request.id,
      action: "defer",
      queueState: "HUMAN_GATE",
      reason: "explicit human or independent review is required",
    };
  }

  if (request.kind === "cross-device") {
    const available = workers.filter((worker) => satisfies(worker, ["local-model"]));
    const platforms = new Set(available.map((worker) => worker.platform));
    if (available.length < 2 || platforms.size < 2) {
      return {
        requestId: request.id,
        action: "defer",
        queueState: "WAITING_FOR_CAPABILITY",
        reason: "cross-device evidence requires two online local-model workers on distinct platforms",
      };
    }
    return {
      requestId: request.id,
      action: "run-worker",
      workerId: available.map((worker) => worker.id).sort().join(","),
      reason: "two distinct-platform local-model workers are available",
    };
  }

  const required = workerRequirements[request.kind] ?? [];
  const candidates = workers
    .filter((worker) => satisfies(worker, required))
    .sort((a, b) => {
      if (request.preferredWorkerId) {
        if (a.id === request.preferredWorkerId && b.id !== request.preferredWorkerId) return -1;
        if (b.id === request.preferredWorkerId && a.id !== request.preferredWorkerId) return 1;
      }
      const aGpu = a.capabilities.includes("gpu") ? 1 : 0;
      const bGpu = b.capabilities.includes("gpu") ? 1 : 0;
      return bGpu - aGpu || a.id.localeCompare(b.id);
    });

  const selected = candidates[0];
  if (!selected) {
    return {
      requestId: request.id,
      action: "defer",
      queueState: "WAITING_FOR_CAPABILITY",
      reason: `no online worker currently satisfies: ${required.join(",") || "worker runtime"}`,
    };
  }

  return {
    requestId: request.id,
    action: "run-worker",
    workerId: selected.id,
    reason: `selected healthy worker ${selected.id}`,
  };
}

export function routeResearchQueue(
  requests: readonly ResearchWorkRequest[],
  workers: readonly ResearchWorkerState[],
): ResearchRouteDecision[] {
  return requests.map((request) => routeResearchWork(request, workers));
}
