import { createHash } from "node:crypto";

import type { BoundedRunReport } from "./bounded-runner.ts";
import type { DevelopmentChangeSet } from "./development-change-set.ts";
import type { JsonFileDevelopmentChangeSetStore } from "./development-change-set-store.ts";
import {
  evaluateDevelopmentReleaseGate,
  type DevelopmentPullRequestState,
  type NonBypassableDevelopmentGate,
} from "./development-release-gate.ts";
import { DevelopmentJobStateController, type DevelopmentJob, type DevelopmentRisk } from "./development-job.ts";
import type { DevelopmentJobStore } from "./development-job-store.ts";
import { DevelopmentOrchestrator } from "./development-orchestrator.ts";
import {
  createDevelopmentVerificationPlan,
  evaluateDevelopmentVerification,
  type DevelopmentVerificationEvidence,
  type DevelopmentVerificationPlan,
} from "./development-verification-plan.ts";
import type { ContextItem, Goal } from "./goal-loop.ts";
import type { TaskCompletionAuthorization } from "./task-authorization.ts";

export interface ResidentDevelopmentReleaseState {
  connected: boolean;
  taskScopeId: string;
  taskAuthorization?: TaskCompletionAuthorization;
  protectedConditions: NonBypassableDevelopmentGate[];
  pullRequest: DevelopmentPullRequestState | null;
  mainCi: { revision: string; passed: boolean } | null;
  deployment: { revision: string; artifactDigest: string; environment: "production" } | null;
  postDeploymentEvidence: {
    verifierId: string;
    revision: string;
    artifactDigest: string;
    passed: boolean;
    recordedAt: string;
  } | null;
  now?: Date;
}

export interface ResidentDevelopmentStages {
  builderId?: string;
  build(input: { job: DevelopmentJob; goal: Goal; context: ContextItem[]; workItemId: string }): Promise<DevelopmentChangeSet>;
  verify(input: { job: DevelopmentJob; changeSet: DevelopmentChangeSet; plan: DevelopmentVerificationPlan; goal: Goal; context: ContextItem[] }): Promise<DevelopmentVerificationEvidence[]>;
  releaseState(input: { job: DevelopmentJob; changeSet: DevelopmentChangeSet; goal: Goal; context: ContextItem[] }): Promise<ResidentDevelopmentReleaseState>;
  executeRelease?(action: string, input: { job: DevelopmentJob; changeSet: DevelopmentChangeSet; goal: Goal; context: ContextItem[] }): Promise<void>;
}

export interface ResidentDevelopmentPlanning {
  requirementIds: string[];
  baseRevision: string;
  taskScopeId: string;
  maxRisk: DevelopmentRisk;
  targetFiles: string[];
  contextDigest: string;
}

function report(achieved: boolean, reason: string, blockers: string[] = []): BoundedRunReport {
  return {
    cycles: [],
    stopReason: achieved ? "goal_complete" : blockers.includes("human_gate") ? "approval_required" : blockers.length ? "blocked" : "cycle_budget_exhausted",
    goalEvaluation: {
      achieved,
      reason,
      verifiedRequired: achieved ? ["development_release"] : [],
      failedRequired: [],
      unverifiedRequired: achieved ? [] : ["development_release"],
      blockers,
      remainingGaps: achieved ? [] : blockers.length ? blockers : [reason],
    },
  };
}

function jobId(goalId: string): string {
  return `development-${createHash("sha256").update(goalId).digest("hex").slice(0, 24)}`;
}

export class ResidentDevelopmentGoalHost {
  private readonly jobs: DevelopmentJobStore;
  private readonly changeSets: JsonFileDevelopmentChangeSetStore;
  private readonly stages: ResidentDevelopmentStages;
  private readonly planning: ResidentDevelopmentPlanning;
  private readonly controller = new DevelopmentJobStateController();

  constructor(options: {
    jobs: DevelopmentJobStore;
    changeSets: JsonFileDevelopmentChangeSetStore;
    stages: ResidentDevelopmentStages;
    planning: ResidentDevelopmentPlanning;
  }) {
    this.jobs = options.jobs;
    this.changeSets = options.changeSets;
    this.stages = options.stages;
    this.planning = options.planning;
  }

