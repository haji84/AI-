import { randomUUID } from "node:crypto";
import { JarvisEnrollmentService } from "./enrollment.ts";
import { JarvisExecutionRouter } from "./execution-router.ts";
import { JarvisFleetManager } from "./fleet-manager.ts";
import { JarvisHumanTakeoverManager } from "./human-takeover.ts";
import { JarvisTaskQueue } from "./task-queue.ts";
import type {
  JarvisConnectionSnapshot,
  JarvisEnrollmentToken,
  JarvisNode,
  JarvisTakeoverSession,
  JarvisTask,
} from "./types.ts";

export interface JarvisAuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target?: string;
  detail?: Record<string, unknown>;
}

export interface JarvisControlPlaneSnapshot {
  generatedAt: string;
  fleet: JarvisNode[];
  tasks: JarvisTask[];
  activeTakeovers: JarvisTakeoverSession[];
  audit: JarvisAuditEvent[];
  stats: {
    registered: number;
    ready: number;
    offline: number;
    needsHuman: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
}

export class JarvisControlPlane {
  readonly fleet = new JarvisFleetManager();
  readonly queue = new JarvisTaskQueue();
  readonly enrollment = new JarvisEnrollmentService();
  readonly takeovers = new JarvisHumanTakeoverManager();
  readonly router = new JarvisExecutionRouter(this.fleet, this.queue);
  private readonly auditEvents: JarvisAuditEvent[] = [];

  createEnrollment(input: {
    mode: JarvisEnrollmentToken["mode"];
    ttlMs?: number;
    maxDevices?: number;
    group?: string;
    now?: Date;
  }): JarvisEnrollmentToken {
    const token = this.enrollment.createToken(input);
    this.audit("owner", "enrollment.token.created", undefined, {
      mode: token.mode,
      maxDevices: token.maxDevices,
      group: token.group,
      expiresAt: token.expiresAt,
    }, input.now);
    return token;
  }

  enroll(token: string, node: JarvisNode, now = new Date()): JarvisNode {
    const consumed = this.enrollment.consume(token, node, now);
    const registered = this.fleet.register(consumed.node);
    this.audit(registered.id, "node.enrolled", registered.id, {
      enrollment: registered.enrollment,
      kind: registered.kind,
      group: registered.group,
    }, now);
    return registered;
  }

  heartbeat(nodeId: string, input: Partial<Pick<JarvisNode, "status" | "telemetry">>, now = new Date()): JarvisNode {
    const updated = this.fleet.updateHeartbeat(nodeId, {
      ...input,
      lastSeenAt: now.toISOString(),
      telemetry: input.telemetry ? { ...input.telemetry, checkedAt: now.toISOString() } as JarvisNode["telemetry"] : undefined,
    });
    this.audit(nodeId, "node.heartbeat", nodeId, { status: updated.status }, now);
    return updated;
  }

  enqueueTask(input: Omit<JarvisTask, "id" | "status" | "attempts" | "createdAt" | "updatedAt"> & { id?: string }, now = new Date()): JarvisTask {
    const queued = this.queue.enqueue({
      ...input,
      id: input.id ?? randomUUID(),
      status: "queued",
      attempts: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    this.audit("owner", "task.queued", queued.id, { type: queued.type, priority: queued.priority }, now);
    return queued;
  }

  dispatch(connectivity: JarvisConnectionSnapshot, now = new Date()) {
    const decision = this.router.dispatchNext({ connectivity, now });
    if (decision) {
      this.audit("jarvis", `task.${decision.status}`, decision.task.id, {
        nodeId: decision.node?.id,
        reasons: decision.reasons,
      }, now);
    }
    return decision;
  }

  markRunning(taskId: string, nodeId: string, now = new Date()): JarvisTask {
    const task = this.queue.get(taskId);
    if (!task || task.assignedNodeId !== nodeId) throw new Error("Task lease is not owned by this node");
    const running = this.queue.markRunning(taskId, now);
    this.audit(nodeId, "task.running", taskId, undefined, now);
    return running;
  }

  completeTask(taskId: string, nodeId: string, result?: Record<string, unknown>, now = new Date()): JarvisTask {
    const task = this.queue.get(taskId);
    if (!task || task.assignedNodeId !== nodeId) throw new Error("Task lease is not owned by this node");
    const completed = this.queue.complete(taskId, now);
    this.audit(nodeId, "task.completed", taskId, { result }, now);
    return completed;
  }

  failTask(taskId: string, nodeId: string, reason: string, now = new Date()): JarvisTask {
    const task = this.queue.get(taskId);
    if (!task || task.assignedNodeId !== nodeId) throw new Error("Task lease is not owned by this node");
    const failed = this.queue.fail(taskId, now);
    this.audit(nodeId, failed.status === "queued" ? "task.retry" : "task.failed", taskId, { reason }, now);
    return failed;
  }

  requestTakeover(input: Omit<JarvisTakeoverSession, "id" | "status" | "createdAt" | "updatedAt">, now = new Date()): JarvisTakeoverSession {
    if (input.taskId && this.queue.get(input.taskId)) this.queue.waitForHuman(input.taskId, now);
    const session = this.takeovers.request(input, now);
    const node = this.fleet.get(input.nodeId);
    if (node) this.fleet.updateHeartbeat(node.id, { status: "needs-human", lastSeenAt: node.lastSeenAt });
    this.audit("jarvis", "takeover.requested", session.id, { nodeId: input.nodeId, taskId: input.taskId, reason: input.reason }, now);
    return session;
  }

  resolveTakeover(sessionId: string, resumeTask = true, now = new Date()): JarvisTakeoverSession {
    const active = this.takeovers.resolve(sessionId, now);
    if (active.taskId && resumeTask && this.queue.get(active.taskId)?.status === "waiting-human") {
      this.queue.resumeFromHuman(active.taskId, now);
    }
    const node = this.fleet.get(active.nodeId);
    if (node) this.fleet.updateHeartbeat(node.id, { status: "ready", lastSeenAt: node.lastSeenAt });
    this.audit("owner", "takeover.resolved", sessionId, { resumeTask }, now);
    return active;
  }

  snapshot(now = new Date()): JarvisControlPlaneSnapshot {
    const fleet = this.fleet.list();
    const tasks = this.queue.list();
    const activeTakeovers = fleet
      .map((node) => this.takeovers.activeForNode(node.id))
      .filter((item): item is JarvisTakeoverSession => Boolean(item));
    return {
      generatedAt: now.toISOString(),
      fleet,
      tasks,
      activeTakeovers,
      audit: this.auditEvents.map((event) => structuredClone(event)),
      stats: {
        registered: fleet.length,
        ready: fleet.filter((node) => node.status === "ready").length,
        offline: fleet.filter((node) => node.status === "offline").length,
        needsHuman: fleet.filter((node) => node.status === "needs-human" || node.status === "locked").length,
        queued: tasks.filter((task) => task.status === "queued" || task.status === "waiting-connectivity").length,
        running: tasks.filter((task) => task.status === "leased" || task.status === "running").length,
        completed: tasks.filter((task) => task.status === "completed").length,
        failed: tasks.filter((task) => task.status === "failed").length,
      },
    };
  }

  private audit(actor: string, action: string, target?: string, detail?: Record<string, unknown>, now = new Date()): void {
    this.auditEvents.push({ id: randomUUID(), at: now.toISOString(), actor, action, target, detail });
    if (this.auditEvents.length > 1000) this.auditEvents.splice(0, this.auditEvents.length - 1000);
  }
}
