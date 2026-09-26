import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WorkerCapability } from "./worker-runtime.ts";

export type DurableTaskStatus =
  | "queued"
  | "waiting-dependency"
  | "leased"
  | "running"
  | "waiting-connectivity"
  | "waiting-resource"
  | "ready-to-publish"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type DurableTaskPriority = "urgent" | "high" | "normal" | "low" | "background";

export interface DurableTaskTransition {
  from: DurableTaskStatus | null;
  to: DurableTaskStatus;
  at: string;
  reason: string;
  actor?: string;
  evidence?: Record<string, unknown>;
}

export interface DurableTask {
  id: string;
  idempotencyKey: string;
  type: string;
  payload: Record<string, unknown>;
  status: DurableTaskStatus;
  priority: DurableTaskPriority;
  requiredCapabilities: WorkerCapability[];
  dependsOn: string[];
  attempts: number;
  maxAttempts: number;
  leaseOwner?: string;
  leaseUntil?: string;
  nextAttemptAt?: string;
  checkpointRef?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  history: DurableTaskTransition[];
}

export interface DurableTaskCreateInput {
  id: string;
  idempotencyKey: string;
  type: string;
  payload?: Record<string, unknown>;
  priority?: DurableTaskPriority;
  requiredCapabilities?: WorkerCapability[];
  dependsOn?: string[];
  maxAttempts?: number;
  checkpointRef?: string;
}

export interface DurableTaskSnapshot {
  version: 1;
  tasks: DurableTask[];
  savedAt: string;
}

export interface DurableTaskStore {
  load(): Promise<DurableTaskSnapshot | null>;
  save(snapshot: DurableTaskSnapshot): Promise<void>;
}

export class MemoryDurableTaskStore implements DurableTaskStore {
  private snapshot: DurableTaskSnapshot | null = null;

  async load(): Promise<DurableTaskSnapshot | null> {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  async save(snapshot: DurableTaskSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
  }
}

export class JsonFileDurableTaskStore implements DurableTaskStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<DurableTaskSnapshot | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as DurableTaskSnapshot;
      if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) {
        throw new Error(`Unsupported durable task snapshot at ${this.filePath}`);
      }
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  async save(snapshot: DurableTaskSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}

const PRIORITY_WEIGHT: Record<DurableTaskPriority, number> = {
  urgent: 5,
  high: 4,
  normal: 3,
  low: 2,
  background: 1,
};

const TERMINAL = new Set<DurableTaskStatus>(["completed", "failed", "cancelled"]);

function cloneTask(task: DurableTask): DurableTask {
  return structuredClone(task);
}

function iso(now: Date): string {
  return now.toISOString();
}

export class DurableTaskRuntime {
  private readonly tasks = new Map<string, DurableTask>();
  private readonly store: DurableTaskStore;
  private loaded = false;

