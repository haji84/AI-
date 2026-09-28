import type { TaskProfile } from "./types.ts";

export type WorkerPlatform = "windows" | "macos" | "ios" | "android" | "linux";
export type WorkerDeviceType = "desktop" | "laptop" | "mobile" | "server" | "embedded";
export type WorkerExecutionMode =
  | "resident"
  | "foreground"
  | "background-scheduled"
  | "background-continued"
  | "deferred";
export type WorkerConnectivity = "online" | "degraded" | "offline" | "recovering";
export type WorkerNetworkRequirement = "online-required" | "offline-capable" | "offline-preferred";
export type WorkerCapability =
  | "local-model"
  | "gpu"
  | "macos-tooling"
  | "windows-tooling"
  | "code-builder"
  | "ios-tooling"
  | "android-tooling"
  | "browser"
  | "filesystem"
  | "long-running"
  | "camera"
  | "gps"
  | "sensors"
  | "local-storage"
  | "local-inference"
  | "offline-cache"
  | "background-task";

export type WorkerThermalState = "nominal" | "fair" | "serious" | "critical";

export interface WorkerResourceSnapshot {
  cpuAvailable?: boolean;
  gpuAvailable?: boolean;
  cpuLoadPercent?: number;
  gpuLoadPercent?: number;
  memoryAvailableMb?: number;
  diskAvailableMb?: number;
  batteryPercent?: number;
  onExternalPower?: boolean;
  thermalState?: WorkerThermalState;
  dataLocalityKeys?: string[];
}

export interface WorkerResourceRequirements {
  requireGpu?: boolean;
  minMemoryAvailableMb?: number;
  minDiskAvailableMb?: number;
  maxCpuLoadPercent?: number;
  maxGpuLoadPercent?: number;
  requiredDataLocalityKeys?: string[];
  preferredDataLocalityKeys?: string[];
  preferExternalPower?: boolean;
}

export interface WorkerPersistenceProfile {
  localState: boolean;
  checkpointResume: boolean;
  offlineQueue: boolean;
}

export interface WorkerSecurityContext {
  credentialIsolation: boolean;
  taskScopedAuthorization: boolean;
  acceptsRemoteSecrets?: boolean;
}

export interface WorkerVerifierHooks {
  healthEvidence?: boolean;
  executionEvidence?: boolean;
  artifactEvidence?: boolean;
  stateEvidence?: boolean;
}

export interface WorkerRuntimeStateSnapshot {
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  lastTaskId?: string;
  lastCapability?: WorkerCapability;
  lastResult?: "success" | "failed";
  lastCompletedAt?: string;
}

export interface WorkerDescriptor {
  id: string;
  label: string;
  platform: WorkerPlatform;
  capabilities: WorkerCapability[];
  maxParallelTasks: number;
  enabled: boolean;
  deviceType?: WorkerDeviceType;
  executionModes?: WorkerExecutionMode[];
  networkRequirement?: WorkerNetworkRequirement;
  persistence?: WorkerPersistenceProfile;
  securityContext?: WorkerSecurityContext;
  verifierHooks?: WorkerVerifierHooks;
}

export interface WorkerHealth {
  workerId: string;
  available: boolean;
  checkedAt: string;
  detail?: string;
  connectivity?: WorkerConnectivity;
  executionModes?: WorkerExecutionMode[];
  resources?: WorkerResourceSnapshot;
  runtimeState?: WorkerRuntimeStateSnapshot;
}

export interface WorkerExecutionRequest {
  task: TaskProfile;
  input: string;
  requiredCapabilities?: WorkerCapability[];
  requestedCapability?: WorkerCapability;
  preferredPlatform?: WorkerPlatform;
  requiredPlatform?: WorkerPlatform;
  requiredWorkerId?: string;
  requiredExecutionMode?: WorkerExecutionMode;
  connectivity?: WorkerConnectivity;
  allowOffline?: boolean;
  excludedWorkerIds?: string[];
  resourceRequirements?: WorkerResourceRequirements;
}

export interface WorkerExecutionResult {
  ok: boolean;
  workerId: string;
  platform: WorkerPlatform;
  output: string;
  durationMs: number;
  evidence?: Record<string, unknown>;
}

export interface GaiWorker {
  descriptor: WorkerDescriptor;
  health(): Promise<WorkerHealth>;
  execute(request: WorkerExecutionRequest): Promise<WorkerExecutionResult>;
}

export interface WorkerSelection {
  worker: GaiWorker;
  score: number;
  reasons: string[];
}

