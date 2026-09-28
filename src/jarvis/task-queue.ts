import { randomUUID } from "node:crypto";
import type { JarvisTask } from "./types.ts";

const PRIORITY_WEIGHT: Record<JarvisTask["priority"], number> = {
  urgent: 5,
  high: 4,
  normal: 3,
  low: 2,
  background: 1,
};

export class JarvisTaskQueue {
  private readonly tasks = new Map<string, JarvisTask>();
  private readonly completedIdempotencyKeys = new Set<string>();

  enqueue(task: JarvisTask): JarvisTask {
    const duplicate = [...this.tasks.values()].find((item) => item.idempotencyKey === task.idempotencyKey && item.status !== "failed" && item.status !== "cancelled");
    if (duplicate || this.completedIdempotencyKeys.has(task.idempotencyKey)) return structuredClone(duplicate ?? task);
    this.tasks.set(task.id, structuredClone(task));
    return structuredClone(task);
  }

  restore(tasks: JarvisTask[]): void {
    this.tasks.clear();
    this.completedIdempotencyKeys.clear();
    for (const task of tasks) {
      this.tasks.set(task.id, structuredClone(task));
      if (task.status === "completed") this.completedIdempotencyKeys.add(task.idempotencyKey);
    }
  }

  get(taskId: string): JarvisTask | undefined {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : undefined;
  }

  list(): JarvisTask[] {
    return [...this.tasks.values()].map((task) => structuredClone(task));
  }

  assignedTo(nodeId: string, now = new Date()): JarvisTask[] {
    this.expireUndispatched(now);
    return [...this.tasks.values()]
      .filter((task) => task.assignedNodeId === nodeId && (task.status === "leased" || task.status === "running"))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((task) => structuredClone(task));
  }

