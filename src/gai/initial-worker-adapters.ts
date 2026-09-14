import {
  CommonWorkerRuntime,
  type CapabilityHandler,
  type WorkerCheckpointHooks,
} from "./common-worker-runtime.ts";
import {
  iphoneWorkerProfile,
  macbookWorkerProfile,
  zbookWorkerProfile,
} from "./initial-worker-profiles.ts";
import type {
  ResearchWorkerRunner,
  ResearchExecutionResult,
} from "./research-executor.ts";
import type { ResearchWorkKind } from "./research-control-plane.ts";
import type {
  WorkerCapability,
  WorkerDescriptor,
  WorkerExecutionMode,
  WorkerExecutionRequest,
  WorkerHealth,
} from "./worker-runtime.ts";

export type WorkerCapabilityHandlers = Partial<Record<WorkerCapability, CapabilityHandler>>;

interface ProfileRuntimeOptions {
  handlers: WorkerCapabilityHandlers;
  checkpoint?: WorkerCheckpointHooks;
  available?: () => boolean | Promise<boolean>;
  health?: () => Partial<Omit<WorkerHealth, "workerId" | "checkedAt" | "runtimeState">> | Promise<Partial<Omit<WorkerHealth, "workerId" | "checkedAt" | "runtimeState">>>;
}

function cloneProfile(profile: WorkerDescriptor): WorkerDescriptor {
  return {
    ...profile,
    capabilities: [...profile.capabilities],
    executionModes: profile.executionModes ? [...profile.executionModes] : undefined,
    persistence: profile.persistence ? { ...profile.persistence } : undefined,
    securityContext: profile.securityContext ? { ...profile.securityContext } : undefined,
    verifierHooks: profile.verifierHooks ? { ...profile.verifierHooks } : undefined,
  };
}

function createProfileRuntime(profile: WorkerDescriptor, options: ProfileRuntimeOptions): CommonWorkerRuntime {
  const runtime = new CommonWorkerRuntime({
    descriptor: cloneProfile(profile),
    runtimeVersion: "gai-phase3",
    checkpoint: options.checkpoint,
    available: options.available,
    health: options.health,
  });

  for (const [capability, handler] of Object.entries(options.handlers) as Array<[WorkerCapability, CapabilityHandler | undefined]>) {
    if (handler) runtime.registerCapability(capability, handler);
  }
  return runtime;
}

export function createZbookWorkerAdapter(options: ProfileRuntimeOptions): CommonWorkerRuntime {
  return createProfileRuntime(zbookWorkerProfile, options);
}

export function createMacbookWorkerAdapter(options: ProfileRuntimeOptions): CommonWorkerRuntime {
  return createProfileRuntime(macbookWorkerProfile, options);
}

export interface ResearchCapabilityHandlerOptions {
  runner: ResearchWorkerRunner;
  workerId: string;
  kind: Extract<ResearchWorkKind, "local-model" | "gpu">;
}

export function createResearchWorkerCapabilityHandler(options: ResearchCapabilityHandlerOptions): CapabilityHandler {
  return async (request) => {
    const result: ResearchExecutionResult = await options.runner.execute({
      id: request.task.id,
      query: request.input,
      kind: options.kind,
      route: {
        requestId: request.task.id,
        action: "run-worker",
        workerId: options.workerId,
        reason: "common worker runtime research capability adapter",
      },
      context: [],
    }, options.workerId);

    if (!result.ok) {
      const prefix = result.blocker ? `${result.blocker}: ` : "";
      throw new Error(`${prefix}${result.summary}`);
    }

    return {
      output: result.summary,
      evidence: {
        researchKind: options.kind,
        researchWorkerId: options.workerId,
        researchEvidence: result.evidence ?? null,
      },
    };
  };
}

export interface IosManagedExecutionRequest {
  taskId: string;
  capability: WorkerCapability;
  mode: Exclude<WorkerExecutionMode, "resident">;
  input: string;
}

export interface IosManagedExecutionResult {
  output: string;
  evidence?: Record<string, unknown>;
}

export interface IosManagedExecutionBridge {
  capabilities: WorkerCapability[];
  available?: () => boolean | Promise<boolean>;
  health?: () => Partial<Omit<WorkerHealth, "workerId" | "checkedAt" | "runtimeState">> | Promise<Partial<Omit<WorkerHealth, "workerId" | "checkedAt" | "runtimeState">>>;
  execute(request: IosManagedExecutionRequest): Promise<IosManagedExecutionResult>;
}

function resolveIosMode(request: WorkerExecutionRequest): Exclude<WorkerExecutionMode, "resident"> {
  const mode = request.requiredExecutionMode ?? "foreground";
  if (mode === "resident") {
    throw new Error("iPhone worker does not support resident daemon execution");
  }
  if (!iphoneWorkerProfile.executionModes?.includes(mode)) {
    throw new Error(`iPhone worker does not support execution mode ${mode}`);
  }
  return mode;
}

export function createIphoneWorkerAdapter(options: {
  bridge: IosManagedExecutionBridge;
  checkpoint?: WorkerCheckpointHooks;
}): CommonWorkerRuntime {
  const unsupported = options.bridge.capabilities.filter((capability) => !iphoneWorkerProfile.capabilities.includes(capability));
  if (unsupported.length > 0) {
    throw new Error(`iPhone bridge declares unsupported capabilities: ${unsupported.join(",")}`);
  }

  const handlers: WorkerCapabilityHandlers = {};
  for (const capability of options.bridge.capabilities) {
    handlers[capability] = async (request) => {
      const mode = resolveIosMode(request);
      const result = await options.bridge.execute({
        taskId: request.task.id,
        capability,
        mode,
        input: request.input,
      });
      return {
        output: result.output,
        evidence: {
          iosExecutionMode: mode,
          ...(result.evidence ?? {}),
        },
      };
    };
  }

  return createProfileRuntime(iphoneWorkerProfile, {
    handlers,
    checkpoint: options.checkpoint,
    available: options.bridge.available,
    health: options.bridge.health,
  });
}
