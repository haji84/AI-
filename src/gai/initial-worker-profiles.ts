import type { WorkerDescriptor } from "./worker-runtime.ts";

export const zbookWorkerProfile: WorkerDescriptor = {
  id: "zbook",
  label: "ZBook",
  platform: "windows",
  deviceType: "laptop",
  capabilities: [
    "local-model",
    "gpu",
    "windows-tooling",
    "browser",
    "filesystem",
    "long-running",
    "local-storage",
    "local-inference",
    "offline-cache",
  ],
  executionModes: ["resident", "foreground", "deferred"],
  networkRequirement: "offline-capable",
  persistence: {
    localState: true,
    checkpointResume: true,
    offlineQueue: true,
  },
  securityContext: {
    credentialIsolation: true,
    taskScopedAuthorization: true,
    acceptsRemoteSecrets: false,
  },
  verifierHooks: {
    healthEvidence: true,
    executionEvidence: true,
    artifactEvidence: true,
    stateEvidence: true,
  },
  maxParallelTasks: 1,
  enabled: true,
};

export const macbookWorkerProfile: WorkerDescriptor = {
  id: "macbook",
  label: "MacBook",
  platform: "macos",
  deviceType: "laptop",
  capabilities: [
    "local-model",
    "macos-tooling",
    "browser",
    "filesystem",
    "long-running",
    "local-storage",
    "local-inference",
    "offline-cache",
  ],
  executionModes: ["resident", "foreground", "deferred"],
  networkRequirement: "offline-capable",
  persistence: {
    localState: true,
    checkpointResume: true,
    offlineQueue: true,
  },
  securityContext: {
    credentialIsolation: true,
    taskScopedAuthorization: true,
    acceptsRemoteSecrets: false,
  },
  verifierHooks: {
    healthEvidence: true,
    executionEvidence: true,
    artifactEvidence: true,
    stateEvidence: true,
  },
  maxParallelTasks: 1,
  enabled: true,
};

export const iphoneWorkerProfile: WorkerDescriptor = {
  id: "iphone",
  label: "iPhone",
  platform: "ios",
  deviceType: "mobile",
  capabilities: [
    "ios-tooling",
    "camera",
    "gps",
    "sensors",
    "local-storage",
    "local-inference",
    "offline-cache",
    "background-task",
  ],
  executionModes: ["foreground", "background-scheduled", "background-continued", "deferred"],
  networkRequirement: "offline-preferred",
  persistence: {
    localState: true,
    checkpointResume: true,
    offlineQueue: true,
  },
  securityContext: {
    credentialIsolation: true,
    taskScopedAuthorization: true,
    acceptsRemoteSecrets: false,
  },
  verifierHooks: {
    healthEvidence: true,
    executionEvidence: true,
    artifactEvidence: true,
    stateEvidence: true,
  },
  maxParallelTasks: 1,
  enabled: true,
};

export const initialWorkerProfiles = [zbookWorkerProfile, macbookWorkerProfile, iphoneWorkerProfile] as const;
