import type { TaskProfile } from "./types.ts";

export type WorkerPlatform = "windows" | "macos" | "linux";
export type WorkerCapability =
  | "local-model"
  | "gpu"
  | "macos-tooling"
  | "windows-tooling"
  | "browser"
  | "filesystem"
  | "long-running";

export interface WorkerDescriptor {
  id: string;
  label: string;
  platform: WorkerPlatform;
  capabilities: WorkerCapability[];
  maxParallelTasks: number;
  enabled: boolean;
}

export interface WorkerHealth {
  workerId: string;
  available: boolean;
  checkedAt: string;
  detail?: string;
}

export interface WorkerExecutionRequest {
  task: TaskProfile;
  input: string;
  requiredCapabilities?: WorkerCapability[];
  preferredPlatform?: WorkerPlatform;
}

export interface WorkerExecutionResult {
  ok: boolean;
  workerId: string;
  platform: WorkerPlatform;
  output: string;
  durationMs: number;
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
      .map((worker) => {
        let score = 1;
        const reasons: string[] = ["healthy"];
        if (request.preferredPlatform && worker.descriptor.platform === request.preferredPlatform) {
          score += 4;
          reasons.push(`preferred platform ${request.preferredPlatform}`);
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
  run: (request: WorkerExecutionRequest) => Promise<string>;
}): GaiWorker {
  return {
    descriptor: input.descriptor,
    async health() {
      const available = input.descriptor.enabled && (input.available ? Boolean(await input.available()) : true);
      return {
        workerId: input.descriptor.id,
        available,
        checkedAt: new Date().toISOString(),
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
