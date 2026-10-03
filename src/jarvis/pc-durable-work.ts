import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DurableTaskRuntime, type DurableTask, type DurableTaskExecutionClaim } from "../gai/durable-task-runtime.ts";
import { verifyContextCapsule, type ExecutionContextCapsule } from "../orchestrator/execution-context-capsule.ts";
import type { JarvisNode } from "./types.ts";

export const PC_PUBLIC_DIGEST = "pc-public-file-sha256";
export class PcWorkConflict extends Error {}
export interface PcPublicWorkInput {
  idempotencyKey: string; goalIssue: number; targetNodeId?: string;
  privacyClass: "PUBLIC"; content: string; capsule: ExecutionContextCapsule;
}
export function validatePcPublicWork(value: unknown): PcPublicWorkInput {
  const input = value as PcPublicWorkInput;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).some(k => !["idempotencyKey", "goalIssue", "targetNodeId", "privacyClass", "content", "capsule"].includes(k)) ||
    typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,150}$/.test(input.idempotencyKey) ||
    !Number.isSafeInteger(input.goalIssue) || input.goalIssue < 1 || input.privacyClass !== "PUBLIC" ||
    typeof input.content !== "string" || Buffer.byteLength(input.content) > 32768 ||
    (input.targetNodeId !== undefined && !/^[A-Za-z0-9._-]{1,100}$/.test(input.targetNodeId))) throw new Error("PC_WORK_INPUT_REJECTED");
  const c = input.capsule;
  if (!c || typeof c !== "object" || Array.isArray(c) || !verifyContextCapsule(c).ok ||
    c.goal !== `#${input.goalIssue}` || Buffer.byteLength(JSON.stringify(c)) > 16384 ||
    [c.inputs, c.constraints, c.decisions, c.dependencies, c.expectedOutput, c.definitionOfDone, c.recoveryContext]
      .some(items => items.some(item => typeof item !== "string"))) throw new Error("PC_WORK_CONTEXT_REQUIRED");
  return structuredClone(input);
}
export function assertPcExecutor(node: JarvisNode | undefined, goalIssue?: number): JarvisNode {
  if (!node || !["windows", "macos", "linux"].includes(node.kind) ||
    node.pcAuthority?.version !== 1 || !node.pcAuthority.roles.includes("Executor") ||
    !node.pcAuthority.capabilityCeiling.includes("filesystem") || !node.capabilities.includes("filesystem") ||
    (goalIssue !== undefined && node.pcAuthority.goalIssue !== goalIssue)) throw new Error("PC_EXECUTOR_AUTHORITY_REQUIRED");
  return node;
}
export function pcDigest(content: string): { sha256: string; bytes: number } {
  return { sha256: createHash("sha256").update(content, "utf8").digest("hex"), bytes: Buffer.byteLength(content) };
}
function inputOf(task: DurableTask): PcPublicWorkInput {
  if (task.type !== PC_PUBLIC_DIGEST || task.requiredCapabilities.length !== 1 || task.requiredCapabilities[0] !== "filesystem" ||
    task.migrationClass !== "RESTARTABLE") throw new PcWorkConflict("PC_TASK_CONTRACT_REJECTED");
  return validatePcPublicWork(task.payload);
}
/** Adapter to existing durable claims; registered identity/authority remain Broker-owned. */
export class PcDurableWork {
  private readonly runtime: DurableTaskRuntime;
  private readonly nodes: () => JarvisNode[];
  constructor(runtime: DurableTaskRuntime, nodes: () => JarvisNode[]) { this.runtime = runtime; this.nodes = nodes; }
  async enqueue(value: unknown, now = new Date()): Promise<DurableTask> {
    const input = validatePcPublicWork(value);
    const eligible = this.nodes().filter(n => {
      try { assertPcExecutor(n, input.goalIssue); return !input.targetNodeId || n.id === input.targetNodeId; } catch { return false; }
    });
    if (!eligible.length) throw new Error("PC_EXECUTOR_AUTHORITY_REQUIRED");
    const id = "pc-" + createHash("sha256").update(`${input.goalIssue}:${input.idempotencyKey}`).digest("hex");
    const prior = await this.runtime.get(id);
    if (prior) {
      if (!isDeepStrictEqual(prior.payload, input)) throw new PcWorkConflict("PC_IDEMPOTENCY_CONFLICT");
      return prior;
    }
    const task = await this.runtime.enqueue({ id, idempotencyKey: id, type: PC_PUBLIC_DIGEST, payload: { ...input },
      requiredCapabilities: ["filesystem"], migrationClass: "RESTARTABLE", maxAttempts: 3 }, now);
    if (!isDeepStrictEqual(task.payload, input)) throw new PcWorkConflict("PC_IDEMPOTENCY_CONFLICT");
    return task;
  }
  async next(nodeId: string, now = new Date()): Promise<{ task: DurableTask | null; claim?: DurableTaskExecutionClaim }> {
    const node = assertPcExecutor(this.nodes().find(n => n.id === nodeId));
    if (!["ready", "busy"].includes(node.status) || !Number.isFinite(Date.parse(node.lastSeenAt)) ||
      now.getTime() - Date.parse(node.lastSeenAt) > 300000 || Date.parse(node.lastSeenAt) > now.getTime() + 5000) {
      throw new PcWorkConflict("PC_HEARTBEAT_REQUIRED");
    }
    await this.runtime.reclaimExpiredLeases(now);
    const eligible = (task: DurableTask) => {
      const input = inputOf(task);
      return input.goalIssue === node.pcAuthority!.goalIssue && (!input.targetNodeId || input.targetNodeId === node.id);
    };
    const tasks = (await this.runtime.list()).filter(t => t.type === PC_PUBLIC_DIGEST);
    const active = tasks.find(t => ["leased", "running"].includes(t.status) && t.leaseOwner === node.id);
    if (active) {
      if (!eligible(active)) throw new PcWorkConflict("PC_TASK_AUTHORITY_CHANGED");
      const claim = { taskId: active.id, owner: node.id, epoch: active.executionEpoch,
        fencingToken: active.fencingToken!, leaseUntil: active.leaseUntil! };
      if (active.status === "leased") await this.runtime.markRunningClaimed(claim, now);
      return { task: (await this.runtime.get(active.id))!, claim };
    }
    const task = tasks.filter(t => ["queued", "retrying"].includes(t.status) && eligible(t) &&
      (!t.nextAttemptAt || Date.parse(t.nextAttemptAt) <= now.getTime())).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!task) return { task: null };
    const claim = await this.runtime.leaseClaim(task.id, node.id, 120000, now);
    const running = await this.runtime.markRunningClaimed(claim, now);
    return { task: running, claim };
  }
  async complete(nodeId: string, value: unknown, now = new Date()): Promise<DurableTask> {
    const input = value as { taskId: string; claim: DurableTaskExecutionClaim; detail: { sha256: string; bytes: number } };
    const claim = input?.claim, task = typeof input?.taskId === "string" ? await this.runtime.get(input.taskId) : undefined;
    if (!task || !claim || claim.taskId !== task.id || claim.owner !== nodeId ||
      !Number.isSafeInteger(claim.epoch) || claim.epoch < 1 || typeof claim.fencingToken !== "string" ||
      claim.leaseUntil !== task.leaseUntil) throw new PcWorkConflict("PC_RESULT_CLAIM_REJECTED");
    const work = inputOf(task);
    assertPcExecutor(this.nodes().find(n => n.id === nodeId), work.goalIssue);
    if (work.targetNodeId && work.targetNodeId !== nodeId) throw new PcWorkConflict("PC_RESULT_TARGET_REJECTED");
    const expected = pcDigest(work.content);
    if (!input.detail || Object.keys(input.detail).some(k => !["sha256", "bytes"].includes(k)) ||
      !isDeepStrictEqual(input.detail, expected)) throw new PcWorkConflict("PC_RESULT_DIGEST_REJECTED");
    try {
      return await this.runtime.completeClaimed(claim, { ...expected, nodeId, goalIssue: work.goalIssue,
        verified: true, issuer: "signed-worker-request", executionEpoch: claim.epoch, observedAt: now.toISOString() }, now);
    } catch { throw new PcWorkConflict("PC_RESULT_STALE_OR_CONFLICT"); }
  }
}
