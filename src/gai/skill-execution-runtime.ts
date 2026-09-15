import { createHash, randomUUID } from "node:crypto";

import { JarvisExecutionRouter, type JarvisDispatchDecision } from "../jarvis/execution-router.ts";
import type { JarvisCapability, JarvisConnectionSnapshot, JarvisTask } from "../jarvis/types.ts";
import { PersistentSkillLibrary, type SkillEnvironment, type SkillRecord } from "./skill-library.ts";

const JARVIS_CAPABILITIES = new Set<JarvisCapability>([
  "browser", "open-url", "open-app", "launch-settings", "device-status", "show-notification", "lock-device", "reboot",
  "device-owner", "ui-automation", "self-update", "filesystem", "camera", "gps", "bluetooth", "local-model",
  "speech-to-text", "text-to-speech", "gpu", "remote-view", "remote-control", "wake-device", "background-worker", "long-running",
]);

interface ExecutableProcedure {
  capability: JarvisCapability;
  input: Record<string, unknown>;
}

export interface SkillExecutionRequest {
  skillId: string;
  input?: Record<string, unknown>;
  environment: SkillEnvironment;
  connectivity: JarvisConnectionSnapshot;
  priority?: JarvisTask["priority"];
  idempotencyKey?: string;
  destructive?: boolean;
  externalPublication?: boolean;
  requiresSecret?: boolean;
  requiresPermissionChange?: boolean;
  incrementalCostYen?: number;
  now?: Date;
}

export interface SkillExecutionStart {
  skill: SkillRecord;
  task: JarvisTask;
  decision: JarvisDispatchDecision;
}

export interface SkillVerificationResult {
  taskId: string;
  passed: boolean;
  evidence: string[];
  now?: Date;
}

function riskRank(risk: "low" | "medium" | "high"): number {
  return { low: 0, medium: 1, high: 2 }[risk];
}

function assertExecutable(skill: SkillRecord, environment: SkillEnvironment): void {
  if (skill.status !== "active") throw new Error(`Skill ${skill.id} is not certified active`);
  const constraints = skill.constraints;
  if (!constraints) return;
  for (const capability of constraints.capabilities ?? []) {
    if (!environment.capabilities?.includes(capability)) throw new Error(`Skill ${skill.id} requires capability ${capability}`);
  }
  for (const resource of constraints.resources ?? []) {
    if (!environment.resources?.includes(resource)) throw new Error(`Skill ${skill.id} requires resource ${resource}`);
  }
  if (constraints.executionModes?.length && (!environment.executionMode || !constraints.executionModes.includes(environment.executionMode))) {
    throw new Error(`Skill ${skill.id} does not allow execution mode ${environment.executionMode ?? "unknown"}`);
  }
  if (constraints.maxRisk && environment.risk && riskRank(environment.risk) > riskRank(constraints.maxRisk)) {
    throw new Error(`Skill ${skill.id} risk ${environment.risk} exceeds ${constraints.maxRisk}`);
  }
}

