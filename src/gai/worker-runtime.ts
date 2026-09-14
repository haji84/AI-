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

export interface WorkerResourceSnapshot {
  cpuAvailable?: boolean;
  gpuAvailable?: boolean;
  memoryAvailableMb?: number;
  diskAvailableMb?: number;
  batteryPercent?: number;
  onExternalPower?: boolean;
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
}

export interface WorkerExecutionRequest {
  task: TaskProfile;
  input: string;
  requiredCapabilities?: WorkerCapability[];
  preferredPlatform?: WorkerPlatform;
  requiredExecutionMode?: WorkerExecutionMode;
  connectivity?: WorkerConnectivity;
  allowOffline?: boolean;
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

export class MultiWorkerRuntime {
  private readonly workers: GaiWorker[];

  constructor(workers: GaiWorker[]) {
    this.workers = [...workers];
  }

  async preflight(): Promise<WorkerHealth[]> {
    return Promise.all(this.workers.map((worker) => worker.health()));
  }

  async select(request: WorkerExecutionRequest): Promise<WorkerSelection> {
    const healthy = new Map((await this.preflight()).map((item) => [item.workerId, item]));
    const required = request.requiredCapabilities ?? [];
    const candidates = this.workers
      .filter((worker) => worker.descriptor.enabled)
      .filter((worker) => healthy.get(worker.descriptor.id)?.available)
      .filter((worker) => required.every((capability) => worker.descriptor.capabilities.includes(capability)))
      .filter((worker) => supportsExecutionMode(worker.descriptor, request))
      .filter((worker) => supportsConnectivity(worker.descriptor, healthy.get(worker.descriptor.id)!, request))
      .map((worker) => {
        let score = 1;
        const reasons: string[] = ["healthy"];
        if (request.preferredPlatform && worker.descriptor.platform === request.preferredPlatform) {
          score += 4;
          reasons.push(`preferred platform ${request.preferredPlatform}`);
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
        if (worker.descriptor.capabilities.includes("gpu")) {
          score += 1;
          reasons.push("gpu available");
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
