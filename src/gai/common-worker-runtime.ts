import { assertWorkerDescriptorMatchesPlatformManifest } from "./platform-capability-manifest.ts";
import type {
  GaiWorker,
  WorkerCapability,
  WorkerDescriptor,
  WorkerExecutionRequest,
  WorkerExecutionResult,
  WorkerHealth,
  WorkerRuntimeStateSnapshot,
} from "./worker-runtime.ts";

export interface WorkerCheckpointRecord {
  taskId: string;
  capability: WorkerCapability;
  value: unknown;
  savedAt: string;
}

export interface WorkerCheckpointHooks {
  save(record: WorkerCheckpointRecord): Promise<void>;
  load(taskId: string, capability: WorkerCapability): Promise<WorkerCheckpointRecord | undefined>;
  remove(taskId: string, capability: WorkerCapability): Promise<void>;
}

export interface CapabilityExecutionContext {
  worker: WorkerDescriptor;
  taskId: string;
  capability: WorkerCapability;
  checkpoint?: WorkerCheckpointHooks;
}

export interface CapabilityHandlerResult {
  output: string;
  evidence?: Record<string, unknown>;
}

export type CapabilityHandler = (
  request: WorkerExecutionRequest,
  context: CapabilityExecutionContext,
) => Promise<string | CapabilityHandlerResult>;

export interface CommonWorkerRuntimeOptions {
  descriptor: WorkerDescriptor;
  runtimeVersion?: string;
  checkpoint?: WorkerCheckpointHooks;
  available?: () => boolean | Promise<boolean>;
  health?: () => Partial<Omit<WorkerHealth, "workerId" | "checkedAt" | "runtimeState">> | Promise<Partial<Omit<WorkerHealth, "workerId" | "checkedAt" | "runtimeState">>>;
}

export class CommonWorkerRuntime implements GaiWorker {
  readonly descriptor: WorkerDescriptor;
  private readonly runtimeVersion: string;
  private readonly checkpoint?: WorkerCheckpointHooks;
  private readonly available?: () => boolean | Promise<boolean>;
  private readonly healthProvider?: CommonWorkerRuntimeOptions["health"];
  private readonly handlers = new Map<WorkerCapability, CapabilityHandler>();
  private state: WorkerRuntimeStateSnapshot = {
    activeTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
  };

  constructor(options: CommonWorkerRuntimeOptions) {
    assertWorkerDescriptorMatchesPlatformManifest(options.descriptor);
    this.descriptor = options.descriptor;
    this.runtimeVersion = options.runtimeVersion ?? "1";
    this.checkpoint = options.checkpoint;
    this.available = options.available;
    this.healthProvider = options.health;
  }

  registerCapability(capability: WorkerCapability, handler: CapabilityHandler): this {
    if (!this.descriptor.capabilities.includes(capability)) {
      throw new Error(`Capability ${capability} is not declared by worker ${this.descriptor.id}`);
    }
    if (this.handlers.has(capability)) {
      throw new Error(`Capability ${capability} is already registered on worker ${this.descriptor.id}`);
    }
    this.handlers.set(capability, handler);
    return this;
  }

  registeredCapabilities(): WorkerCapability[] {
    return [...this.handlers.keys()].sort();
  }

  snapshot(): WorkerRuntimeStateSnapshot {
    return { ...this.state };
  }

  async health(): Promise<WorkerHealth> {
    const available = this.descriptor.enabled && (this.available ? Boolean(await this.available()) : true);
    const extra = this.healthProvider ? await this.healthProvider() : {};
    return {
      workerId: this.descriptor.id,
      available,
      checkedAt: new Date().toISOString(),
      connectivity: "online",
      executionModes: this.descriptor.executionModes,
      ...extra,
      runtimeState: this.snapshot(),
    };
  }