  next(now = new Date()): JarvisTask | undefined {
    this.reclaimExpiredLeases(now);
    this.expireUndispatched(now);
    return [...this.tasks.values()]
      .filter((task) => task.status === "queued")
      .sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.createdAt.localeCompare(b.createdAt))[0];
  }

  lease(taskId: string, nodeId: string, leaseMs = 120_000, now = new Date()): JarvisTask {
    this.expireUndispatched(now);
    const task = this.mustGet(taskId);
    if (task.status !== "queued") throw new Error(`Task ${taskId} is not queued`);
    const leased: JarvisTask = {
      ...task,
      status: "leased",
      assignedNodeId: nodeId,
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      executionEpoch: (Number.isSafeInteger(task.executionEpoch) ? task.executionEpoch! : 0) + 1,
      fencingToken: randomUUID(),
      attempts: task.attempts + 1,
      updatedAt: now.toISOString(),
    };
    this.tasks.set(taskId, leased);
    return structuredClone(leased);
  }

  ensureExecutionClaim(taskId: string, nodeId: string, now = new Date()): JarvisTask {
    const task = this.mustGet(taskId);
    if (task.assignedNodeId !== nodeId || (task.status !== "leased" && task.status !== "running")) {
      throw new Error("STALE_OR_INVALID_TASK_FENCE");
    }
    if (Number.isSafeInteger(task.executionEpoch) && task.executionEpoch! >= 1 && typeof task.fencingToken === "string" && task.fencingToken.length >= 16) {
      return structuredClone(task);
    }
    const claimed: JarvisTask = {
      ...task,
      executionEpoch: Math.max(1, Number.isSafeInteger(task.executionEpoch) ? task.executionEpoch! : 0),
      fencingToken: randomUUID(),
      updatedAt: now.toISOString(),
    };
    this.tasks.set(taskId, claimed);
    return structuredClone(claimed);
  }

  assertExecutionClaim(taskId: string, nodeId: string, executionEpoch: number, fencingToken: string): JarvisTask {
    const task = this.mustGet(taskId);
    if (
      task.assignedNodeId !== nodeId
      || (task.status !== "leased" && task.status !== "running")
      || !Number.isSafeInteger(executionEpoch)
      || executionEpoch < 1
      || executionEpoch !== task.executionEpoch
      || typeof fencingToken !== "string"
      || fencingToken.length < 16
      || fencingToken !== task.fencingToken
    ) throw new Error("STALE_OR_INVALID_TASK_FENCE");
    return structuredClone(task);
  }

  markRunning(taskId: string, now = new Date()): JarvisTask {
    return this.patch(taskId, { status: "running", updatedAt: now.toISOString() });
  }

  complete(taskId: string, now = new Date()): JarvisTask {
    const task = this.mustGet(taskId);
    const completed = this.patch(taskId, { status: "completed", leaseUntil: undefined, updatedAt: now.toISOString() });
    this.completedIdempotencyKeys.add(task.idempotencyKey);
    return completed;
  }

  fail(taskId: string, now = new Date()): JarvisTask {
    const task = this.mustGet(taskId);
    const retry = task.attempts < task.maxAttempts;
    return this.patch(taskId, {
      status: retry ? "queued" : "failed",
      assignedNodeId: retry ? undefined : task.assignedNodeId,
      leaseUntil: undefined,
      fencingToken: undefined,
      updatedAt: now.toISOString(),
    });
  }

  waitForConnectivity(taskId: string, now = new Date()): JarvisTask {
    return this.patch(taskId, { status: "waiting-connectivity", assignedNodeId: undefined, leaseUntil: undefined, fencingToken: undefined, updatedAt: now.toISOString() });
  }

  resumeConnectivity(now = new Date()): number {
    let resumed = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== "waiting-connectivity") continue;
      this.tasks.set(task.id, { ...task, status: "queued", assignedNodeId: undefined, fencingToken: undefined, updatedAt: now.toISOString() });
      resumed += 1;
    }
    return resumed;
  }

  waitForHuman(taskId: string, now = new Date()): JarvisTask {
    return this.patch(taskId, { status: "waiting-human", assignedNodeId: undefined, leaseUntil: undefined, fencingToken: undefined, updatedAt: now.toISOString() });
  }

  resumeFromHuman(taskId: string, now = new Date()): JarvisTask {
    return this.patch(taskId, { status: "queued", assignedNodeId: undefined, fencingToken: undefined, updatedAt: now.toISOString() });
  }

  reclaimExpiredLeases(now = new Date()): number {
    let reclaimed = 0;
    for (const task of this.tasks.values()) {
      if ((task.status !== "leased" && task.status !== "running") || !task.leaseUntil) continue;
      if (new Date(task.leaseUntil).getTime() > now.getTime()) continue;
      const retry = task.attempts < task.maxAttempts;
      this.tasks.set(task.id, {
        ...task,
        status: retry ? "queued" : "failed",
        assignedNodeId: retry ? undefined : task.assignedNodeId,
        leaseUntil: undefined,
        fencingToken: undefined,
        updatedAt: now.toISOString(),
      });
      reclaimed += 1;
    }
    return reclaimed;
  }

  private expireUndispatched(now: Date): void {
    for (const task of this.tasks.values()) {
      if (!task.dispatchBefore || !["queued", "leased", "waiting-connectivity"].includes(task.status)) continue;
      const deadline = Date.parse(task.dispatchBefore);
      if (Number.isFinite(deadline) && deadline > now.getTime()) continue;
      this.tasks.set(task.id, { ...task, status: "cancelled", assignedNodeId: undefined, leaseUntil: undefined, fencingToken: undefined, updatedAt: now.toISOString() });
    }
  }

  private mustGet(taskId: string): JarvisTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown JARVIS task: ${taskId}`);
    return task;
  }

  private patch(taskId: string, patch: Partial<JarvisTask>): JarvisTask {
    const task = { ...this.mustGet(taskId), ...patch };
    this.tasks.set(taskId, task);
    return structuredClone(task);
  }
}
