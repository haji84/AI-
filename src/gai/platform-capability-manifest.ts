import type {
  WorkerCapability,
  WorkerDescriptor,
  WorkerExecutionMode,
  WorkerPlatform,
} from "./worker-runtime.ts";

export interface PlatformCapabilityManifest {
  schemaVersion: 1;
  platform: WorkerPlatform;
  toolingCapability: WorkerCapability | null;
  prohibitedToolingCapabilities: readonly WorkerCapability[];
  sharedCapabilities: readonly WorkerCapability[];
}

export interface WorkerPlatformCapabilityManifest {
  schemaVersion: 1;
  workerId: string;
  platform: WorkerPlatform;
  capabilities: readonly WorkerCapability[];
  executionModes: readonly WorkerExecutionMode[];
  networkRequirement: WorkerDescriptor["networkRequirement"] | null;
}

export const SHARED_WORKER_CAPABILITIES = Object.freeze([
  "local-model",
  "gpu",
  "code-builder",
  "browser",
  "filesystem",
  "long-running",
  "camera",
  "gps",
  "sensors",
  "local-storage",
  "local-inference",
  "offline-cache",
  "background-task",
] satisfies WorkerCapability[]);

export const PLATFORM_TOOLING_CAPABILITIES = Object.freeze({
  windows: "windows-tooling",
  macos: "macos-tooling",
  ios: "ios-tooling",
  android: "android-tooling",
  linux: null,
} satisfies Record<WorkerPlatform, WorkerCapability | null>);

const platformToolingEntries = Object.entries(PLATFORM_TOOLING_CAPABILITIES) as Array<
  [WorkerPlatform, WorkerCapability | null]
>;

const toolingOwner = new Map<WorkerCapability, WorkerPlatform>(
  platformToolingEntries
    .filter((entry): entry is [WorkerPlatform, WorkerCapability] => entry[1] !== null)
    .map(([platform, capability]): [WorkerCapability, WorkerPlatform] => [capability, platform]),
);

const knownCapabilities = new Set<string>([
  ...SHARED_WORKER_CAPABILITIES,
  ...platformToolingEntries.flatMap(([, capability]) => (capability ? [capability] : [])),
]);

function createPlatformManifest(platform: WorkerPlatform): PlatformCapabilityManifest {
  const toolingCapability = PLATFORM_TOOLING_CAPABILITIES[platform];
  return Object.freeze({
    schemaVersion: 1 as const,
    platform,
    toolingCapability,
    prohibitedToolingCapabilities: Object.freeze(
      platformToolingEntries
        .filter(([owner, capability]) => owner !== platform && capability !== null)
        .map(([, capability]) => capability as WorkerCapability)
        .sort(),
    ),
    sharedCapabilities: SHARED_WORKER_CAPABILITIES,
  });
}

export const PLATFORM_CAPABILITY_MANIFESTS: Readonly<Record<WorkerPlatform, PlatformCapabilityManifest>> =
  Object.freeze({
    windows: createPlatformManifest("windows"),
    macos: createPlatformManifest("macos"),
    ios: createPlatformManifest("ios"),
    android: createPlatformManifest("android"),
    linux: createPlatformManifest("linux"),
  });

export function platformCapabilityManifestFor(platform: WorkerPlatform): PlatformCapabilityManifest {
  return PLATFORM_CAPABILITY_MANIFESTS[platform];
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated].sort();
}

export function validateWorkerDescriptorAgainstPlatformManifest(descriptor: WorkerDescriptor): string[] {
  const errors: string[] = [];
  const workerId = descriptor.id.trim();
  if (!workerId) errors.push("worker id must be non-empty");

  const rawCapabilities = descriptor.capabilities as readonly string[];
  for (const capability of duplicates(rawCapabilities)) {
    errors.push(`duplicate capability ${capability}`);
  }

  for (const capability of rawCapabilities) {
    if (!knownCapabilities.has(capability)) {
      errors.push(`unknown capability ${capability}`);
      continue;
    }
    const owner = toolingOwner.get(capability as WorkerCapability);
    if (owner && owner !== descriptor.platform) {
      errors.push(`capability ${capability} belongs to ${owner}, not ${descriptor.platform}`);
    }
  }

  const modes = (descriptor.executionModes ?? []) as readonly string[];
  for (const mode of duplicates(modes)) {
    errors.push(`duplicate execution mode ${mode}`);
  }

  return [...new Set(errors)].sort();
}

export function assertWorkerDescriptorMatchesPlatformManifest(descriptor: WorkerDescriptor): void {
  const errors = validateWorkerDescriptorAgainstPlatformManifest(descriptor);
  if (errors.length > 0) {
    throw new Error(
      `Invalid platform capability manifest for worker ${descriptor.id || "<unknown>"}: ${errors.join("; ")}`,
    );
  }
}

export function buildWorkerPlatformCapabilityManifest(
  descriptor: WorkerDescriptor,
): WorkerPlatformCapabilityManifest {
  assertWorkerDescriptorMatchesPlatformManifest(descriptor);
  return Object.freeze({
    schemaVersion: 1 as const,
    workerId: descriptor.id,
    platform: descriptor.platform,
    capabilities: Object.freeze([...descriptor.capabilities].sort()),
    executionModes: Object.freeze([...(descriptor.executionModes ?? [])].sort()),
    networkRequirement: descriptor.networkRequirement ?? null,
  });
}
