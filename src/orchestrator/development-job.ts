export type DevelopmentRisk = "low" | "medium" | "high" | "critical";

export type DevelopmentJobPhase =
  | "QUEUED"
  | "PLANNING"
  | "IMPLEMENTING"
  | "WAITING_FOR_CONNECTIVITY"
  | "WAITING_FOR_RESOURCE"
  | "VERIFYING"
  | "RECOVERING"
  | "READY_TO_PUBLISH"
  | "PUBLISHING"
  | "HUMAN_GATE"
  | "BLOCKED"
  | "COMPLETED"
  | "CANCELLED";

export interface DevelopmentDefinitionOfDoneItem {
  id: string;
  description: string;
  required: boolean;
}

export interface DevelopmentApprovalScope {
  taskScopeId: string;
  maxRisk: DevelopmentRisk;
  expiresAt?: string;
}

export interface DevelopmentWorkItem {
  id: string;
  objective: string;
  dependsOn: string[];
  requiredCapabilities: string[];
}

export interface DevelopmentEvidence {
  id: string;
  criterionId: string;
  kind: string;
  issuer: string;
  verified: boolean;
  sourceRevision?: string;
  artifactDigest?: string;
  environment?: string;
  recordedAt?: string;
}

export interface DevelopmentFailure {
  signature: string;
  strategyId: string;
  hypothesis: string;
}

export interface DevelopmentAttempt {
  signature: string;
  strategyId: string;
  hypothesis: string;
  recordedAt: string;
}

export interface DevelopmentJobTransition {
  transitionId: string;
  from: DevelopmentJobPhase | null;
  to: DevelopmentJobPhase;
  actor: "state-controller";
  reason: string;
  at: string;
  evidenceIds: string[];
  failureSignature?: string;
  strategyId?: string;
}