  async execute(request: WorkerExecutionRequest): Promise<WorkerExecutionResult> {
    const capability = this.resolveCapability(request);
    const handler = this.handlers.get(capability);
    if (!handler) {
      throw new Error(`Capability ${capability} has no registered handler on worker ${this.descriptor.id}`);
    }

    const startedAt = new Date().toISOString();
    const started = Date.now();
    this.state = { ...this.state, activeTasks: this.state.activeTasks + 1 };

    try {
      const raw = await handler(request, {
        worker: this.descriptor,
        taskId: request.task.id,
        capability,
        checkpoint: this.checkpoint,
      });
      const handlerResult: CapabilityHandlerResult = typeof raw === "string" ? { output: raw } : raw;
      const completedAt = new Date().toISOString();
      this.state = {
        activeTasks: Math.max(0, this.state.activeTasks - 1),
        completedTasks: this.state.completedTasks + 1,
        failedTasks: this.state.failedTasks,
        lastTaskId: request.task.id,
        lastCapability: capability,
        lastResult: "success",
        lastCompletedAt: completedAt,
      };
      return this.result(true, request, capability, handlerResult.output, started, startedAt, completedAt, handlerResult.evidence);
    } catch (error) {
      const completedAt = new Date().toISOString();
      const output = error instanceof Error ? error.message : String(error);
      this.state = {
        activeTasks: Math.max(0, this.state.activeTasks - 1),
        completedTasks: this.state.completedTasks,
        failedTasks: this.state.failedTasks + 1,
        lastTaskId: request.task.id,
        lastCapability: capability,
        lastResult: "failed",
        lastCompletedAt: completedAt,
      };
      return this.result(false, request, capability, output, started, startedAt, completedAt);
    }
  }

  private resolveCapability(request: WorkerExecutionRequest): WorkerCapability {
    if (request.requestedCapability) {
      if (!this.descriptor.capabilities.includes(request.requestedCapability)) {
        throw new Error(`Worker ${this.descriptor.id} does not declare capability ${request.requestedCapability}`);
      }
      return request.requestedCapability;
    }

    const required = request.requiredCapabilities ?? [];
    const registeredRequired = required.filter((capability) => this.handlers.has(capability));
    if (registeredRequired.length === 1) return registeredRequired[0]!;
    if (registeredRequired.length > 1) {
      throw new Error(`Task ${request.task.id} requires multiple registered capabilities; requestedCapability is required`);
    }

    const registered = this.registeredCapabilities();
    if (registered.length === 1) return registered[0]!;
    if (registered.length === 0) {
      throw new Error(`Worker ${this.descriptor.id} has no registered capability handlers`);
    }
    throw new Error(`Task ${request.task.id} must select requestedCapability for worker ${this.descriptor.id}`);
  }

  private result(
    ok: boolean,
    request: WorkerExecutionRequest,
    capability: WorkerCapability,
    output: string,
    started: number,
    startedAt: string,
    completedAt: string,
    capabilityEvidence?: Record<string, unknown>,
  ): WorkerExecutionResult {
    return {
      ok,
      workerId: this.descriptor.id,
      platform: this.descriptor.platform,
      output,
      durationMs: Date.now() - started,
      evidence: {
        runtime: "common-worker-runtime",
        runtimeVersion: this.runtimeVersion,
        workerId: this.descriptor.id,
        taskId: request.task.id,
        capability,
        startedAt,
        completedAt,
        securityContext: this.descriptor.securityContext ?? null,
        verifierHooks: this.descriptor.verifierHooks ?? null,
        capabilityEvidence: capabilityEvidence ?? null,
      },
    };
  }
}

export function createMemoryCheckpointHooks(): WorkerCheckpointHooks {
  const records = new Map<string, WorkerCheckpointRecord>();
  const key = (taskId: string, capability: WorkerCapability) => `${taskId}:${capability}`;
  return {
    async save(record) {
      records.set(key(record.taskId, record.capability), { ...record });
    },
    async load(taskId, capability) {
      const record = records.get(key(taskId, capability));
      return record ? { ...record } : undefined;
    },
    async remove(taskId, capability) {
      records.delete(key(taskId, capability));
    },
  };
}
