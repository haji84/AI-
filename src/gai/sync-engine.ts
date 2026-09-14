import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SyncEntityType = "goal" | "task" | "result" | "memory" | "skill" | "evidence" | "log";
export type SyncState = "local-only" | "pending-push" | "synced" | "conflicted";
export type VerificationStatus = "pass" | "fail" | "unverified";
export type CausalClock = Record<string, number>;

export interface SyncVerification {
  status: VerificationStatus;
  verifiedAt?: string;
  verifierId?: string;
}

export interface SyncRecord<T = unknown> {
  recordId: string;
  entityType: SyncEntityType;
  version: number;
  deviceId: string;
  updatedAt: string;
  clock: CausalClock;
  syncState: SyncState;
  ownerTaskId?: string;
  verification?: SyncVerification;
  value: T;
}

export interface SyncSnapshot {
  version: 1;
  records: SyncRecord[];
  savedAt: string;
}

export interface SyncStore {
  load(): Promise<SyncSnapshot | null>;
  save(snapshot: SyncSnapshot): Promise<void>;
}

export class MemorySyncStore implements SyncStore {
  private snapshot: SyncSnapshot | null = null;

  async load(): Promise<SyncSnapshot | null> {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  async save(snapshot: SyncSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
  }
}

export class JsonFileSyncStore implements SyncStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<SyncSnapshot | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SyncSnapshot;
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error(`Unsupported sync snapshot at ${this.filePath}`);
      }
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  async save(snapshot: SyncSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}

export type ClockRelation = "equal" | "local-dominates" | "remote-dominates" | "concurrent";

export interface SyncConflict {
  recordId: string;
  entityType: SyncEntityType;
  reason: string;
  local: SyncRecord;
  remote: SyncRecord;
}

export interface MergeDecision {
  kind: "local" | "remote" | "merged" | "conflict";
  record?: SyncRecord;
  conflict?: SyncConflict;
  reason: string;
}

export interface SyncReport {
  pushed: string[];
  pulled: string[];
  converged: string[];
  conflicts: SyncConflict[];
}

const CRITICAL_ENTITIES = new Set<SyncEntityType>(["goal", "task", "result", "evidence"]);

function assertRecord(record: SyncRecord): void {
  if (!record.recordId.trim() || !record.deviceId.trim()) throw new Error("recordId and deviceId are required");
  if (!Number.isInteger(record.version) || record.version < 1) throw new Error("record version must be a positive integer");
  if ((record.clock[record.deviceId] ?? 0) < 1) throw new Error(`clock must include device ${record.deviceId}`);
}

function cloneRecord<T>(record: SyncRecord<T>): SyncRecord<T> {
  return structuredClone(record);
}

export function compareClocks(local: CausalClock, remote: CausalClock): ClockRelation {
  const devices = new Set([...Object.keys(local), ...Object.keys(remote)]);
  let localGreater = false;
  let remoteGreater = false;
  for (const device of devices) {
    const a = local[device] ?? 0;
    const b = remote[device] ?? 0;
    if (a > b) localGreater = true;
    if (b > a) remoteGreater = true;
  }
  if (!localGreater && !remoteGreater) return "equal";
  if (localGreater && !remoteGreater) return "local-dominates";
  if (!localGreater && remoteGreater) return "remote-dominates";
  return "concurrent";
}

export function incrementClock(clock: CausalClock, deviceId: string): CausalClock {
  return { ...clock, [deviceId]: (clock[deviceId] ?? 0) + 1 };
}

function verificationRank(record: SyncRecord): number {
  if (record.verification?.status === "pass") return 3;
  if (record.verification?.status === "fail") return 2;
  return 1;
}

function isVerifiedTerminalTask(record: SyncRecord): boolean {
  if (record.entityType !== "task" || record.verification?.status !== "pass") return false;
  const value = record.value as { status?: unknown } | null;
  return value?.status === "completed";
}

function combineClocks(a: CausalClock, b: CausalClock): CausalClock {
  const out: CausalClock = {};
  for (const device of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[device] = Math.max(a[device] ?? 0, b[device] ?? 0);
  }
  return out;
}

export function resolveSyncRecords(local: SyncRecord, remote: SyncRecord): MergeDecision {
  assertRecord(local);
  assertRecord(remote);
  if (local.recordId !== remote.recordId || local.entityType !== remote.entityType) {
    throw new Error("Cannot merge records with different identity or entity type");
  }

  const relation = compareClocks(local.clock, remote.clock);
  if (relation === "local-dominates") {
    return { kind: "local", record: cloneRecord(local), reason: "local causal clock dominates" };
  }
  if (relation === "remote-dominates") {
    return { kind: "remote", record: cloneRecord(remote), reason: "remote causal clock dominates" };
  }
  if (relation === "equal") {
    if (JSON.stringify(local.value) === JSON.stringify(remote.value)) {
      const ranked = verificationRank(local) >= verificationRank(remote) ? local : remote;
      return { kind: ranked === local ? "local" : "remote", record: cloneRecord(ranked), reason: "equal causal state" };
    }
  }

  if (isVerifiedTerminalTask(local) && !isVerifiedTerminalTask(remote)) {
    return { kind: "local", record: cloneRecord(local), reason: "verified completed task outranks concurrent non-completed task state" };
  }
  if (isVerifiedTerminalTask(remote) && !isVerifiedTerminalTask(local)) {
    return { kind: "remote", record: cloneRecord(remote), reason: "verified completed task outranks concurrent non-completed task state" };
  }

  if (local.ownerTaskId && remote.ownerTaskId && local.ownerTaskId === remote.ownerTaskId) {
    const localRank = verificationRank(local);
    const remoteRank = verificationRank(remote);
    if (localRank !== remoteRank) {
      const winner = localRank > remoteRank ? local : remote;
      return {
        kind: winner === local ? "local" : "remote",
        record: cloneRecord(winner),
        reason: "same task ownership resolved by stronger verifier evidence",
      };
    }
  }

  if (!CRITICAL_ENTITIES.has(local.entityType) && local.entityType !== "log") {
    const winner = local.version > remote.version ? local : remote.version > local.version ? remote : null;
    if (winner) {
      return {
        kind: winner === local ? "local" : "remote",
        record: cloneRecord(winner),
        reason: "non-critical concurrent state resolved by monotonic version",
      };
    }
  }

  const conflict: SyncConflict = {
    recordId: local.recordId,
    entityType: local.entityType,
    reason: relation === "equal" ? "equal causal clock with incompatible values" : "concurrent incompatible critical state",
    local: { ...cloneRecord(local), syncState: "conflicted" },
    remote: { ...cloneRecord(remote), syncState: "conflicted" },
  };
  return { kind: "conflict", conflict, reason: conflict.reason };
}