  matches(goal: Goal): boolean {
    return /(?:develop|development|implement|code|fix|repair|refactor|test|build|開発|実装|修正|改修|テスト)/i.test(
      [goal.title, goal.description ?? "", ...goal.successCriteria].join("\n"),
    );
  }

  async run(input: { goalId: string; goal: Goal; context: ContextItem[] }): Promise<BoundedRunReport> {
    let job = (await this.jobs.getByGoal(input.goalId)).find((candidate) => candidate.phase !== "CANCELLED") ?? null;
    if (!job) {
      const planned = new DevelopmentOrchestrator().plan({
        jobId: jobId(input.goalId),
        goalId: input.goalId,
        objective: input.goal.description?.trim() || input.goal.title,
        requirementIds: this.planning.requirementIds,
        acceptanceCriteria: input.goal.successCriteria,
        baseRevision: this.planning.baseRevision,
        taskScopeId: this.planning.taskScopeId,
        maxRisk: this.planning.maxRisk,
        targetFiles: this.planning.targetFiles,
        contextDigest: this.planning.contextDigest,
      });
      job = planned.job;
      await this.jobs.put(job);
    }
    if (job.phase === "COMPLETED") return report(true, "durable development release completed");
    if (job.phase === "HUMAN_GATE") return report(false, "development release requires Human Gate", ["human_gate"]);
    if (job.phase === "BLOCKED") return report(false, "development release is blocked", job.blockers);

    let changeSet = (await this.changeSets.list()).find((candidate) => candidate.jobId === job!.jobId && candidate.status !== "REJECTED") ?? null;
    if (!changeSet) {
      if (job.phase === "QUEUED") {
        job = this.controller.apply(job, { transitionId: `${job.jobId}:planning`, actor: "state-controller", to: "PLANNING", reason: "resident development planning complete" });
        await this.jobs.put(job);
      }
      if (job.phase === "PLANNING") {
        job = this.controller.apply(job, { transitionId: `${job.jobId}:implementing`, actor: "state-controller", to: "IMPLEMENTING", reason: "resident Builder selected" });
        await this.jobs.put(job);
      }
      changeSet = await this.stages.build({ job, goal: input.goal, context: input.context, workItemId: job.workItems[1]?.id ?? job.workItems[0]!.id });
      if (changeSet.jobId !== job.jobId || changeSet.baseRevision !== job.baseRevision) throw new Error("resident Builder returned an unbound Change Set");
      await this.changeSets.put(changeSet);
      job = this.controller.apply(job, { transitionId: `${job.jobId}:verify`, actor: "state-controller", to: "VERIFYING", reason: "isolated Change Set persisted" });
      await this.jobs.put(job);
    }

    const verificationPlan = createDevelopmentVerificationPlan({
      builderId: this.stages.builderId ?? "builder:resident",
      sourceRevision: changeSet.baseRevision,
      artifactDigest: changeSet.patchDigest,
      changedPaths: changeSet.changedPaths,
    });
    if (changeSet.status === "LOCAL") {
      const evidence = await this.stages.verify({ job, changeSet, plan: verificationPlan, goal: input.goal, context: input.context });
      const verification = evaluateDevelopmentVerification(verificationPlan, evidence);
      if (!verification.passed) return report(false, "independent verification failed", verification.reasons);
      changeSet = { ...changeSet, status: "READY_TO_PUBLISH", updatedAt: new Date().toISOString() };
      await this.changeSets.put(changeSet);
      job = this.controller.apply(job, {
        transitionId: `${job.jobId}:ready-to-publish`,
        actor: "state-controller",
        to: "READY_TO_PUBLISH",
        reason: "independent verification passed",
        evidence: [
          ...evidence.map((item) => ({
            id: `${job!.jobId}:check:${item.check}`,
            criterionId: job!.definitionOfDone[0]!.id,
            kind: `development-check:${item.check}`,
            issuer: item.verifierId,
            verified: item.status === "passed",
            sourceRevision: item.sourceRevision,
            artifactDigest: item.artifactDigest,
            recordedAt: item.recordedAt,
          })),
          ...job.definitionOfDone.slice(1).map((criterion) => ({
            id: `${job!.jobId}:criterion:${criterion.id}`,
            criterionId: criterion.id,
            kind: "development-acceptance",
            issuer: evidence[0]!.verifierId,
            verified: true,
            sourceRevision: verificationPlan.sourceRevision,
            artifactDigest: verificationPlan.artifactDigest,
            recordedAt: evidence[0]!.recordedAt,
          })),
        ],
      });
      await this.jobs.put(job);
    }

    const releaseState = await this.stages.releaseState({ job, changeSet, goal: input.goal, context: input.context });
    const persistedEvidence: DevelopmentVerificationEvidence[] = verificationPlan.requiredChecks.flatMap((check) => {
      const item = job!.evidence.find((candidate) => candidate.kind === `development-check:${check}`);
      return item?.sourceRevision && item.artifactDigest && item.recordedAt ? [{
        check,
        verifierId: item.issuer,
        sourceRevision: item.sourceRevision,
        artifactDigest: item.artifactDigest,
        status: item.verified ? "passed" as const : "failed" as const,
        recordedAt: item.recordedAt,
      }] : [];
    });
    const gate = evaluateDevelopmentReleaseGate({
      phase: job.phase,
      connected: releaseState.connected,
      risk: job.approvalScope.maxRisk,
      taskScopeId: releaseState.taskScopeId,
      taskAuthorization: releaseState.taskAuthorization,
      changedFiles: changeSet.changedPaths,
      verificationPlan,
      verificationEvidence: persistedEvidence,
      protectedConditions: releaseState.protectedConditions,
      pullRequest: releaseState.pullRequest,
      mainCi: releaseState.mainCi,
      deployment: releaseState.deployment,
      postDeploymentEvidence: releaseState.postDeploymentEvidence,
      now: releaseState.now,
    });

    if (gate.action === "READY_TO_PUBLISH" || gate.action === "WAIT_FOR_MERGE" || gate.action === "WAIT_MAIN_CI") {
      return report(false, gate.reasons[0] ?? gate.action.toLowerCase());
    }
    if (gate.action === "HUMAN_GATE") {
      job = this.controller.apply(job, { transitionId: `${job.jobId}:human-gate`, actor: "state-controller", to: "HUMAN_GATE", reason: gate.reasons.join(","), blockers: gate.reasons });
      await this.jobs.put(job);
      return report(false, "development release requires Human Gate", ["human_gate"]);
    }
    if (gate.action === "BLOCKED") {
      job = this.controller.apply(job, { transitionId: `${job.jobId}:release-blocked`, actor: "state-controller", to: "BLOCKED", reason: gate.reasons.join(","), blockers: gate.reasons });
      await this.jobs.put(job);
      return report(false, "development release is blocked", gate.reasons);
    }
    if (gate.action === "COMPLETE") {
      if (job.phase === "READY_TO_PUBLISH") {
        job = this.controller.apply(job, { transitionId: `${job.jobId}:publishing`, actor: "state-controller", to: "PUBLISHING", reason: "verified release evidence present" });
      }
      job = this.controller.apply(job, { transitionId: `${job.jobId}:completed`, actor: "state-controller", to: "COMPLETED", reason: "exact Production artifact independently verified" });
      await this.jobs.put(job);
      return report(true, "durable development release completed");
    }
    if (!this.stages.executeRelease) return report(false, `release capability unavailable:${gate.action}`, ["release_capability_unavailable"]);
    if (job.phase === "READY_TO_PUBLISH") {
      job = this.controller.apply(job, { transitionId: `${job.jobId}:publishing`, actor: "state-controller", to: "PUBLISHING", reason: `release gate requested ${gate.action}` });
      await this.jobs.put(job);
    }
    await this.stages.executeRelease(gate.action, { job, changeSet, goal: input.goal, context: input.context });
    return report(false, `release action executed:${gate.action}`);
  }
}
