import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DurableTaskRuntime, type DurableTask, type DurableTaskExecutionClaim } from "../gai/durable-task-runtime.ts";
import { verifyContextCapsule, type ExecutionContextCapsule } from "../orchestrator/execution-context-capsule.ts";
import type { JarvisNode } from "./types.ts";
import { governedFabricDispatch } from "../orchestrator/governed-fabric-dispatch.ts";
import type { FabricNode } from "../orchestrator/capability-fabric-router.ts";

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
    (input.targetNodeId !== undefined && (typeof input.targetNodeId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(input.targetNodeId)))) throw new Error("PC_WORK_INPUT_REJECTED");
  const c = input.capsule;
  if (!c || typeof c !== "object" || Array.isArray(c) || !verifyContextCapsule(c).ok ||
    c.goal !== `#${input.goalIssue}` || [c.currentJob, c.why, c.workflowPosition, c.verificationContract].some(v => typeof v !== "string" || !v.trim()) ||
    Buffer.byteLength(JSON.stringify(c)) > 16384 ||
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
export interface PcCompletedResult {
  sha256: string; bytes: number; nodeId: string; goalIssue: number; verified: true;
  issuer: "signed-worker-request"; executionEpoch: number; observedAt: string;
}
/** Validate a historical signed completion, never create or revive an execution claim. */
export function verifiedPcCompletion(task: DurableTask, nodeId: string, goalIssue: number, now = new Date()): PcCompletedResult {
  const work = inputOf(task), result = task.result as PcCompletedResult | undefined;
  const expected = pcDigest(work.content), last = task.history?.at(-1);
  if (task.status !== "completed" || task.leaseOwner !== undefined || task.leaseUntil !== undefined ||
    task.fencingToken !== undefined || work.goalIssue !== goalIssue ||
    (work.targetNodeId && work.targetNodeId !== nodeId) || !Number.isSafeInteger(task.executionEpoch) || task.executionEpoch < 1 ||
    !result || result.nodeId !== nodeId || result.goalIssue !== goalIssue || result.verified !== true ||
    result.issuer !== "signed-worker-request" || result.executionEpoch !== task.executionEpoch ||
    result.sha256 !== expected.sha256 || result.bytes !== expected.bytes ||
    typeof result.observedAt !== "string" || !Number.isFinite(Date.parse(result.observedAt)) ||
    Date.parse(result.observedAt) > now.getTime() + 5000 ||
    last?.to !== "completed" || last.actor !== nodeId || last.at !== result.observedAt ||
    last.evidence?.executionEpoch !== task.executionEpoch) throw new PcWorkConflict("PC_WORK_COMPLETION_REJECTED");
  return { ...expected, nodeId, goalIssue, verified: true, issuer: "signed-worker-request",
    executionEpoch: result.executionEpoch, observedAt: result.observedAt };
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
  async next(nodeId: string, now = new Date(), taskId?: string): Promise<{ task: DurableTask | null; claim?: DurableTaskExecutionClaim; completed?: DurableTask }> {
    if (taskId !== undefined && (typeof taskId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(taskId))) throw new PcWorkConflict("PC_TASK_ID_REJECTED");
    const node = assertPcExecutor(this.nodes().find(n => n.id === nodeId));
    if (!["ready", "busy"].includes(node.status) || !Number.isFinite(Date.parse(node.lastSeenAt)) ||
      now.getTime() - Date.parse(node.lastSeenAt) > 300000 || Date.parse(node.lastSeenAt) > now.getTime() + 5000) {
      throw new PcWorkConflict("PC_HEARTBEAT_REQUIRED");
    }
    if (taskId) {
      const prior = await this.runtime.get(taskId);
      if (prior?.status === "completed") {
        if (prior.type !== PC_PUBLIC_DIGEST) return { task: null };
        const work = inputOf(prior), result = prior.result as PcCompletedResult | undefined;
        if (work.goalIssue !== node.pcAuthority!.goalIssue || (work.targetNodeId && work.targetNodeId !== node.id) ||
          result?.nodeId !== node.id) return { task: null };
        verifiedPcCompletion(prior, node.id, node.pcAuthority!.goalIssue, now);
        return { task: null, completed: prior };
      }
    }
    await this.runtime.reclaimExpiredLeases(now);
    const eligible = (task: DurableTask) => {
      const input = inputOf(task);
      return (!taskId || task.id === taskId) && input.goalIssue === node.pcAuthority!.goalIssue && (!input.targetNodeId || input.targetNodeId === node.id);
    };
    const tasks = (await this.runtime.list()).filter(t => t.type === PC_PUBLIC_DIGEST);
    const active = tasks.find(t => ["leased", "running"].includes(t.status) && t.leaseOwner === node.id);
    if (active) {
      if (taskId && active.id !== taskId) return { task: null };
      if (!eligible(active)) throw new PcWorkConflict("PC_TASK_AUTHORITY_CHANGED");
      const claim = { taskId: active.id, owner: node.id, epoch: active.executionEpoch,
        fencingToken: active.fencingToken!, leaseUntil: active.leaseUntil! };
      if (active.status === "leased") await this.runtime.markRunningClaimed(claim, now);
      return { task: (await this.runtime.get(active.id))!, claim };
    }
    const placements = this.pendingPlacements(tasks, now);
    const task = tasks.filter(t => ["queued", "retrying"].includes(t.status) && eligible(t) &&
      (!t.nextAttemptAt || Date.parse(t.nextAttemptAt) <= now.getTime()))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .find(t => placements.get(t.id) === node.id);
    if (!task) return { task: null };
    const claim = await this.runtime.leaseClaimWithCapacity(task.id, node.id, 1, 120000, now);
    const running = await this.runtime.markRunningClaimed(claim, now);
    return { task: running, claim };
  }
  private pendingPlacements(tasks: DurableTask[], now: Date): Map<string, string> {
    const placements = new Map<string, string>();
    const occupied = new Set(tasks.filter(t => ["leased", "running"].includes(t.status) &&
      Date.parse(t.leaseUntil ?? "") > now.getTime()).map(t => t.leaseOwner));
    const pending = tasks.filter(t => ["queued", "retrying"].includes(t.status) &&
      (!t.nextAttemptAt || Date.parse(t.nextAttemptAt) <= now.getTime()))
      .sort((a, b) => Number(Boolean(inputOf(b).targetNodeId)) - Number(Boolean(inputOf(a).targetNodeId)) ||
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const task of pending) {
      const selected = this.selectExecutor(task, occupied, now);
      if (selected) { placements.set(task.id, selected); occupied.add(selected); }
    }
    return placements;
  }
  private selectExecutor(task: DurableTask, occupied: Set<string | undefined>, now: Date): string | undefined {
    const work = inputOf(task);
    const candidates: FabricNode[] = this.nodes().flatMap(node => {
      try { assertPcExecutor(node, work.goalIssue); } catch { return []; }
      if (work.targetNodeId && node.id !== work.targetNodeId) return [];
      const lastSeen = Date.parse(node.lastSeenAt);
      const available = ["ready", "busy"].includes(node.status) && !occupied.has(node.id) &&
        Number.isFinite(lastSeen) && lastSeen <= now.getTime() + 5000 && now.getTime() - lastSeen <= 300000;
      // Fabric online means this execution route is reachable. Public Internet
      // availability is not required for an authenticated local filesystem job.
      // Fixed ranking defaults below are policy weights, not fabricated metrics.
      return [{ id: node.id, kind: "device", capabilities: node.capabilities.filter(c => node.pcAuthority!.capabilityCeiling.includes(c)),
        online: available, healthy: node.telemetry.cpuAvailable !== false && node.telemetry.thermalState !== "critical",
        privacy: "local-only", incrementalCost: 0, latencyMs: 0, reliability: 1, evidenceModes: ["DEVICE"] }];
    });
    const result = governedFabricDispatch({ capsule: work.capsule,
      job: { id: task.id, requiredCapabilities: ["filesystem"], privacy: "public", freshness: "static",
        risk: "low", evidenceMode: "DEVICE", maxIncrementalCost: 0 }, nodes: candidates });
    return result.gate === "PASS" ? result.route.node?.id : undefined;
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