export class SyncRepository {
  private readonly store: SyncStore;
  private readonly records = new Map<string, SyncRecord>();
  private loaded = false;

  constructor(store: SyncStore) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.store.load();
    this.records.clear();
    for (const record of snapshot?.records ?? []) {
      assertRecord(record);
      this.records.set(record.recordId, cloneRecord(record));
    }
    this.loaded = true;
  }

  async get(recordId: string): Promise<SyncRecord | undefined> {
    await this.initialize();
    const record = this.records.get(recordId);
    return record ? cloneRecord(record) : undefined;
  }

  async list(): Promise<SyncRecord[]> {
    await this.initialize();
    return [...this.records.values()].map(cloneRecord);
  }

  async put(record: SyncRecord, now = new Date()): Promise<SyncRecord> {
    await this.initialize();
    assertRecord(record);
    this.records.set(record.recordId, cloneRecord(record));
    await this.persist(now);
    return cloneRecord(record);
  }

  async mutate<T>(input: {
    recordId: string;
    entityType: SyncEntityType;
    deviceId: string;
    value: T;
    ownerTaskId?: string;
    verification?: SyncVerification;
  }, now = new Date()): Promise<SyncRecord<T>> {
    await this.initialize();
    const existing = this.records.get(input.recordId);
    if (existing && existing.entityType !== input.entityType) {
      throw new Error(`Entity type mismatch for ${input.recordId}`);
    }
    const clock = incrementClock(existing?.clock ?? {}, input.deviceId);
    const record: SyncRecord<T> = {
      recordId: input.recordId,
      entityType: input.entityType,
      version: (existing?.version ?? 0) + 1,
      deviceId: input.deviceId,
      updatedAt: now.toISOString(),
      clock,
      syncState: "pending-push",
      ownerTaskId: input.ownerTaskId,
      verification: input.verification,
      value: structuredClone(input.value),
    };
    await this.put(record, now);
    return cloneRecord(record);
  }

  async markSynced(record: SyncRecord, now = new Date()): Promise<SyncRecord> {
    const synced = { ...cloneRecord(record), syncState: "synced" as const };
    await this.put(synced, now);
    return synced;
  }

  private async persist(now: Date): Promise<void> {
    await this.store.save({
      version: 1,
      records: [...this.records.values()].map(cloneRecord),
      savedAt: now.toISOString(),
    });
  }
}

export class SyncEngine {
  private readonly local: SyncRepository;
  private readonly remote: SyncRepository;

  constructor(local: SyncRepository, remote: SyncRepository) {
    this.local = local;
    this.remote = remote;
  }

  async synchronize(now = new Date()): Promise<SyncReport> {
    await this.local.initialize();
    await this.remote.initialize();
    const localRecords = new Map((await this.local.list()).map((record) => [record.recordId, record]));
    const remoteRecords = new Map((await this.remote.list()).map((record) => [record.recordId, record]));
    const ids = new Set([...localRecords.keys(), ...remoteRecords.keys()]);
    const report: SyncReport = { pushed: [], pulled: [], converged: [], conflicts: [] };

    for (const id of ids) {
      const local = localRecords.get(id);
      const remote = remoteRecords.get(id);
      if (local && !remote) {
        const synced = { ...cloneRecord(local), syncState: "synced" as const };
        await this.local.put(synced, now);
        await this.remote.put(synced, now);
        report.pushed.push(id);
        continue;
      }
      if (!local && remote) {
        const synced = { ...cloneRecord(remote), syncState: "synced" as const };
        await this.local.put(synced, now);
        await this.remote.put(synced, now);
        report.pulled.push(id);
        continue;
      }
      if (!local || !remote) continue;

      const decision = resolveSyncRecords(local, remote);
      if (decision.kind === "conflict" && decision.conflict) {
        await this.local.put(decision.conflict.local, now);
        await this.remote.put(decision.conflict.remote, now);
        report.conflicts.push(decision.conflict);
        continue;
      }

      const winner = decision.record;
      if (!winner) continue;
      const merged: SyncRecord = {
        ...cloneRecord(winner),
        clock: combineClocks(local.clock, remote.clock),
        version: Math.max(local.version, remote.version),
        syncState: "synced",
      };
      await this.local.put(merged, now);
      await this.remote.put(merged, now);
      report.converged.push(id);
    }

    return report;
  }
}
