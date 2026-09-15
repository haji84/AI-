import type {
  WorkerCapability,
  WorkerExecutionMode,
  WorkerExecutionRequest,
  WorkerExecutionResult,
  WorkerPlatform,
} from "./worker-runtime.ts";
import { MultiWorkerRuntime } from "./worker-runtime.ts";
import type { TaskProfile } from "./types.ts";

export type DeviceCapability = Extract<
  WorkerCapability,
  "browser" | "filesystem" | "windows-tooling" | "macos-tooling" | "ios-tooling" | "camera" | "gps" | "sensors"
>;

export interface DeviceCapabilityRequest {
  task: TaskProfile;
  capability: DeviceCapability;
  operation: string;
  input?: Record<string, unknown>;
  preferredPlatform?: WorkerPlatform;
  executionMode?: WorkerExecutionMode;
  connectivity?: "online" | "degraded" | "offline" | "recovering";
  allowOffline?: boolean;
  excludedWorkerIds?: string[];
}

export interface DeviceCapabilityEvidence {
  schema: "gai.device-capability.v1";
  capability: DeviceCapability;
  operation: string;
  workerId: string;
  platform: WorkerPlatform;
  executionMode?: WorkerExecutionMode;
  connectivity?: DeviceCapabilityRequest["connectivity"];
  verifiedByWorkerEvidence: boolean;
  workerEvidence?: Record<string, unknown>;
}

const OPERATIONS: Record<DeviceCapability, readonly string[]> = {
  browser: ["navigate", "read", "interact", "download"],
  filesystem: ["read", "write", "list", "copy", "move"],
  "windows-tooling": ["shell", "app", "office", "ui"],
  "macos-tooling": ["shell", "app", "office", "ui"],
  "ios-tooling": ["open-url", "open-app", "device-status", "local-state"],
  camera: ["capture"],
  gps: ["read-location"],
  sensors: ["read"],
};

const PLATFORM_REQUIREMENTS: Partial<Record<DeviceCapability, readonly WorkerPlatform[]>> = {
  "windows-tooling": ["windows"],
  "macos-tooling": ["macos"],
  "ios-tooling": ["ios"],
  camera: ["ios", "android"],
  gps: ["ios", "android"],
  sensors: ["ios", "android"],
};

function assertRequest(request: DeviceCapabilityRequest): void {
  if (!request.operation.trim()) throw new Error("Device capability operation is required");
  if (!OPERATIONS[request.capability].includes(request.operation)) {
    throw new Error(`Unsupported ${request.capability} operation: ${request.operation}`);
  }
  const platforms = PLATFORM_REQUIREMENTS[request.capability];
  if (request.preferredPlatform && platforms && !platforms.includes(request.preferredPlatform)) {
    throw new Error(`${request.capability} is not supported on ${request.preferredPlatform}`);
  }
  if (request.preferredPlatform === "ios" && request.executionMode === "resident") {
    throw new Error("iOS capability execution cannot use resident mode");
  }
}

export class DeviceCapabilityRuntime {
  private readonly workers: MultiWorkerRuntime;

  constructor(workers: MultiWorkerRuntime) {
    this.workers = workers;
  }

  async execute(request: DeviceCapabilityRequest): Promise<{ result: WorkerExecutionResult; evidence: DeviceCapabilityEvidence }> {
    assertRequest(request);
    const payload = JSON.stringify({
      schema: "gai.device-capability.request.v1",
      capability: request.capability,
      operation: request.operation,
      input: request.input ?? {},
    });
    const executionRequest: WorkerExecutionRequest = {
      task: request.task,
      input: payload,
      requestedCapability: request.capability,
      requiredCapabilities: [request.capability],
      preferredPlatform: request.preferredPlatform,
      requiredExecutionMode: request.executionMode,
      connectivity: request.connectivity,
      allowOffline: request.allowOffline,
      excludedWorkerIds: request.excludedWorkerIds,
    };
    const result = await this.workers.execute(executionRequest);
    const platforms = PLATFORM_REQUIREMENTS[request.capability];
    if (platforms && !platforms.includes(result.platform)) {
      throw new Error(`Worker ${result.workerId} returned invalid platform ${result.platform} for ${request.capability}`);
    }
    const evidence: DeviceCapabilityEvidence = {
      schema: "gai.device-capability.v1",
      capability: request.capability,
      operation: request.operation,
      workerId: result.workerId,
      platform: result.platform,
      executionMode: request.executionMode,
      connectivity: request.connectivity,
      verifiedByWorkerEvidence: Boolean(result.evidence),
      workerEvidence: result.evidence,
    };
    return { result, evidence };
  }
}
