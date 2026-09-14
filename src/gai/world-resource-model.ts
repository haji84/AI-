import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ContextItem } from "../orchestrator/goal-loop.ts";
import type {
  WorkerCapability,
  WorkerConnectivity,
  WorkerDescriptor,
  WorkerExecutionMode,
  WorkerHealth,
  WorkerPlatform,
  WorkerResourceSnapshot,
} from "./worker-runtime.ts";

export type ResourceKnowledgeState = "fresh" | "stale" | "unknown";

export interface WorldResourceObservation {
  workerId: string;
  platform: WorkerPlatform;
  label?: string;
  available: boolean;
  enabled: boolean;
  connectivity: WorkerConnectivity | "unknown";
  capabilities: WorkerCapability[];
  executionModes: WorkerExecutionMode[];
  maxParallelTasks: number;
  activeTasks?: number;
  resources: WorkerResourceSnapshot;
  observedAt: string;
  expiresAt: string;
  confidence: number;
  provenance: string[];
  detail?: string;
}

export interface WorldResourceView extends WorldResourceObservation {
  knowledgeState: ResourceKnowledgeState;
  ageMs: number;
}

interface WorldResourceFile {
  version: 1;
  observations: WorldResourceObservation[];
}

export interface WorldResourceSnapshot {
  generatedAt: string;
  workers: WorldResourceView[];
}

export interface WorldResourceQuery {
  capability?: WorkerCapability;
  platform?: WorkerPlatform;
  executionMode?: WorkerExecutionMode;
  connectivity?: WorkerConnectivity;
  requireGpu?: boolean;
  minMemoryAvailableMb?: number;
  minDiskAvailableMb?: number;
  allowStale?: boolean;
  includeUnavailable?: boolean;
}

