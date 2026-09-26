import {
  DevelopmentJobStateController,
  createDevelopmentJob,
  type DevelopmentEvidence,
  type DevelopmentJob,
  type DevelopmentJobPhase,
} from "./development-job.ts";

export type DevelopmentStage =
  | "INSPECT"
  | "RESEARCH"
  | "IMPLEMENT"
  | "TEST"
  | "RECOVER"
  | "INDEPENDENT_VERIFY"
  | "DONE"
  | "BLOCKED";

export interface DevelopmentAttempt {
  stage: DevelopmentStage;
  ok: boolean;
  evidenceRefs: string[];
  reason?: string;
  failureSignature?: string;
  strategyId?: string;
  hypothesis?: string;
}

export interface DevelopmentState {
  stage: DevelopmentStage;
  attempts: DevelopmentAttempt[];
  recoveryCount: number;
  job: DevelopmentJob;
}

export interface LegacyDevelopmentIdentity {
  jobId?: string;
  goalId?: string;
  baseRevision?: string;
  taskScopeId?: string;
}

const controller = new DevelopmentJobStateController();

const nextStage: Record<DevelopmentStage, DevelopmentStage> = {
  INSPECT: "RESEARCH",
  RESEARCH: "IMPLEMENT",
  IMPLEMENT: "TEST",
  TEST: "INDEPENDENT_VERIFY",
  RECOVER: "IMPLEMENT",
  INDEPENDENT_VERIFY: "DONE",
  DONE: "DONE",
  BLOCKED: "BLOCKED",
};

const successfulPhase: Partial<Record<DevelopmentStage, DevelopmentJobPhase>> = {
  INSPECT: "PLANNING",
  RESEARCH: "IMPLEMENTING",
  IMPLEMENT: "VERIFYING",
  TEST: "VERIFYING",
  RECOVER: "IMPLEMENTING",
  INDEPENDENT_VERIFY: "COMPLETED",
};

function normalized(value: string | undefined, fallback: string): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") || fallback;
}

function evidenceFor(attempt: DevelopmentAttempt): DevelopmentEvidence[] {
  return attempt.evidenceRefs.map((reference, index) => ({
    id: `legacy:${attempt.stage.toLowerCase()}:${reference}`,
    criterionId: attempt.stage === "INDEPENDENT_VERIFY" && attempt.ok
      ? "legacy-independent-verification"
      : "legacy-observation",
    kind: attempt.stage.toLowerCase(),
    issuer: attempt.stage === "INDEPENDENT_VERIFY" ? "legacy-independent-verifier" : "legacy-runtime",
    verified: attempt.ok,
    recordedAt: new Date().toISOString(),
    artifactDigest: `legacy-ref:${index}:${reference}`,
  }));
}

function applyBlocked(job: DevelopmentJob, transitionId: string, reason: string): DevelopmentJob {
  if (job.phase === "BLOCKED") return job;
  return controller.apply(job, {
    transitionId,
    actor: "state-controller",
    to: "BLOCKED",
    reason,
    blockers: [reason],
  });
}

export function nextDevelopmentState(state: DevelopmentState, attempt: DevelopmentAttempt): DevelopmentState {
  if (state.stage === "DONE" || state.stage === "BLOCKED") return structuredClone(state);
  const attempts = [...state.attempts, structuredClone(attempt)];
  const transitionId = `legacy:${attempts.length}:${attempt.stage}`;

  if (!attempt.evidenceRefs.length) {
    return {
      stage: "BLOCKED",
      attempts,
      recoveryCount: state.recoveryCount,
      job: applyBlocked(state.job, transitionId, "legacy_attempt_missing_evidence"),
    };
  }

  if (!attempt.ok) {
    const signature = normalized(attempt.failureSignature, `${attempt.stage}:${attempt.reason ?? "failure"}`);
    const strategyId = normalized(attempt.strategyId, `legacy-strategy-${attempts.length}`);
    const hypothesis = normalized(attempt.hypothesis, attempt.reason ?? "legacy failure");
    const equivalent = state.job.attempts.some((prior) =>
      prior.signature === signature
      && prior.strategyId === strategyId
      && prior.hypothesis === hypothesis,
    );
    if (equivalent) {
      return {
        stage: "BLOCKED",
        attempts,
        recoveryCount: state.recoveryCount,
        job: applyBlocked(state.job, transitionId, `equivalent_failed_strategy:${strategyId}:${signature}`),
      };
    }
    const job = controller.apply(state.job, {
      transitionId,
      actor: "state-controller",
      to: "RECOVERING",
      reason: attempt.reason ?? "legacy attempt failed; replan required",
      evidence: evidenceFor(attempt),
      failure: { signature, strategyId, hypothesis },
    });
    return { stage: "RECOVER", attempts, recoveryCount: state.recoveryCount + 1, job };
  }

  const stage = nextStage[attempt.stage];
  const phase = successfulPhase[attempt.stage];
  const job = phase
    ? controller.apply(state.job, {
        transitionId,
        actor: "state-controller",
        to: phase,
        reason: `${attempt.stage.toLowerCase()} completed with evidence`,
        evidence: evidenceFor(attempt),
      })
    : state.job;
  return { stage, attempts, recoveryCount: state.recoveryCount, job };
}

export function createDevelopmentState(identity: LegacyDevelopmentIdentity = {}): DevelopmentState {
  const job = createDevelopmentJob({
    jobId: identity.jobId ?? "legacy-self-development-job",
    goalId: identity.goalId ?? "legacy-self-development-goal",
    requirementIds: ["CORE-014"],
    acceptanceCriteria: ["legacy self-development sequence completes with independent evidence"],
    definitionOfDone: [{
      id: "legacy-independent-verification",
      description: "legacy sequence receives independent verification evidence",
      required: true,
    }],
    baseRevision: identity.baseRevision ?? "0".repeat(40),
    approvalScope: { taskScopeId: identity.taskScopeId ?? "legacy-self-development", maxRisk: "low" },
    workItems: [{
      id: "legacy-development-work",
      objective: "complete the compatibility self-development sequence",
      dependsOn: [],
      requiredCapabilities: ["code-builder"],
    }],
  });
  return { stage: "INSPECT", attempts: [], recoveryCount: 0, job };
}