function supportsConnectivity(
  descriptor: WorkerDescriptor,
  health: WorkerHealth,
  request: WorkerExecutionRequest,
): boolean {
  const connectivity = request.connectivity ?? health.connectivity ?? "online";
  if (connectivity === "online" || connectivity === "recovering") return true;

  if (descriptor.networkRequirement === "online-required") return false;
  if (request.allowOffline === false) return false;
  return true;
}

function supportsExecutionMode(descriptor: WorkerDescriptor, request: WorkerExecutionRequest): boolean {
  if (!request.requiredExecutionMode) return true;
  return (descriptor.executionModes ?? ["resident"]).includes(request.requiredExecutionMode);
}

function validPercent(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function validateWorkerResourceRequirements(requirements: WorkerResourceRequirements | undefined): void {
  if (!requirements) return;
  for (const [name, value] of [
    ["minMemoryAvailableMb", requirements.minMemoryAvailableMb],
    ["minDiskAvailableMb", requirements.minDiskAvailableMb],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative finite number`);
    }
  }
  for (const [name, value] of [
    ["maxCpuLoadPercent", requirements.maxCpuLoadPercent],
    ["maxGpuLoadPercent", requirements.maxGpuLoadPercent],
  ] as const) {
    if (value !== undefined && !validPercent(value)) throw new Error(`${name} must be between 0 and 100`);
  }
  for (const [name, values] of [
    ["requiredDataLocalityKeys", requirements.requiredDataLocalityKeys],
    ["preferredDataLocalityKeys", requirements.preferredDataLocalityKeys],
  ] as const) {
    if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim()))) {
      throw new Error(`${name} must contain non-empty opaque keys`);
    }
  }
}

export interface WorkerResourcePlacementInput {
  resources?: WorkerResourceSnapshot;
  requirements?: WorkerResourceRequirements;
  maxParallelTasks?: number;
  activeTasks?: number;
  gpuCapable?: boolean;
  gpuRequested?: boolean;
  longRunning?: boolean;
  inputSize?: number;
}

export interface WorkerResourcePlacementEvaluation {
  eligible: boolean;
  score: number;
  reasons: string[];
}

export function evaluateWorkerResourcePlacement(input: WorkerResourcePlacementInput): WorkerResourcePlacementEvaluation {
  validateWorkerResourceRequirements(input.requirements);
  const resources = input.resources ?? {};
  const requirements = input.requirements;
  const reasons: string[] = [];
  let score = 0;

  if (resources.cpuAvailable === false) return { eligible: false, score: 0, reasons: ["cpu unavailable"] };
  if (resources.thermalState === "critical") return { eligible: false, score: 0, reasons: ["thermal critical"] };

  if (input.maxParallelTasks !== undefined) {
    if (!Number.isInteger(input.maxParallelTasks) || input.maxParallelTasks < 1) {
      return { eligible: false, score: 0, reasons: ["invalid parallel capacity"] };
    }
    const active = input.activeTasks;
    if (active !== undefined && (!Number.isInteger(active) || active < 0 || active >= input.maxParallelTasks)) {
      return { eligible: false, score: 0, reasons: ["parallel capacity exhausted"] };
    }
    const capacity = Math.max(0, input.maxParallelTasks - (active ?? 0));
    score += Math.min(6, capacity * 2);
    reasons.push(`capacity ${capacity}/${input.maxParallelTasks}`);
  }

  if (input.gpuRequested === true && input.gpuCapable !== true) {
    return { eligible: false, score: 0, reasons: ["requested gpu capability unavailable"] };
  }
  if (requirements?.requireGpu === true) {
    if (input.gpuCapable !== true || resources.gpuAvailable !== true) {
      return { eligible: false, score: 0, reasons: ["required gpu unavailable or unknown"] };
    }
  } else if (input.gpuRequested === true && resources.gpuAvailable === false) {
    return { eligible: false, score: 0, reasons: ["requested gpu reported unavailable"] };
  } else if (input.gpuCapable === false && resources.gpuAvailable === true) {
    return { eligible: false, score: 0, reasons: ["gpu telemetry contradicts node capability"] };
  }

  if (requirements?.minMemoryAvailableMb !== undefined) {
    if (resources.memoryAvailableMb === undefined || resources.memoryAvailableMb < requirements.minMemoryAvailableMb) {
      return { eligible: false, score: 0, reasons: ["required memory unavailable or unknown"] };
    }
  }
  if (requirements?.minDiskAvailableMb !== undefined) {
    if (resources.diskAvailableMb === undefined || resources.diskAvailableMb < requirements.minDiskAvailableMb) {
      return { eligible: false, score: 0, reasons: ["required disk unavailable or unknown"] };
    }
  }
  if (requirements?.maxCpuLoadPercent !== undefined) {
    if (!validPercent(resources.cpuLoadPercent) || resources.cpuLoadPercent > requirements.maxCpuLoadPercent) {
      return { eligible: false, score: 0, reasons: ["cpu load requirement unavailable or exceeded"] };
    }
  }
  if (requirements?.maxGpuLoadPercent !== undefined) {
    if (!validPercent(resources.gpuLoadPercent) || resources.gpuLoadPercent > requirements.maxGpuLoadPercent) {
      return { eligible: false, score: 0, reasons: ["gpu load requirement unavailable or exceeded"] };
    }
  }

  const local = new Set(resources.dataLocalityKeys ?? []);
  const requiredLocality = requirements?.requiredDataLocalityKeys ?? [];
  if (requiredLocality.length && !requiredLocality.every((key) => local.has(key))) {
    return { eligible: false, score: 0, reasons: ["required data locality unavailable"] };
  }

  if (validPercent(resources.cpuLoadPercent)) {
    score += (100 - resources.cpuLoadPercent) / 25;
    reasons.push(`cpu load ${resources.cpuLoadPercent}%`);
  }
  const gpuRelevant = requirements?.requireGpu === true || input.gpuRequested === true;
  if (gpuRelevant && validPercent(resources.gpuLoadPercent)) {
    score += (100 - resources.gpuLoadPercent) / 25;
    reasons.push(`gpu load ${resources.gpuLoadPercent}%`);
  }

  if (resources.memoryAvailableMb !== undefined && Number.isFinite(resources.memoryAvailableMb)) {
    const floor = requirements?.minMemoryAvailableMb ?? 0;
    score += Math.min(3, Math.max(0, resources.memoryAvailableMb - floor) / 8192);
    reasons.push(`memory ${Math.round(resources.memoryAvailableMb)}MB available`);
  }

  const preferredLocality = requirements?.preferredDataLocalityKeys ?? [];
  if (preferredLocality.length) {
    const matches = preferredLocality.filter((key) => local.has(key)).length;
    if (matches) {
      score += Math.min(12, matches * 6);
      reasons.push(`data locality ${matches}/${preferredLocality.length}`);
    }
  }

  const powerPreferred = requirements?.preferExternalPower === true
    || input.longRunning === true
    || (input.inputSize ?? 0) > 20_000;
  if (powerPreferred && resources.onExternalPower === true) {
    score += 2;
    reasons.push("external power");
  }
  if (resources.thermalState === "nominal") {
    score += 1;
    reasons.push("thermal nominal");
  } else if (resources.thermalState === "serious") {
    score -= 2;
    reasons.push("thermal serious");
  }
  if (resources.batteryPercent !== undefined && resources.onExternalPower !== true && resources.batteryPercent < 20) {
    score -= 2;
    reasons.push("low battery");
  }

  return { eligible: true, score, reasons };
}

function supportsResources(descriptor: WorkerDescriptor, health: WorkerHealth, request: WorkerExecutionRequest): boolean {
  const evaluation = evaluateWorkerResourcePlacement({
    resources: health.resources,
    requirements: request.resourceRequirements,
    maxParallelTasks: descriptor.maxParallelTasks,
    activeTasks: health.runtimeState?.activeTasks,
    gpuCapable: descriptor.capabilities.includes("gpu"),
    gpuRequested: request.requestedCapability === "gpu" || (request.requiredCapabilities ?? []).includes("gpu"),
    longRunning: request.task.requiresFrontierReasoning || descriptor.capabilities.includes("long-running"),
    inputSize: request.input.length,
  });
  return evaluation.eligible;
}

function resourceScore(
  descriptor: WorkerDescriptor,
  health: WorkerHealth,
  request: WorkerExecutionRequest,
): { score: number; reasons: string[] } {
  const evaluation = evaluateWorkerResourcePlacement({
    resources: health.resources,
    requirements: request.resourceRequirements,
    maxParallelTasks: descriptor.maxParallelTasks,
    activeTasks: health.runtimeState?.activeTasks,
    gpuCapable: descriptor.capabilities.includes("gpu"),
    gpuRequested: request.requestedCapability === "gpu" || (request.requiredCapabilities ?? []).includes("gpu"),
    longRunning: request.task.requiresFrontierReasoning || descriptor.capabilities.includes("long-running"),
    inputSize: request.input.length,
  });
  return { score: evaluation.score, reasons: evaluation.reasons };
}

export class MultiWorkerRuntime {
  private readonly workers: GaiWorker[];

  constructor(workers: GaiWorker[]) {
    this.workers = [...workers];
  }

  async preflight(): Promise<WorkerHealth[]> {
    return Promise.all(this.workers.map((worker) => worker.health()));
  }

  async select(request: WorkerExecutionRequest): Promise<WorkerSelection> {
    validateWorkerResourceRequirements(request.resourceRequirements);
    const healthy = new Map((await this.preflight()).map((item) => [item.workerId, item]));
    const required = request.requiredCapabilities ?? [];
    const excluded = new Set(request.excludedWorkerIds ?? []);
    const candidates = this.workers
      .filter((worker) => worker.descriptor.enabled)
      .filter((worker) => !request.requiredPlatform || worker.descriptor.platform === request.requiredPlatform)
      .filter((worker) => !request.requiredWorkerId || worker.descriptor.id === request.requiredWorkerId)
      .filter((worker) => !excluded.has(worker.descriptor.id))
      .filter((worker) => healthy.get(worker.descriptor.id)?.available)
      .filter((worker) => required.every((capability) => worker.descriptor.capabilities.includes(capability)))
      .filter((worker) => !request.requestedCapability || worker.descriptor.capabilities.includes(request.requestedCapability))
      .filter((worker) => supportsExecutionMode(worker.descriptor, request))
      .filter((worker) => supportsConnectivity(worker.descriptor, healthy.get(worker.descriptor.id)!, request))
      .filter((worker) => supportsResources(worker.descriptor, healthy.get(worker.descriptor.id)!, request))
      .map((worker) => {
        const health = healthy.get(worker.descriptor.id)!;
        const resource = resourceScore(worker.descriptor, health, request);
        let score = 1 + resource.score;
        const reasons: string[] = ["healthy", ...resource.reasons];
        if (request.preferredPlatform && worker.descriptor.platform === request.preferredPlatform) {
          score += 4;
          reasons.push(`preferred platform ${request.preferredPlatform}`);
        }
        if (request.requestedCapability) {
          score += 2;
          reasons.push(`provides requested capability ${request.requestedCapability}`);
        }
        if (request.requiredExecutionMode) {
          score += 2;
          reasons.push(`supports execution mode ${request.requiredExecutionMode}`);
        }
        if (request.task.requiresFrontierReasoning) {
          score += worker.descriptor.capabilities.includes("long-running") ? 1 : 0;
        }
        if (request.input.length > 20_000 && worker.descriptor.capabilities.includes("long-running")) {
          score += 2;
          reasons.push("long context capable");
        }
        if (
          (request.resourceRequirements?.requireGpu === true
            || request.requestedCapability === "gpu"
            || (request.requiredCapabilities ?? []).includes("gpu"))
          && worker.descriptor.capabilities.includes("gpu")
        ) {
          score += 2;
          reasons.push("requested gpu available");
        }
        if (
          (request.connectivity === "offline" || request.connectivity === "degraded") &&
          worker.descriptor.networkRequirement === "offline-preferred"
        ) {
          score += 3;
          reasons.push("offline preferred");
        }
        return { worker, score, reasons };
      })
      .sort((a, b) => b.score - a.score || a.worker.descriptor.id.localeCompare(b.worker.descriptor.id));

    const selected = candidates[0];
    if (!selected) {
      throw new Error(`No healthy worker satisfies task ${request.task.id}`);
    }
    return selected;
  }

  async execute(request: WorkerExecutionRequest): Promise<WorkerExecutionResult> {
    const selection = await this.select(request);
    return selection.worker.execute(request);
  }
}

export function createFunctionWorker(input: {
  descriptor: WorkerDescriptor;
  available?: () => boolean | Promise<boolean>;
  health?: () => Partial<Omit<WorkerHealth, "workerId" | "checkedAt">> | Promise<Partial<Omit<WorkerHealth, "workerId" | "checkedAt">>>;
  run: (request: WorkerExecutionRequest) => Promise<string>;
}): GaiWorker {
  return {
    descriptor: input.descriptor,
    async health() {
      const available = input.descriptor.enabled && (input.available ? Boolean(await input.available()) : true);
      const detail = input.health ? await input.health() : {};
      return {
        workerId: input.descriptor.id,
        available,
        checkedAt: new Date().toISOString(),
        connectivity: "online",
        executionModes: input.descriptor.executionModes,
        ...detail,
      };
    },
    async execute(request) {
      const started = Date.now();
      try {
        return {
          ok: true,
          workerId: input.descriptor.id,
          platform: input.descriptor.platform,
          output: await input.run(request),
          durationMs: Date.now() - started,
        };
      } catch (error) {
        return {
          ok: false,
          workerId: input.descriptor.id,
          platform: input.descriptor.platform,
          output: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - started,
        };
      }
    },
  };
}