  constructor(store: DurableTaskStore) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.store.load();
    this.tasks.clear();
    for (const task of snapshot?.tasks ?? []) this.tasks.set(task.id, cloneTask(task));
    this.loaded = true;
  }

  async enqueue(input: DurableTaskCreateInput, now = new Date()): Promise<DurableTask> {
    await this.initialize();
    const existing = [...this.tasks.values()].find((task) =>
      task.idempotencyKey === input.idempotencyKey && task.status !== "failed" && task.status !== "cancelled",
    );
    if (existing) return cloneTask(existing);
    if (this.tasks.has(input.id)) throw new Error(`Durable task ${input.id} already exists`);
    if (!input.id.trim() || !input.idempotencyKey.trim() || !input.type.trim()) {
      throw new Error("id, idempotencyKey, and type are required");
    }
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
    const createdAt = iso(now);
    const task: DurableTask = {
      id: input.id,
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      payload: structuredClone(input.payload ?? {}),
      status: (input.dependsOn?.length ?? 0) > 0 ? "waiting-dependency" : "queued",
      priority: input.priority ?? "normal",
      requiredCapabilities: [...(input.requiredCapabilities ?? [])],
      dependsOn: [...new Set(input.dependsOn ?? [])],
      attempts: 0,
      maxAttempts,
      checkpointRef: input.checkpointRef,
      createdAt,
      updatedAt: createdAt,
      history: [],
    };
    task.history.push({ from: null, to: task.status, at: createdAt, reason: "task enqueued" });
    this.tasks.set(task.id, task);
    await this.refreshDependencyState(now);
    await this.persist(now);
    return cloneTask(this.mustGet(task.id));
  }

  async get(taskId: string): Promise<DurableTask | undefined> {
    await this.initialize();
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : undefined;
  }

  async list(): Promise<DurableTask[]> {
    await this.initialize();
    return [...this.tasks.values()].map(cloneTask);
  }

  async next(now = new Date()): Promise<DurableTask | undefined> {
    await this.initialize();
    await this.reclaimExpiredLeases(now);
    await this.refreshDependencyState(now);
    return [...this.tasks.values()]
      .filter((task) => task.status === "queued" || task.status === "retrying")
      .filter((task) => !task.nextAttemptAt || new Date(task.nextAttemptAt).getTime() <= now.getTime())
      .sort((a, b) =>
        PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.createdAt.localeCompare(b.createdAt),
      )
      .map(cloneTask)[0];
  }

  async lease(taskId: string, owner: string, leaseMs = 120_000, now = new Date()): Promise<DurableTask> {
    await this.initialize();
    if (!owner.trim()) throw new Error("lease owner is required");
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be positive");
    await this.refreshDependencyState(now);
    const task = this.mustGet(taskId);
    if (task.status !== "queued" && task.status !== "retrying") {
      throw new Error(`Task ${taskId} cannot be leased from status ${task.status}`);
    }
    if (task.nextAttemptAt && new Date(task.nextAttemptAt).getTime() > now.getTime()) {
      throw new Error(`Task ${taskId} retry delay has not elapsed`);
    }
    this.transition(task, "leased", "lease acquired", now, owner, {
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
    });
    task.leaseOwner = owner;
    task.leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    task.nextAttemptAt = undefined;
    task.attempts += 1;
    await this.persist(now);
    return cloneTask(task);
  }

  async heartbeat(taskId: string, owner: string, leaseMs = 120_000, now = new Date()): Promise<DurableTask> {
    await this.initialize();
    const task = this.mustGet(taskId);
    if ((task.status !== "leased" && task.status !== "running") || task.leaseOwner !== owner) {
      throw new Error(`Task ${taskId} is not leased by ${owner}`);
    }
    task.leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    task.updatedAt = iso(now);
    await this.persist(now);
    return cloneTask(task);
  }

  async markRunning(taskId: string, owner: string, now = new Date()): Promise<DurableTask> {
    await this.initialize();
    const task = this.mustGet(taskId);
    if (task.status !== "leased" || task.leaseOwner !== owner) {
      throw new Error(`Task ${taskId} must be leased by ${owner} before running`);
    }
    this.transition(task, "running", "execution started", now, owner);
    await this.persist(now);
    return cloneTask(task);
  }

  async complete(taskId: string, owner: string, result?: unknown, now = new Date()): Promise<DurableTask> {
    await this.initialize();
    const task = this.mustGet(taskId);
    if ((task.status !== "running" && task.status !== "leased") || task.leaseOwner !== owner) {
      throw new Error(`Task ${taskId} is not executable by ${owner}`);
    }
    task.result = structuredClone(result);
    task.error = undefined;
    task.leaseOwner = undefined;
    task.leaseUntil = undefined;
    this.transition(task, "completed", "execution verified complete", now, owner);
    await this.refreshDependencyState(now);
    await this.persist(now);
    return cloneTask(task);
  }

  async readyToPublish(taskId: string, owner: string, result?: unknown, now = new Date()): Promise<DurableTask> {
    await this.initialize();
    const task = this.mustGet(taskId);
    if ((task.status !== "running" && task.status !== "leased") || task.leaseOwner !== owner) {
      throw new Error(`Task ${taskId} is not executable by ${owner}`);
    }
    task.result = structuredClone(result);
    task.error = undefined;
    task.leaseOwner = undefined;
    task.leaseUntil = undefined;
    this.transition(task, "ready-to-publish", "offline execution verified; publication requires connectivity", now, owner);
    await this.persist(now);
    return cloneTask(task);
  }

  async fail(
    taskId: string,
    owner: string,
    error: string,
    retryDelayMs = 0,
    now = new Date(),
  ): Promise<DurableTask> {
    await this.initialize();
    const task = this.mustGet(taskId);
    if ((task.status !== "running" && task.status !== "leased") || task.leaseOwner !== owner) {
      throw new Error(`Task ${taskId} is not executable by ${owner}`);
    }
    task.error = error;
    task.leaseOwner = undefined;
    task.leaseUntil = undefined;
    const retry = task.attempts < task.maxAttempts;
    if (retry) {
      task.nextAttemptAt = new Date(now.getTime() + Math.max(0, retryDelayMs)).toISOString();
      this.transition(task, "retrying", "execution failed; retry scheduled", now, owner, { error });
    } else {
      task.nextAttemptAt = undefined;
      this.transition(task, "failed", "retry budget exhausted", now, owner, { error });
    }
    await this.refreshDependencyState(now);
    await this.persist(now);
    return cloneTask(task);
  }

  async waitForConnectivity(taskId: string, reason: string, now = new Date()): Promise<DurableTask> {
    return this.wait(taskId, "waiting-connectivity", reason, now);
  }

  async waitForResource(taskId: string, reason: string, now = new Date()): Promise<DurableTask> {
    return this.wait(taskId, "waiting-resource", reason, now);
  }

  async resumeWaiting(kind: "connectivity" | "resource", now = new Date()): Promise<number> {
    await this.initialize();
    const status = kind === "connectivity" ? "waiting-connectivity" : "waiting-resource";
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== status) continue;
      this.transition(task, "queued", `${kind} available`, now);
      count += 1;
    }
    if (count > 0) {
      await this.refreshDependencyState(now);
      await this.persist(now);
    }
    return count;
  }

  async cancel(taskId: string, reason = "cancelled", now = new Date()): Promise<DurableTask> {
    await this.initialize();
    const task = this.mustGet(taskId);
    if (task.status === "completed") throw new Error(`Completed task ${taskId} cannot be cancelled`);
    if (task.status === "cancelled") return cloneTask(task);
    task.leaseOwner = undefined;
    task.leaseUntil = undefined;
    task.nextAttemptAt = undefined;
    this.transition(task, "cancelled", reason, now);
    await this.refreshDependencyState(now);
    await this.persist(now);
    return cloneTask(task);
  }

  async setCheckpointRef(taskId: string, checkpointRef: string | undefined, now = new Date()): Promise<DurableTask> {
    await this.initialize();
    const task = this.mustGet(taskId);
    if (TERMINAL.has(task.status)) throw new Error(`Cannot update checkpoint for terminal task ${taskId}`);
    task.checkpointRef = checkpointRef?.trim() || undefined;
    task.updatedAt = iso(now);
    await this.persist(now);
    return cloneTask(task);
  }

  async reclaimExpiredLeases(now = new Date()): Promise<number> {
    await this.initialize();
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== "leased" && task.status !== "running") continue;
      if (!task.leaseUntil || new Date(task.leaseUntil).getTime() > now.getTime()) continue;
      this.recoverTask(task, "lease expired", now);
      count += 1;
    }
    if (count > 0) await this.persist(now);
    return count;
  }

  async recoverOrphans(activeLeaseOwners: ReadonlySet<string>, now = new Date()): Promise<number> {
    await this.initialize();
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== "leased" && task.status !== "running") continue;
      if (task.leaseOwner && activeLeaseOwners.has(task.leaseOwner)) continue;
      this.recoverTask(task, "orphaned execution recovered", now);
      count += 1;
    }
    if (count > 0) await this.persist(now);
    return count;
  }

  private async wait(
    taskId: string,
    status: "waiting-connectivity" | "waiting-resource",
    reason: string,
    now: Date,
  ): Promise<DurableTask> {
    await this.initialize();
    const task = this.mustGet(taskId);
    if (TERMINAL.has(task.status)) throw new Error(`Terminal task ${taskId} cannot wait`);
    task.leaseOwner = undefined;
    task.leaseUntil = undefined;
    task.nextAttemptAt = undefined;
    this.transition(task, status, reason, now);
    await this.persist(now);
    return cloneTask(task);
  }

  private recoverTask(task: DurableTask, reason: string, now: Date): void {
    task.leaseOwner = undefined;
    task.leaseUntil = undefined;
    const retry = task.attempts < task.maxAttempts;
    if (retry) {
      task.nextAttemptAt = iso(now);
      this.transition(task, "retrying", reason, now);
    } else {
      task.nextAttemptAt = undefined;
      task.error = reason;
      this.transition(task, "failed", `${reason}; retry budget exhausted`, now);
    }
  }

  private async refreshDependencyState(now: Date): Promise<void> {
    for (const task of this.tasks.values()) {
      if (TERMINAL.has(task.status) || task.dependsOn.length === 0) continue;
      const dependencies = task.dependsOn.map((id) => this.tasks.get(id));
      const terminalFailure = dependencies.find((dep) => dep?.status === "failed" || dep?.status === "cancelled");
      if (terminalFailure) {
        task.error = `Dependency ${terminalFailure.id} ended as ${terminalFailure.status}`;
        this.transition(task, "failed", "dependency ended unsuccessfully", now, undefined, {
          dependencyId: terminalFailure.id,
          dependencyStatus: terminalFailure.status,
        });
        continue;
      }
      const complete = dependencies.length === task.dependsOn.length && dependencies.every((dep) => dep?.status === "completed");
      if (complete && task.status === "waiting-dependency") {
        this.transition(task, "queued", "all dependencies completed", now);
      } else if (!complete && (task.status === "queued" || task.status === "retrying")) {
        this.transition(task, "waiting-dependency", "waiting for dependencies", now);
      }
    }
  }

  private transition(
    task: DurableTask,
    to: DurableTaskStatus,
    reason: string,
    now: Date,
    actor?: string,
    evidence?: Record<string, unknown>,
  ): void {
    const from = task.status;
    task.status = to;
    task.updatedAt = iso(now);
    task.history.push({ from, to, at: task.updatedAt, reason, actor, evidence });
  }

  private mustGet(taskId: string): DurableTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown durable task: ${taskId}`);
    return task;
  }

  private async persist(now = new Date()): Promise<void> {
    await this.store.save({
      version: 1,
      tasks: [...this.tasks.values()].map(cloneTask),
      savedAt: iso(now),
    });
  }
}
