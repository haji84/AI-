import { randomUUID } from "node:crypto";

import { JarvisExecutionRouter, type JarvisDispatchDecision } from "../jarvis/execution-router.ts";
import type { JarvisCapability, JarvisConnectionSnapshot, JarvisTask } from "../jarvis/types.ts";
import { PersistentSkillLibrary, type SkillEnvironment, type SkillRecord } from "./skill-library.ts";

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
  if (constraints.connectivity === "online-required" && environment.online === false) throw new Error(`Skill ${skill.id} requires online connectivity`);
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

function procedurePayload(skill: SkillRecord): Record<string, unknown> {
  try {
    const parsed = JSON.parse(skill.procedure) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Plain-text procedures remain data for a worker; they are never evaluated as code here.
  }
  return { instruction: skill.procedure };
}

function jarvisCapabilities(skill: SkillRecord): JarvisCapability[] {
  return (skill.constraints?.capabilities ?? []) as JarvisCapability[];
}

export class CertifiedSkillExecutionRuntime {
  private readonly executions = new Map<string, { skillId: string; skillVersion: number }>();

  constructor(
    private readonly skills: PersistentSkillLibrary,
    private readonly router: JarvisExecutionRouter,
  ) {}

  async start(request: SkillExecutionRequest): Promise<SkillExecutionStart> {
    const skill = await this.skills.get(request.skillId);
    if (!skill) throw new Error(`Unknown skill: ${request.skillId}`);
    assertExecutable(skill, request.environment);

    const now = request.now ?? new Date();
    const taskId = randomUUID();
    const task: JarvisTask = {
      id: taskId,
      idempotencyKey: request.idempotencyKey ?? `skill:${skill.id}:v${skill.version ?? 1}:${taskId}`,
      type: "gai.skill.execute",
      payload: {
        skill: {
          id: skill.id,
          version: skill.version ?? 1,
          provenance: skill.provenance,
          certificationEvidence: skill.certificationEvidence ?? [],
        },
        procedure: procedurePayload(skill),
        input: request.input ?? {},
      },
      status: "queued",
      requiredCapabilities: jarvisCapabilities(skill),
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

    if (result.passed) this.router.queue.complete(result.taskId, result.now);
    else this.router.queue.fail(result.taskId, result.now);

    const updated = await this.skills.recordOutcome(execution.skillId, result.passed);
    if (!updated) throw new Error(`Unknown skill: ${execution.skillId}`);
    this.executions.delete(result.taskId);
    return updated;
  }
}
