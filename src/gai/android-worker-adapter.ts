import { CommonWorkerRuntime, type CapabilityHandler, type WorkerCheckpointHooks } from "./common-worker-runtime.ts";
import type { WorkerCapability, WorkerDescriptor, WorkerExecutionMode, WorkerExecutionRequest, WorkerHealth } from "./worker-runtime.ts";

export const androidWorkerProfile: WorkerDescriptor = {
  id: "android-mobile-worker",
  label: "Android Mobile Worker",
  platform: "android",
  deviceType: "mobile",
  capabilities: ["local-model", "filesystem", "android-tooling", "camera", "gps", "sensors"],
  executionModes: ["foreground", "background-scheduled", "deferred"],
  networkRequirement: "offline-capable",
  maxParallelTasks: 1,
  enabled: true,
  persistence: { localState: true, durableCheckpoint: true, offlineQueue: true },
  securityContext: { credentialIsolation: true, leastPrivilege: true, humanGateEnforced: true },
  verifierHooks: { preflight: true, postExecution: true, evidenceCapture: true },
};

export interface AndroidManagedExecutionRequest {
  taskId: string;
  capability: WorkerCapability;
  mode: Exclude<WorkerExecutionMode, "resident">;
  input: string;
}

export interface AndroidManagedExecutionResult {
  output: string;
  evidence?: Record<string, unknown>;
}

export interface AndroidManagedExecutionBridge {
  capabilities: WorkerCapability[];
  available?: () => boolean | Promise<boolean>;
  health?: () => Partial<Omit<WorkerHealth, "workerId" | "checkedAt" | "runtimeState">> | Promise<Partial<Omit<WorkerHealth, "workerId" | "checkedAt" | "runtimeState">>>;
  execute(request: AndroidManagedExecutionRequest): Promise<AndroidManagedExecutionResult>;
}

function resolveAndroidMode(request: WorkerExecutionRequest): Exclude<WorkerExecutionMode, "resident"> {
  const mode = request.requiredExecutionMode ?? "foreground";
  if (mode === "resident") throw new Error("Android mobile adapter does not claim unrestricted resident execution");
  if (!androidWorkerProfile.executionModes?.includes(mode)) throw new Error(`Android worker does not support execution mode ${mode}`);
  return mode;
}

export function createAndroidWorkerAdapter(options: { bridge: AndroidManagedExecutionBridge; checkpoint?: WorkerCheckpointHooks }): CommonWorkerRuntime {
  const unsupported = options.bridge.capabilities.filter((capability) => !androidWorkerProfile.capabilities.includes(capability));
  if (unsupported.length > 0) throw new Error(`Android bridge declares unsupported capabilities: ${unsupported.join(",")}`);

  const runtime = new CommonWorkerRuntime({
    descriptor: { ...androidWorkerProfile, capabilities: [...androidWorkerProfile.capabilities], executionModes: [...(androidWorkerProfile.executionModes ?? [])], persistence: { ...androidWorkerProfile.persistence }, securityContext: { ...androidWorkerProfile.securityContext }, verifierHooks: { ...androidWorkerProfile.verifierHooks } },
    runtimeVersion: "gai-phase14",
    checkpoint: options.checkpoint,
    available: options.bridge.available,
    health: options.bridge.health,
  });

  for (const capability of options.bridge.capabilities) {
    const handler: CapabilityHandler = async (request) => {
      const mode = resolveAndroidMode(request);
      const result = await options.bridge.execute({ taskId: request.task.id, capability, mode, input: request.input });
      return { output: result.output, evidence: { androidExecutionMode: mode, ...(result.evidence ?? {}) } };
    };
    runtime.registerCapability(capability, handler);
  }
  return runtime;
}
