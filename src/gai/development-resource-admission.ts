import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { acquireCognitiveLease } from "./cognitive-lease.ts";
import { probeWorkerResources } from "./worker-resource-probe.ts";
import type { WorkerResourceObservation } from "./worker-resource-probe.ts";
import { evaluateWorkerResourcePlacement } from "./worker-runtime.ts";
import type { WorkerResourceSnapshot } from "./worker-runtime.ts";

export interface ResourceWaitOutcome {
  status: "WAITING_FOR_RESOURCE";
  reason: string;
  retryAfterMs: number;
  observedAt: string;
  resources?: WorkerResourceSnapshot;
}

export class ResourceWaitError extends Error {
  readonly outcome: ResourceWaitOutcome;
  constructor(outcome: ResourceWaitOutcome) {
    super(`${outcome.status}: ${outcome.reason}`);
    this.name = "ResourceWaitError";
    this.outcome = outcome;
  }
}

export interface DevelopmentResourceAdmissionOptions {
  kind?: "build" | "verify" | "local-model";
  directory?: string;
  probe?: (options: { platform: NodeJS.Platform; directory?: string }) => Promise<WorkerResourceObservation>;
  leasePath?: string;
  now?: () => Date;
  platform?: NodeJS.Platform;
}

/** One common lane per OS user, shared by repository checkouts and all heavy job kinds.
 * It does not coordinate separate OS identities or remote machines.
 */
function defaultLeasePath(platform: NodeJS.Platform): string {
  const root = platform === "win32"
    ? process.env.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local")
    : platform === "darwin" ? join(homedir(), "Library", "Application Support")
      : process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(root, "GAIWorker", "development-heavy.lock");
}

function safeResources(resources: WorkerResourceSnapshot): WorkerResourceSnapshot {
  const safe: WorkerResourceSnapshot = {};
  for (const key of ["cpuLoadPercent", "gpuLoadPercent", "memoryAvailableMb", "diskAvailableMb", "committedMemoryMb", "commitLimitMb", "diskLoadPercent", "gpuMemoryAvailableMb"] as const) {
    const value = resources[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = value;
  }
  for (const key of ["cpuAvailable", "gpuAvailable"] as const) {
    if (typeof resources[key] === "boolean") safe[key] = resources[key];
  }
  return safe;
}

/** Yield once on pressure/contention; the existing durable scheduler owns retry timing. */
export async function withDevelopmentResourceAdmission<T>(work: () => Promise<T>, options: DevelopmentResourceAdmissionOptions = {}): Promise<T> {
  const now = options.now ?? (() => new Date());
  const platform = options.platform ?? process.platform;
  const wait = (reason: string, observation?: WorkerResourceObservation): ResourceWaitError => new ResourceWaitError({
    status: "WAITING_FOR_RESOURCE", reason, retryAfterMs: 30000,
    observedAt: observation && Number.isFinite(Date.parse(observation.checkedAt)) ? observation.checkedAt : now().toISOString(),
    ...(observation ? { resources: safeResources(observation.resources) } : {}),
  });
  const path = options.leasePath ?? defaultLeasePath(platform);
  let release: () => Promise<void>;
  try {
    await mkdir(dirname(path), { recursive: true });
    release = await acquireCognitiveLease(path);
  } catch { throw wait("heavy execution lane unavailable"); }
  try {
    let observation: WorkerResourceObservation;
    try {
      observation = await (options.probe ?? probeWorkerResources)({ platform, directory: options.directory });
      if (!observation || !observation.resources || typeof observation.resources !== "object" || Array.isArray(observation.resources)) {
        throw new Error("invalid resource observation");
      }
    } catch { throw wait("resource telemetry unavailable"); }
    const measuredAt = Date.parse(observation.checkedAt), current = now().getTime();
    if (!Number.isFinite(measuredAt) || measuredAt > current || current - measuredAt > 15000) {
      throw wait("resource telemetry stale or invalid", observation);
    }
    const resources = observation.resources;
    const gpuObserved = resources.gpuAvailable === true || resources.gpuLoadPercent !== undefined || resources.gpuMemoryAvailableMb !== undefined;
    const placement = evaluateWorkerResourcePlacement({
      resources, gpuCapable: gpuObserved,
      requirements: {
        minMemoryAvailableMb: 2048, minDiskAvailableMb: 8192, maxCpuLoadPercent: 90,
        ...(platform === "win32" ? { maxCommitPercent: 85 } : {}),
        ...(resources.diskLoadPercent !== undefined ? { maxDiskLoadPercent: 90 } : {}),
        ...(gpuObserved ? { maxGpuLoadPercent: 90, minGpuMemoryAvailableMb: 256 } : {}),
      },
    });
    if (!placement.eligible) throw wait(placement.reasons.join("; "), observation);
    return await work();
  } finally { await release(); }
}