function parseProcedure(skill: SkillRecord): ExecutableProcedure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(skill.procedure);
  } catch {
    throw new Error(`Skill ${skill.id} procedure is not a valid execution envelope`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Skill ${skill.id} procedure must be an object`);
  const value = parsed as Record<string, unknown>;
  if (typeof value.capability !== "string" || !JARVIS_CAPABILITIES.has(value.capability as JarvisCapability)) {
    throw new Error(`Skill ${skill.id} uses unknown Jarvis capability ${String(value.capability)}`);
  }
  if (value.input !== undefined && (!value.input || typeof value.input !== "object" || Array.isArray(value.input))) {
    throw new Error(`Skill ${skill.id} procedure input must be an object`);
  }
  return { capability: value.capability as JarvisCapability, input: (value.input ?? {}) as Record<string, unknown> };
}

function requiredCapabilities(skill: SkillRecord, procedure: ExecutableProcedure): JarvisCapability[] {
  const capabilities = new Set<JarvisCapability>([procedure.capability]);
  for (const capability of skill.constraints?.capabilities ?? []) {
    if (!JARVIS_CAPABILITIES.has(capability as JarvisCapability)) throw new Error(`Skill ${skill.id} constraint uses unknown Jarvis capability ${capability}`);
    capabilities.add(capability as JarvisCapability);
  }
  return [...capabilities];
}

function stableKey(skill: SkillRecord, input: Record<string, unknown>): string {
  const digest = createHash("sha256").update(JSON.stringify(input, Object.keys(input).sort())).digest("hex").slice(0, 20);
  return `skill:${skill.id}:v${skill.version ?? 1}:${digest}`;
}

export class CertifiedSkillExecutionRuntime {
  private readonly executions = new Map<string, { skillId: string; skillVersion: number }>();
  private readonly skills: PersistentSkillLibrary;
  private readonly router: JarvisExecutionRouter;

  constructor(skills: PersistentSkillLibrary, router: JarvisExecutionRouter) {
    this.skills = skills;
    this.router = router;
  }

  async start(request: SkillExecutionRequest): Promise<SkillExecutionStart> {
    const skill = await this.skills.get(request.skillId);
    if (!skill) throw new Error(`Unknown skill: ${request.skillId}`);
    assertExecutable(skill, request.environment);
    const procedure = parseProcedure(skill);
    const input = request.input ?? {};
    const idempotencyKey = request.idempotencyKey ?? stableKey(skill, input);
    const existing = this.router.queue.list().find((task) => task.idempotencyKey === idempotencyKey && task.status !== "failed" && task.status !== "cancelled");
    if (existing) throw new Error(`Skill execution already exists for idempotency key ${idempotencyKey}`);

    const now = request.now ?? new Date();
    const task: JarvisTask = {
      id: randomUUID(),
      idempotencyKey,
      type: "gai.skill.execute",
      payload: {
        skill: { id: skill.id, version: skill.version ?? 1, provenance: skill.provenance, certificationEvidence: skill.certificationEvidence ?? [] },
        procedure,
        input,
      },
      status: "queued",
      requiredCapabilities: requiredCapabilities(skill, procedure),
      priority: request.priority ?? "normal",
      requiresOnline: skill.constraints?.connectivity === "online-required",
      attempts: 0,
      maxAttempts: 3,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const queued = this.router.queue.enqueue(task);
    const decision = this.router.dispatchNext({
      connectivity: request.connectivity,
      incrementalCostYen: request.incrementalCostYen,
      destructive: request.destructive,
      externalPublication: request.externalPublication,
      requiresSecret: request.requiresSecret,
      requiresPermissionChange: request.requiresPermissionChange,
      now,
    });
    if (!decision || decision.task.id !== queued.id) throw new Error(`Skill task ${queued.id} was not selected for dispatch`);
    this.executions.set(queued.id, { skillId: skill.id, skillVersion: skill.version ?? 1 });
    return { skill, task: decision.task, decision };
  }

  async recordVerifiedOutcome(result: SkillVerificationResult): Promise<SkillRecord> {
    if (result.evidence.length === 0) throw new Error("Verified skill outcome requires evidence");
    const execution = this.executions.get(result.taskId);
    if (!execution) throw new Error(`Unknown skill execution: ${result.taskId}`);
    const task = this.router.queue.get(result.taskId);
    if (!task) throw new Error(`Unknown task: ${result.taskId}`);
    if (task.status !== "running" && task.status !== "leased") throw new Error(`Task ${result.taskId} is not executing`);

    if (result.passed) this.router.queue.complete(result.taskId, result.now);
    else this.router.queue.fail(result.taskId, result.now);
    const updated = await this.skills.recordOutcome(execution.skillId, result.passed);
    if (!updated) throw new Error(`Unknown skill: ${execution.skillId}`);
    this.executions.delete(result.taskId);
    return updated;
  }
}
