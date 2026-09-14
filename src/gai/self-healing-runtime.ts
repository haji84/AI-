import type { ActionResult, VerificationResult } from "../orchestrator/goal-loop.ts";
import {
  evaluateRecovery,
  type FailureClass,
  type RecoveryDecision,
  type RecoveryLimits,
} from "../orchestrator/recovery-policy.ts";
import { DurableTaskRuntime, type DurableTask } from "./durable-task-runtime.ts";
import {
  MultiWorkerRuntime,
  type WorkerExecutionRequest,
  type WorkerExecutionResult,
} from "./worker-runtime.ts";

export type FailureKind =
  | "connectivity"
  | "worker-unavailable"
  | "process"
  | "model"
  | "gpu"
  | "tool"
  | "dependency"
  | "resource"
  | "ui"
  | "verification"
  | "permission"
  | "credential"
  | "billing"
  | "destructive"
  | "security"
  | "human-gate"
  | "unknown";

export interface ClassifiedFailure {
  kind: FailureKind;
  failureClass: FailureClass;
  signature: string;
  summary: string;
  hardBlocker: boolean;
  humanInterventionHint?: string;
}

export interface RecoveryHistoryState {
  failureSignature: string;
  attemptsForSignature: number;
  strategyPivots: number;
  totalAttempts: number;
}

export type HealingAction =
  | "retry_same"
  | "repair"
  | "fallback_worker"
  | "wait_connectivity"
  | "wait_resource"
  | "replan"
  | "blocked";

export interface HealingDecision {
  action: HealingAction;
  failure: ClassifiedFailure;
  recovery: RecoveryDecision;
  reason: string;
  excludedWorkerIds?: string[];
  replanHint?: string;
}

export interface HealingEvidence {
  taskId?: string;
  failure: ClassifiedFailure;
  action: HealingAction;
  reason: string;
  at: string;
  attemptedWorkerIds?: string[];
  selectedFallbackWorkerId?: string;
  recovery: RecoveryDecision;
  verificationRequired?: boolean;
}

const HARD_FAILURES = new Set<FailureKind>([
  "permission",
  "credential",
  "billing",
  "destructive",
  "security",
  "human-gate",
]);

function normalizedText(input: unknown): string {
  if (input instanceof Error) return `${input.name}: ${input.message}`;
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const value = input as { summary?: unknown; blocker?: unknown; output?: unknown };
    return [value.summary, value.blocker, value.output].filter((part) => typeof part === "string").join(" | ");
  }
  return String(input ?? "unknown failure");
}

function classifyKind(text: string): FailureKind {
  const value = text.toLowerCase();
  if (/human[_ -]?gate|approval required|human approval/.test(value)) return "human-gate";
  if (/credential|token|secret|password|authentication|unauthorized|401\b/.test(value)) return "credential";
  if (/permission|forbidden|403\b|access denied/.test(value)) return "permission";
  if (/billing|payment|purchase|paid api|quota.*billing/.test(value)) return "billing";
  if (/destructive|delete production|drop table|irreversible/.test(value)) return "destructive";
  if (/security|governance weakening|prompt injection|policy violation/.test(value)) return "security";
  if (/network|offline|connect|econn|dns|socket|unreachable/.test(value)) return "connectivity";
  if (/no healthy worker|worker unavailable|worker.*offline|runner unavailable/.test(value)) return "worker-unavailable";
  if (/gpu|cuda|vram/.test(value)) return "gpu";
  if (/model|ollama|inference/.test(value)) return "model";
  if (/dependency|module not found|package missing/.test(value)) return "dependency";
  if (/memory|disk|cpu|resource|busy/.test(value)) return "resource";
  if (/selector|element|screen|accessibility|ui changed/.test(value)) return "ui";
  if (/verify|verification|expected.*actual|assert/.test(value)) return "verification";
  if (/tool|command not found|executable/.test(value)) return "tool";
  if (/timeout|timed out|temporar|rate limit|429\b/.test(value)) return "process";
  if (/process|crash|exit code|spawn|signal/.test(value)) return "process";
  return "unknown";
}