function iso(value: Date): string {
  return value.toISOString();
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) throw new Error("resource observation confidence must be finite");
  return Math.max(0, Math.min(1, value));
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function parseTime(value: string, name: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${name} must be an ISO timestamp`);
  return time;
}

function viewOf(observation: WorldResourceObservation, now: Date): WorldResourceView {
  const observedAt = parseTime(observation.observedAt, "observedAt");
  const expiresAt = parseTime(observation.expiresAt, "expiresAt");
  const nowMs = now.getTime();
  const knowledgeState: ResourceKnowledgeState = nowMs > expiresAt ? "stale" : "fresh";
  return {
    ...observation,
    capabilities: [...observation.capabilities],
    executionModes: [...observation.executionModes],
    provenance: [...observation.provenance],
    resources: { ...observation.resources },
    knowledgeState,
    ageMs: Math.max(0, nowMs - observedAt),
  };
}

function unavailableUnknown(workerId: string, now: Date): WorldResourceView {
  return {
    workerId,
    platform: "linux",
    available: false,
    enabled: false,
    connectivity: "unknown",
    capabilities: [],
    executionModes: [],
    maxParallelTasks: 0,
    resources: {},
    observedAt: iso(now),
    expiresAt: iso(now),
    confidence: 0,
    provenance: ["missing-observation"],
    knowledgeState: "unknown",
    ageMs: 0,
  };
}

export function observationFromWorker(input: {
  descriptor: WorkerDescriptor;
  health: WorkerHealth;
  ttlMs?: number;
  confidence?: number;
  provenance?: string[];
  now?: Date;
}): WorldResourceObservation {
  const now = input.now ?? new Date();
  const checkedAtMs = parseTime(input.health.checkedAt, "health.checkedAt");
  const ttlMs = input.ttlMs ?? 60_000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be positive");
  const observedAt = new Date(Math.min(now.getTime(), checkedAtMs));
  const expiresAt = new Date(observedAt.getTime() + ttlMs);
  return {
    workerId: input.descriptor.id,
    platform: input.descriptor.platform,
    label: input.descriptor.label,
    available: Boolean(input.descriptor.enabled && input.health.available),
    enabled: input.descriptor.enabled,
    connectivity: input.health.connectivity ?? "unknown",
    capabilities: unique(input.descriptor.capabilities),
    executionModes: unique(input.health.executionModes ?? input.descriptor.executionModes ?? ["resident"]),
    maxParallelTasks: input.descriptor.maxParallelTasks,
    activeTasks: input.health.runtimeState?.activeTasks,
    resources: { ...(input.health.resources ?? {}) },
    observedAt: iso(observedAt),
    expiresAt: iso(expiresAt),
    confidence: clampConfidence(input.confidence ?? 1),
    provenance: unique(input.provenance?.length ? input.provenance : ["worker-health"]),
    detail: input.health.detail,
  };
}

function matches(view: WorldResourceView, query: WorldResourceQuery): boolean {
  if (!query.allowStale && view.knowledgeState !== "fresh") return false;
  if (!query.includeUnavailable && !view.available) return false;
  if (query.capability && !view.capabilities.includes(query.capability)) return false;
  if (query.platform && view.platform !== query.platform) return false;
  if (query.executionMode && !view.executionModes.includes(query.executionMode)) return false;
  if (query.connectivity && view.connectivity !== query.connectivity) return false;
  if (query.requireGpu && view.resources.gpuAvailable !== true) return false;
  if (query.minMemoryAvailableMb !== undefined && (view.resources.memoryAvailableMb ?? -1) < query.minMemoryAvailableMb) return false;
  if (query.minDiskAvailableMb !== undefined && (view.resources.diskAvailableMb ?? -1) < query.minDiskAvailableMb) return false;
  return true;
}

function score(view: WorldResourceView): number {
  const capacity = Math.max(0, view.maxParallelTasks - (view.activeTasks ?? 0));
  const connectivity = view.connectivity === "online" ? 2 : view.connectivity === "recovering" ? 1 : 0;
  const power = view.resources.onExternalPower === true ? 1 : 0;
  const gpu = view.resources.gpuAvailable === true ? 1 : 0;
  return view.confidence * 10 + capacity * 2 + connectivity + power + gpu;
}

export class PersistentWorldResourceModel {
  private readonly filePath: string;
  private readonly observations = new Map<string, WorldResourceObservation>();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as WorldResourceFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.observations)) throw new Error("unsupported world resource file");
      for (const observation of parsed.observations) {
        parseTime(observation.observedAt, "observedAt");
        parseTime(observation.expiresAt, "expiresAt");
        this.observations.set(observation.workerId, {
          ...observation,
          capabilities: unique(observation.capabilities ?? []),
          executionModes: unique(observation.executionModes ?? []),
          provenance: unique(observation.provenance ?? []),
          resources: { ...(observation.resources ?? {}) },
          confidence: clampConfidence(observation.confidence),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  async observe(observation: WorldResourceObservation): Promise<WorldResourceObservation> {
    await this.ensureLoaded();
    parseTime(observation.observedAt, "observedAt");
    parseTime(observation.expiresAt, "expiresAt");
    const next: WorldResourceObservation = {
      ...observation,
      capabilities: unique(observation.capabilities),
      executionModes: unique(observation.executionModes),
      provenance: unique(observation.provenance),
      resources: { ...observation.resources },
      confidence: clampConfidence(observation.confidence),
    };
    const current = this.observations.get(next.workerId);
    if (current && Date.parse(current.observedAt) > Date.parse(next.observedAt)) return current;
    this.observations.set(next.workerId, next);
    await this.persist();
    return { ...next, resources: { ...next.resources } };
  }

  async observeWorker(input: Parameters<typeof observationFromWorker>[0]): Promise<WorldResourceObservation> {
    return this.observe(observationFromWorker(input));
  }

  async get(workerId: string, now = new Date()): Promise<WorldResourceView> {
    await this.ensureLoaded();
    const observation = this.observations.get(workerId);
    return observation ? viewOf(observation, now) : unavailableUnknown(workerId, now);
  }

  async snapshot(now = new Date()): Promise<WorldResourceSnapshot> {
    await this.ensureLoaded();
    return {
      generatedAt: iso(now),
      workers: [...this.observations.values()]
        .map((observation) => viewOf(observation, now))
        .sort((left, right) => left.workerId.localeCompare(right.workerId)),
    };
  }

  async query(query: WorldResourceQuery = {}, now = new Date()): Promise<WorldResourceView[]> {
    const snapshot = await this.snapshot(now);
    return snapshot.workers
      .filter((worker) => matches(worker, query))
      .sort((left, right) => score(right) - score(left) || left.workerId.localeCompare(right.workerId));
  }

  async plannerContext(now = new Date()): Promise<ContextItem> {
    const snapshot = await this.snapshot(now);
    const fresh = snapshot.workers.filter((worker) => worker.knowledgeState === "fresh");
    const connectivity = fresh.length === 0
      ? "unknown"
      : fresh.some((worker) => worker.connectivity === "online")
        ? "online"
        : fresh.some((worker) => worker.connectivity === "recovering")
          ? "recovering"
          : fresh.some((worker) => worker.connectivity === "degraded")
            ? "degraded"
            : "offline";

    const capabilityMap = new Map<string, { available: boolean; networkRequirement: "offline-capable" | "online-required" | "unknown"; resources: string[]; reason?: string }>();
    for (const worker of fresh) {
      for (const capability of worker.capabilities) {
        const existing = capabilityMap.get(capability);
        const available = worker.available;
        const networkRequirement = worker.connectivity === "unknown" ? "unknown" : "offline-capable";
        const resources: string[] = [];
        if (capability === "gpu") resources.push("gpu");
        if (!existing || (available && !existing.available)) {
          capabilityMap.set(capability, {
            available,
            networkRequirement,
            resources,
            ...(available ? {} : { reason: worker.detail || "no fresh available worker" }),
          });
        }
      }
    }

    const resources = [
      {
        resource: "gpu",
        available: fresh.some((worker) => worker.available && worker.resources.gpuAvailable === true),
      },
      {
        resource: "cpu",
        available: fresh.some((worker) => worker.available && worker.resources.cpuAvailable !== false),
      },
    ];

    return {
      source: "world.resource.snapshot",
      summary: `workers=${snapshot.workers.length}; fresh=${fresh.length}; connectivity=${connectivity}; stale=${snapshot.workers.length - fresh.length}`,
      data: {
        connectivity,
        capabilities: [...capabilityMap.entries()].map(([capability, state]) => ({ capability, ...state })),
        resources,
        workers: snapshot.workers.map((worker) => ({
          workerId: worker.workerId,
          platform: worker.platform,
          available: worker.available,
          connectivity: worker.connectivity,
          capabilities: worker.capabilities,
          executionModes: worker.executionModes,
          resources: worker.resources,
          activeTasks: worker.activeTasks,
          maxParallelTasks: worker.maxParallelTasks,
          knowledgeState: worker.knowledgeState,
          confidence: worker.confidence,
          observedAt: worker.observedAt,
          provenance: worker.provenance,
        })),
      },
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: WorldResourceFile = { version: 1, observations: [...this.observations.values()] };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