export interface DevelopmentJob {
  version: 1;
  jobId: string;
  goalId: string;
  requirementIds: string[];
  acceptanceCriteria: string[];
  definitionOfDone: DevelopmentDefinitionOfDoneItem[];
  baseRevision: string;
  approvalScope: DevelopmentApprovalScope;
  workItems: DevelopmentWorkItem[];
  phase: DevelopmentJobPhase;
  evidence: DevelopmentEvidence[];
  attempts: DevelopmentAttempt[];
  failureSignatures: string[];
  rejectedStrategyIds: string[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
  history: DevelopmentJobTransition[];
}

export interface DevelopmentJobCreateInput {
  jobId: string;
  goalId: string;
  requirementIds: string[];
  acceptanceCriteria: string[];
  definitionOfDone: DevelopmentDefinitionOfDoneItem[];
  baseRevision: string;
  approvalScope: DevelopmentApprovalScope;
  workItems: DevelopmentWorkItem[];
}

export interface DevelopmentTransitionRequest {
  transitionId: string;
  actor: string;
  to: DevelopmentJobPhase;
  reason: string;
  at?: string;
  evidence?: DevelopmentEvidence[];
  failure?: DevelopmentFailure;
}

const ALLOWED: Readonly<Record<DevelopmentJobPhase, ReadonlySet<DevelopmentJobPhase>>> = {
  QUEUED: new Set(["PLANNING", "WAITING_FOR_CONNECTIVITY", "WAITING_FOR_RESOURCE", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  PLANNING: new Set(["IMPLEMENTING", "WAITING_FOR_CONNECTIVITY", "WAITING_FOR_RESOURCE", "RECOVERING", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  IMPLEMENTING: new Set(["VERIFYING", "WAITING_FOR_CONNECTIVITY", "WAITING_FOR_RESOURCE", "RECOVERING", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  WAITING_FOR_CONNECTIVITY: new Set(["PLANNING", "IMPLEMENTING", "RECOVERING", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  WAITING_FOR_RESOURCE: new Set(["PLANNING", "IMPLEMENTING", "RECOVERING", "WAITING_FOR_CONNECTIVITY", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  VERIFYING: new Set(["READY_TO_PUBLISH", "COMPLETED", "RECOVERING", "WAITING_FOR_CONNECTIVITY", "WAITING_FOR_RESOURCE", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  RECOVERING: new Set(["PLANNING", "IMPLEMENTING", "VERIFYING", "WAITING_FOR_CONNECTIVITY", "WAITING_FOR_RESOURCE", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  READY_TO_PUBLISH: new Set(["PUBLISHING", "RECOVERING", "WAITING_FOR_CONNECTIVITY", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  PUBLISHING: new Set(["VERIFYING", "COMPLETED", "RECOVERING", "WAITING_FOR_CONNECTIVITY", "HUMAN_GATE", "BLOCKED", "CANCELLED"]),
  HUMAN_GATE: new Set(["PLANNING", "IMPLEMENTING", "VERIFYING", "RECOVERING", "READY_TO_PUBLISH", "BLOCKED", "CANCELLED"]),
  BLOCKED: new Set(["PLANNING", "RECOVERING", "HUMAN_GATE", "CANCELLED"]),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requiredText(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
}

function validIso(value: string | undefined): boolean {
  return value === undefined || Number.isFinite(Date.parse(value));
}

export function assertDevelopmentJob(job: DevelopmentJob): void {
  if (job.version !== 1) throw new Error("invalid development job version");
  requiredText(job.jobId, "jobId");
  requiredText(job.goalId, "goalId");
  if (!/^[a-f0-9]{40,64}$/.test(job.baseRevision)) throw new Error("invalid base revision");
  requiredText(job.approvalScope?.taskScopeId, "approval task scope");
  if (!(["low", "medium", "high", "critical"] as const).includes(job.approvalScope?.maxRisk)) {
    throw new Error("invalid approval risk");
  }
  if (!validIso(job.approvalScope.expiresAt)) throw new Error("invalid approval expiry");
  if (!Array.isArray(job.definitionOfDone) || job.definitionOfDone.length < 1) throw new Error("definition of done is required");
  if (!Array.isArray(job.workItems) || job.workItems.length < 1) throw new Error("work item is required");
  const dodIds = new Set<string>();
  for (const item of job.definitionOfDone) {
    requiredText(item.id, "definition of done id");
    requiredText(item.description, "definition of done description");
    if (dodIds.has(item.id)) throw new Error(`duplicate definition of done id: ${item.id}`);
    dodIds.add(item.id);
  }
  const workIds = new Set<string>();
  for (const item of job.workItems) {
    requiredText(item.id, "work item id");
    requiredText(item.objective, "work item objective");
    if (workIds.has(item.id)) throw new Error(`duplicate work item id: ${item.id}`);
    workIds.add(item.id);
  }
  for (const item of job.workItems) {
    if (item.dependsOn.some((id) => !workIds.has(id) || id === item.id)) throw new Error(`invalid work dependency for ${item.id}`);
  }
  if (!ALLOWED[job.phase]) throw new Error("invalid development job phase");
  if (!validIso(job.createdAt) || !validIso(job.updatedAt)) throw new Error("invalid development job timestamp");
}

export function createDevelopmentJob(input: DevelopmentJobCreateInput, now = new Date()): DevelopmentJob {
  const at = now.toISOString();
  const job: DevelopmentJob = {
    version: 1,
    jobId: input.jobId,
    goalId: input.goalId,
    requirementIds: [...new Set(input.requirementIds)],
    acceptanceCriteria: [...input.acceptanceCriteria],
    definitionOfDone: clone(input.definitionOfDone),
    baseRevision: input.baseRevision,
    approvalScope: clone(input.approvalScope),
    workItems: clone(input.workItems),
    phase: "QUEUED",
    evidence: [],
    attempts: [],
    failureSignatures: [],
    rejectedStrategyIds: [],
    blockers: [],
    createdAt: at,
    updatedAt: at,
    history: [{
      transitionId: `create:${input.jobId}`,
      from: null,
      to: "QUEUED",
      actor: "state-controller",
      reason: "development job created",
      at,
      evidenceIds: [],
    }],
  };
  assertDevelopmentJob(job);
  return job;
}

function mergeEvidence(current: DevelopmentEvidence[], incoming: DevelopmentEvidence[]): DevelopmentEvidence[] {
  const byId = new Map(current.map((item) => [item.id, clone(item)]));
  for (const item of incoming) {
    requiredText(item.id, "evidence id");
    requiredText(item.criterionId, "evidence criterion");
    requiredText(item.kind, "evidence kind");
    requiredText(item.issuer, "evidence issuer");
    const existing = byId.get(item.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw new Error(`evidence identity conflict: ${item.id}`);
    byId.set(item.id, clone(item));
  }
  return [...byId.values()];
}

function completionBlockers(job: DevelopmentJob): string[] {
  return job.definitionOfDone
    .filter((item) => item.required)
    .filter((item) => !job.evidence.some((evidence) => evidence.criterionId === item.id && evidence.verified))
    .map((item) => `missing_verified_evidence:${item.id}`);
}

export class DevelopmentJobStateController {
  apply(current: DevelopmentJob, request: DevelopmentTransitionRequest): DevelopmentJob {
    assertDevelopmentJob(current);
    requiredText(request.transitionId, "transitionId");
    requiredText(request.reason, "transition reason");
    const existing = current.history.find((entry) => entry.transitionId === request.transitionId);
    if (existing) {
      const requestedAt = request.at ?? existing.at;
      if (existing.to !== request.to || existing.reason !== request.reason || existing.at !== requestedAt) {
        throw new Error(`transition identity conflict: ${request.transitionId}`);
      }
      return clone(current);
    }
    if (request.actor !== "state-controller") throw new Error("only the state controller may commit development transitions");
    if (!ALLOWED[current.phase].has(request.to)) throw new Error(`illegal transition: ${current.phase} -> ${request.to}`);

    const at = request.at ?? new Date().toISOString();
    if (!validIso(at)) throw new Error("invalid transition timestamp");
    const next = clone(current);
    next.evidence = mergeEvidence(next.evidence, request.evidence ?? []);
    let target = request.to;
    let blockers: string[] = [];
    if (target === "COMPLETED") {
      blockers = completionBlockers(next);
      if (blockers.length) target = "BLOCKED";
    }
    if (request.failure) {
      requiredText(request.failure.signature, "failure signature");
      requiredText(request.failure.strategyId, "strategy id");
      requiredText(request.failure.hypothesis, "failure hypothesis");
      next.failureSignatures = [...new Set([...next.failureSignatures, request.failure.signature])];
      next.rejectedStrategyIds = [...new Set([...next.rejectedStrategyIds, request.failure.strategyId])];
      next.attempts.push({ ...clone(request.failure), recordedAt: at });
    }
    next.phase = target;
    next.blockers = blockers;
    next.updatedAt = at;
    next.history.push({
      transitionId: request.transitionId,
      from: current.phase,
      to: target,
      actor: "state-controller",
      reason: blockers.length ? `completion blocked: ${blockers.join(",")}` : request.reason,
      at,
      evidenceIds: (request.evidence ?? []).map((item) => item.id),
      failureSignature: request.failure?.signature,
      strategyId: request.failure?.strategyId,
    });
    assertDevelopmentJob(next);
    return next;
  }
}

