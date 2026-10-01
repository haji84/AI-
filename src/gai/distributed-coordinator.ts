import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CoordinatorCandidate {
  nodeId: string;
  available: boolean;
  eligible: boolean;
  score: number;
  observedAt: string;
  reason?: string;
}

export interface CoordinatorLease {
  clusterId: string;
  coordinatorId: string;
  epoch: number;
  fencingToken: string;
  leaseUntil: string;
  issuedAt: string;
  updatedAt: string;
}

export interface CoordinatorClaim {
  clusterId: string;
  coordinatorId: string;
  epoch: number;
  fencingToken: string;
  leaseUntil: string;
}

export interface CoordinatorStore {
  load(): Promise<CoordinatorLease | null>;
  save(lease: CoordinatorLease): Promise<void>;
}

export class MemoryCoordinatorStore implements CoordinatorStore {
  private lease: CoordinatorLease | null = null;

  async load(): Promise<CoordinatorLease | null> {
    return this.lease ? structuredClone(this.lease) : null;
  }

  async save(lease: CoordinatorLease): Promise<void> {
    this.lease = structuredClone(lease);
  }
}

export class JsonFileCoordinatorStore implements CoordinatorStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<CoordinatorLease | null> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as CoordinatorLease;
      assertLease(parsed);
      return structuredClone(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(lease: CoordinatorLease): Promise<void> {
    assertLease(lease);
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}

function timestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an ISO timestamp`);
  return parsed;
}

function assertLease(lease: CoordinatorLease): void {
  if (!lease.clusterId?.trim()) throw new Error("clusterId is required");
  if (!lease.coordinatorId?.trim()) throw new Error("coordinatorId is required");
  if (!Number.isInteger(lease.epoch) || lease.epoch < 1) throw new Error("coordinator epoch must be a positive integer");
  if (!lease.fencingToken?.trim()) throw new Error("coordinator fencingToken is required");
  timestamp(lease.leaseUntil, "leaseUntil");
  timestamp(lease.issuedAt, "issuedAt");
  timestamp(lease.updatedAt, "updatedAt");
}

function assertCandidates(candidates: readonly CoordinatorCandidate[]): void {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.nodeId.trim()) throw new Error("coordinator candidate nodeId is required");
    if (seen.has(candidate.nodeId)) throw new Error(`duplicate coordinator candidate ${candidate.nodeId}`);
    seen.add(candidate.nodeId);
    if (!Number.isFinite(candidate.score)) throw new Error(`invalid coordinator score for ${candidate.nodeId}`);
    timestamp(candidate.observedAt, "candidate.observedAt");
  }
}

function claimOf(lease: CoordinatorLease): CoordinatorClaim {
  return {
    clusterId: lease.clusterId,
    coordinatorId: lease.coordinatorId,
    epoch: lease.epoch,
    fencingToken: lease.fencingToken,
    leaseUntil: lease.leaseUntil,
  };
}

function eligibleCandidates(candidates: readonly CoordinatorCandidate[]): CoordinatorCandidate[] {
  return candidates
    .filter((candidate) => candidate.available && candidate.eligible)
    .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
}

export function coordinatorCandidateScore(input: {
  confidence?: number;
  maxParallelTasks?: number;
  activeTasks?: number;
  onExternalPower?: boolean;
  memoryAvailableMb?: number;
  connectivity?: "online" | "recovering" | "degraded" | "offline" | "unknown";
}): number {
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence)
    ? Math.max(0, Math.min(1, input.confidence))
    : 0;
  const max = Number.isInteger(input.maxParallelTasks) && (input.maxParallelTasks ?? 0) > 0
    ? input.maxParallelTasks!
    : 1;
  const active = Number.isInteger(input.activeTasks) && (input.activeTasks ?? 0) >= 0
    ? Math.min(input.activeTasks!, max)
    : 0;
  const capacity = Math.max(0, max - active);
  const connectivity = input.connectivity === "online"
    ? 4
    : input.connectivity === "recovering"
      ? 3
      : input.connectivity === "degraded"
        ? 2
        : input.connectivity === "offline"
          ? 1
          : 0;
  const power = input.onExternalPower === true ? 2 : 0;
  const memory = typeof input.memoryAvailableMb === "number" && Number.isFinite(input.memoryAvailableMb)
    ? Math.min(4, Math.max(0, input.memoryAvailableMb) / 8192)
    : 0;
  return confidence * 20 + capacity * 3 + connectivity + power + memory;
}

export class DistributedCoordinatorRuntime {
  private lease: CoordinatorLease | null = null;
  private readonly store: CoordinatorStore;
  private readonly clusterId: string;

  constructor(
    store: CoordinatorStore,
    clusterId: string,
  ) {
    if (!clusterId.trim()) throw new Error("clusterId is required");
    this.store = store;
    this.clusterId = clusterId;
  }

  async initialize(): Promise<void> {
    // Another Runtime may have advanced ownership since our last operation.
    // The persisted lease, not this instance's cache, is authority.
    const loaded = await this.store.load();
    if (loaded) {
      assertLease(loaded);
      if (loaded.clusterId !== this.clusterId) {
        throw new Error(`Coordinator lease belongs to cluster ${loaded.clusterId}, expected ${this.clusterId}`);
      }
    }
    this.lease = loaded ? structuredClone(loaded) : null;
  }

  async current(): Promise<CoordinatorLease | null> {
    await this.initialize();
    return this.lease ? structuredClone(this.lease) : null;
  }

  async elect(
    candidates: readonly CoordinatorCandidate[],
    leaseMs = 30_000,
    now = new Date(),
  ): Promise<CoordinatorClaim> {
    await this.initialize();
    assertCandidates(candidates);
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be positive");

    const ranked = eligibleCandidates(candidates);
    const current = this.lease;
    if (current && timestamp(current.leaseUntil, "leaseUntil") > now.getTime()) {
      const incumbent = ranked.find((candidate) => candidate.nodeId === current.coordinatorId);
      if (incumbent) return claimOf(current);
    }

    const selected = ranked[0];
    if (!selected) throw new Error("NO_ELIGIBLE_COORDINATOR");
    const at = now.toISOString();
    const next: CoordinatorLease = {
      clusterId: this.clusterId,
      coordinatorId: selected.nodeId,
      epoch: (current?.epoch ?? 0) + 1,
      fencingToken: randomUUID(),
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      issuedAt: at,
      updatedAt: at,
    };
    await this.store.save(next);
    this.lease = next;
    return claimOf(next);
  }

  async renew(
    claim: CoordinatorClaim,
    candidates: readonly CoordinatorCandidate[],
    leaseMs = 30_000,
    now = new Date(),
  ): Promise<CoordinatorClaim> {
    await this.initialize();
    assertCandidates(candidates);
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be positive");
    this.assertClaim(claim, now);
    const incumbent = eligibleCandidates(candidates)
      .find((candidate) => candidate.nodeId === claim.coordinatorId);
    if (!incumbent) throw new Error("COORDINATOR_NO_LONGER_ELIGIBLE");

    const next: CoordinatorLease = {
      ...this.lease!,
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.store.save(next);
    this.lease = next;
    return claimOf(next);
  }

  async assertAuthoritative(claim: CoordinatorClaim, now = new Date()): Promise<void> {
    await this.initialize();
    this.assertClaim(claim, now);
  }

  private assertClaim(claim: CoordinatorClaim, now: Date): void {
    const current = this.lease;
    const stale = !current
      || claim.clusterId !== current.clusterId
      || claim.coordinatorId !== current.coordinatorId
      || claim.epoch !== current.epoch
      || claim.fencingToken !== current.fencingToken
      || claim.leaseUntil !== current.leaseUntil
      || timestamp(current.leaseUntil, "leaseUntil") <= now.getTime();
    if (stale) throw new Error("STALE_COORDINATOR_CLAIM");
  }
}