function failureClassFor(kind: FailureKind, text: string): FailureClass {
  if (kind === "connectivity" || /timeout|temporar|429\b/.test(text.toLowerCase())) return "transient";
  if (kind === "permission" || kind === "credential" || kind === "billing" || kind === "destructive" || kind === "security" || kind === "human-gate") return "environment";
  if (kind === "worker-unavailable" || kind === "resource") return "environment";
  if (kind === "unknown") return "unknown";
  return "implementation";
}

function signatureFor(kind: FailureKind, text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${kind}:${normalized}`;
}

export function classifyFailure(input: unknown): ClassifiedFailure {
  const text = normalizedText(input);
  const kind = classifyKind(text);
  const hardBlocker = HARD_FAILURES.has(kind);
  return {
    kind,
    failureClass: failureClassFor(kind, text),
    signature: signatureFor(kind, text),
    summary: text,
    hardBlocker,
    humanInterventionHint: hardBlocker
      ? "Provide only the required explicit approval, credential, permission, billing decision, or security/governance decision."
      : undefined,
  };
}

export function decideHealing(input: {
  failure: ClassifiedFailure;
  history: RecoveryHistoryState;
  failedWorkerId?: string;
  limits?: RecoveryLimits;
}): HealingDecision {
  const explicitBlocker = input.failure.hardBlocker ? input.failure.summary : undefined;
  const recovery = evaluateRecovery({
    failureSignature: input.history.failureSignature || input.failure.signature,
    failureClass: input.failure.failureClass,
    attemptsForSignature: input.history.attemptsForSignature,
    strategyPivots: input.history.strategyPivots,
    totalAttempts: input.history.totalAttempts,
    explicitBlocker,
  }, input.limits);

  if (input.failure.kind === "connectivity" && !input.failure.hardBlocker) {
    return { action: "wait_connectivity", failure: input.failure, recovery, reason: "Connectivity failure should wait durably without burning repair attempts" };
  }
  if ((input.failure.kind === "worker-unavailable" || input.failure.kind === "resource" || input.failure.kind === "gpu") && !input.failure.hardBlocker) {
    return {
      action: input.failedWorkerId ? "fallback_worker" : "wait_resource",
      failure: input.failure,
      recovery,
      reason: input.failedWorkerId ? "Try another compatible healthy worker before escalating" : "Required resource is currently unavailable",
      excludedWorkerIds: input.failedWorkerId ? [input.failedWorkerId] : undefined,
    };
  }
  if (recovery.action === "strategy_pivot") {
    return {
      action: "replan",
      failure: input.failure,
      recovery,
      reason: recovery.reason,
      replanHint: `Choose a materially different strategy for ${input.failure.kind}; do not repeat failure signature ${input.failure.signature}`,
    };
  }
  if (recovery.action === "retry_same") return { action: "retry_same", failure: input.failure, recovery, reason: recovery.reason };
  if (recovery.action === "repair") return { action: "repair", failure: input.failure, recovery, reason: recovery.reason };
  return { action: "blocked", failure: input.failure, recovery, reason: recovery.reason };
}

export class SelfHealingRuntime {
  private readonly tasks: DurableTaskRuntime;
  private readonly workers: MultiWorkerRuntime;
  private readonly limits?: RecoveryLimits;

  constructor(options: { tasks: DurableTaskRuntime; workers: MultiWorkerRuntime; limits?: RecoveryLimits }) {
    this.tasks = options.tasks;
    this.workers = options.workers;
    this.limits = options.limits;
  }

  async handleTaskFailure(input: {
    task: DurableTask;
    failure: unknown;
    history: RecoveryHistoryState;
    failedWorkerId?: string;
    request?: WorkerExecutionRequest;
    now?: Date;
  }): Promise<{ task: DurableTask; decision: HealingDecision; evidence: HealingEvidence; fallbackResult?: WorkerExecutionResult }> {
    const now = input.now ?? new Date();
    const failure = classifyFailure(input.failure);
    const decision = decideHealing({ failure, history: input.history, failedWorkerId: input.failedWorkerId, limits: this.limits });
    let task: DurableTask;
    let fallbackResult: WorkerExecutionResult | undefined;
    let selectedFallbackWorkerId: string | undefined;
    let verificationRequired = false;

    if (decision.action === "wait_connectivity") {
      task = await this.tasks.waitForConnectivity(input.task.id, failure.summary, now);
    } else if (decision.action === "wait_resource") {
      task = await this.tasks.waitForResource(input.task.id, failure.summary, now);
    } else if (decision.action === "fallback_worker" && input.request) {
      try {
        const request = {
          ...input.request,
          excludedWorkerIds: [...new Set([...(input.request.excludedWorkerIds ?? []), ...(decision.excludedWorkerIds ?? [])])],
        };
        const selection = await this.workers.select(request);
        selectedFallbackWorkerId = selection.worker.descriptor.id;
        const current = await this.tasks.get(input.task.id);
        if (current && (current.status === "leased" || current.status === "running") && current.leaseOwner) {
          await this.tasks.fail(current.id, current.leaseOwner, failure.summary, 0, now);
        }
        await this.tasks.lease(input.task.id, selectedFallbackWorkerId, 120_000, now);
        await this.tasks.markRunning(input.task.id, selectedFallbackWorkerId, now);
        fallbackResult = await selection.worker.execute(request);
        if (fallbackResult.ok) {
          task = (await this.tasks.get(input.task.id)) ?? input.task;
          verificationRequired = true;
        } else {
          task = await this.tasks.fail(input.task.id, selectedFallbackWorkerId, fallbackResult.output, 0, now);
        }
      } catch (error) {
        const current = await this.tasks.get(input.task.id);
        if (current && (current.status === "leased" || current.status === "running") && current.leaseOwner) {
          await this.tasks.fail(current.id, current.leaseOwner, failure.summary, 0, now);
        }
        task = await this.tasks.waitForResource(input.task.id, error instanceof Error ? error.message : String(error), now);
      }
    } else if (decision.action === "blocked") {
      task = input.task;
    } else {
      const current = await this.tasks.get(input.task.id);
      if (current && (current.status === "leased" || current.status === "running") && current.leaseOwner) {
        task = await this.tasks.fail(current.id, current.leaseOwner, failure.summary, 0, now);
      } else {
        task = current ?? input.task;
      }
    }

    return {
      task,
      decision,
      fallbackResult,
      evidence: {
        taskId: input.task.id,
        failure,
        action: decision.action,
        reason: decision.reason,
        at: now.toISOString(),
        attemptedWorkerIds: input.failedWorkerId ? [input.failedWorkerId] : undefined,
        selectedFallbackWorkerId,
        recovery: decision.recovery,
        verificationRequired,
      },
    };
  }

  async completeAfterVerification(input: {
    taskId: string;
    workerId: string;
    workerResult: WorkerExecutionResult;
    verification: VerificationResult;
    now?: Date;
  }): Promise<DurableTask> {
    const now = input.now ?? new Date();
    if (!input.workerResult.ok) throw new Error("Cannot complete a failed worker result");
    if (!input.verification.ok) {
      return this.tasks.fail(
        input.taskId,
        input.workerId,
        `verification failed: ${input.verification.summary}`,
        0,
        now,
      );
    }
    return this.tasks.complete(input.taskId, input.workerId, {
      recoveredBy: input.workerId,
      output: input.workerResult.output,
      workerEvidence: input.workerResult.evidence ?? null,
      verification: {
        ok: true,
        summary: input.verification.summary,
        evidence: input.verification.evidence ?? null,
      },
    }, now);
  }
}

export function classifyVerificationFailure(verification: VerificationResult): ClassifiedFailure | null {
  return verification.ok ? null : classifyFailure({ summary: `verification failed: ${verification.summary}` });
}

export function classifyActionFailure(result: ActionResult): ClassifiedFailure | null {
  return result.ok ? null : classifyFailure(result);
}
