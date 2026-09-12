export const JARVIS_MAX_NODES = 100;

export type JarvisNodeKind = "android" | "ios" | "windows" | "macos" | "linux" | "cloud";
export type JarvisConnectionMode = "full-online" | "lan-only" | "mobile-offline" | "pc-offline" | "full-offline";
export type JarvisNodeStatus = "ready" | "busy" | "offline" | "locked" | "needs-human" | "disabled";
export type JarvisTaskStatus =
  | "queued"
  | "leased"
  | "running"
  | "waiting-connectivity"
  | "waiting-human"
  | "completed"
  | "failed"
  | "cancelled";

export type JarvisCapability =
  | "browser"
  | "open-url"
  | "filesystem"
  | "camera"
  | "gps"
  | "bluetooth"
  | "local-model"
  | "speech-to-text"
  | "text-to-speech"
  | "gpu"
  | "remote-view"
  | "remote-control"
  | "wake-device"
  | "background-worker"
  | "long-running";

export interface JarvisNodePolicy {
  allowPaidServices: false;
  allowDestructiveActions: boolean;
  allowExternalPublication: boolean;
  allowRemoteControl: boolean;
  requireHumanForLockedDevice: boolean;
}

export interface JarvisNodeTelemetry {
  batteryPercent?: number;
  charging?: boolean;
  temperatureC?: number;
  freeStorageMb?: number;
  cpuLoadPercent?: number;
  gpuLoadPercent?: number;
  network?: "wifi" | "cellular" | "lan" | "offline";
  checkedAt: string;
}

export interface JarvisNode {
  id: string;
  label: string;
  kind: JarvisNodeKind;
  status: JarvisNodeStatus;
  capabilities: JarvisCapability[];
  policy: JarvisNodePolicy;
  telemetry: JarvisNodeTelemetry;
  enrollment: "quick" | "full";
  group?: string;
  lastSeenAt: string;
}

export interface JarvisTask {
  id: string;
  idempotencyKey: string;
  type: string;
  payload: Record<string, unknown>;
  status: JarvisTaskStatus;
  requiredCapabilities: JarvisCapability[];
  preferredKinds?: JarvisNodeKind[];
  priority: "urgent" | "high" | "normal" | "low" | "background";
  requiresOnline: boolean;
  targetNodeId?: string;
  assignedNodeId?: string;
  leaseUntil?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface JarvisConnectionSnapshot {
  mobileOnline: boolean;
  pcOnline: boolean;
  sameLanAvailable: boolean;
}

export interface JarvisRouteDecision {
  mode: JarvisConnectionMode;
  transport: "internet" | "lan" | "local" | "queue";
  canExecuteOnlineTasks: boolean;
  shouldQueueRemoteWork: boolean;
}

export interface JarvisEnrollmentToken {
  token: string;
  mode: "quick" | "full" | "fleet";
  expiresAt: string;
  maxDevices: number;
  usedDevices: number;
  group?: string;
}

export interface JarvisTakeoverSession {
  id: string;
  nodeId: string;
  taskId?: string;
  status: "requested" | "active" | "resolved" | "cancelled";
  reason: string;
  lastAction?: string;
  currentUrl?: string;
  appName?: string;
  screenshotRef?: string;
  createdAt: string;
  updatedAt: string;
}
