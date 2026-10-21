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
import type { DevelopmentEvidence } from "./development-job.ts";
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
import {
  RESIDENT_SEQUENCE_EVIDENCE_KIND,
  residentDevelopmentSequenceDigest,
  residentDevelopmentGoalDigest,
  residentDevelopmentSequenceJobId,
  selectResidentDevelopmentSequenceJob,
  validateResidentDevelopmentSequence,
  type ResidentDevelopmentSequence,
} from "./resident-development-sequence.ts";

export interface ResidentDevelopmentReleaseState {
  connected: boolean;
  taskScopeId: string;
  taskAuthorization?: TaskCompletionAuthorization;
  protectedConditions: NonBypassableDevelopmentGate[];
  classifications: { destructiveChangeAbsent: boolean; privilegedChangeAbsent: boolean } | null;
  pullRequest: DevelopmentPullRequestState | null;
  mainCi: { revision: string; artifactDigest: string; passed: boolean } | null;
  deployment: { revision: string; sourceCandidateRevision: string; sourceArtifactDigest: string; artifactDigest: string; environment: "production" } | null;
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
  /** Only an explicitly opted-in local verifier may suspend on missing receipts. */
  deferMissingVerification?: boolean;
  build(input: { job: DevelopmentJob; goal: Goal; context: ContextItem[]; workItemId: string }): Promise<DevelopmentChangeSet>;
  /** Optional independent RED attestation. The Builder cannot declare its own test failure. */
  verifyRed?(input: { job: DevelopmentJob; changeSet: DevelopmentChangeSet; goal: Goal; context: ContextItem[] }): Promise<{ digest: string; issuer: string }>;
  verify(input: { job: DevelopmentJob; changeSet: DevelopmentChangeSet; plan: DevelopmentVerificationPlan; goal: Goal; context: ContextItem[] }): Promise<DevelopmentVerificationEvidence[]>;
  acceptanceEvidence?(input: { job: DevelopmentJob; changeSet: DevelopmentChangeSet; plan: DevelopmentVerificationPlan; goal: Goal; context: ContextItem[] }): Promise<DevelopmentEvidence[]>;
  releaseState(input: { job: DevelopmentJob; changeSet: DevelopmentChangeSet; goal: Goal; context: ContextItem[] }): Promise<ResidentDevelopmentReleaseState>;
  executeRelease?(action: string, input: { operationId: string; job: DevelopmentJob; changeSet: DevelopmentChangeSet; goal: Goal; context: ContextItem[] }): Promise<void>;
}

export interface ResidentDevelopmentPlanning {
  requirementIds: string[];
  baseRevision: string;
  taskScopeId: string;
  maxRisk: DevelopmentRisk;
  targetFiles: string[];
  contextDigest: string;
  sequence?: ResidentDevelopmentSequence;
}

export interface ResidentDevelopmentProgress {
  goalDigest: string;
  sequenceDigest: string;
  maxRisk: DevelopmentRisk;
  completedJobs: { jobId: string; criterionIds: string[]; evidence: DevelopmentEvidence[] }[];
}

function buildReport(achieved: boolean, reason: string, blockers: string[] = []): BoundedRunReport {
  return {
    cycles: [],
    stopReason: achieved ? "goal_complete" : blockers.includes("human_gate") ? "approval_required" : blockers.length ? "blocked" : "cycle_budget_exhausted",
    goalEvaluation: {
      achieved,
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

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
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
    if (this.planning.sequence) {
      validateResidentDevelopmentSequence(this.planning.sequence, goal, this.planning);
      return true;
    }
    return /(?:develop|development|implement|code|fix|repair|refactor|test|build|開発|実装|修正|改修|テスト)/i.test(
      [goal.title, goal.description ?? "", ...goal.successCriteria].join("\n"),
    );
  }

  /** Only persisted completed Jobs may project acceptance into the Goal ledger. */
  async getVerifiedProgress(input: { goalId: string; goal: Goal }): Promise<ResidentDevelopmentProgress | null> {
    const sequence = this.planning.sequence;
    if (!sequence) return null;
    validateResidentDevelopmentSequence(sequence, input.goal, this.planning);
    const jobs = await this.jobs.getByGoal(input.goalId);
    selectResidentDevelopmentSequenceJob(sequence, input.goalId, jobs);
    const changes = await this.changeSets.list();
    const completedJobs = jobs.filter(job => job.phase === "COMPLETED").map(job => {
      const change = changes.find(candidate => candidate.jobId === job.jobId && candidate.workItemId === `${job.jobId}:implement`
        && candidate.status !== "REJECTED");
      if (!change) throw Error("SEQUENCE_COMPLETED_EVIDENCE_MISSING");
      const plan = createDevelopmentVerificationPlan({ builderId: change.deviceId, sourceRevision: change.candidateRevision,
        artifactDigest: change.artifactDigest, changedPaths: change.changedPaths });
      const evidence = job.evidence.filter(item => item.verified && item.issuer !== change.deviceId
        && item.sourceRevision === change.candidateRevision && item.artifactDigest === change.artifactDigest
        && item.recordedAt && Number.isFinite(Date.parse(item.recordedAt)));
      const checks: DevelopmentVerificationEvidence[] = plan.requiredChecks.flatMap(check => {
        const item = evidence.find(entry => entry.kind === `development-check:${check}`);
        return item ? [{ check, verifierId: item.issuer, status: "passed", sourceRevision: item.sourceRevision!,
          artifactDigest: item.artifactDigest!, recordedAt: item.recordedAt! }] : [];
      });
      if (!evaluateDevelopmentVerification(plan, checks).passed
        || job.definitionOfDone.some(criterion => criterion.description !== input.goal.successCriteria[Number(criterion.id.slice("criterion-".length)) - 1]
          || !evidence.some(item => item.criterionId === criterion.id))) throw Error("SEQUENCE_COMPLETED_EVIDENCE_MISSING");
      return { jobId: job.jobId, criterionIds: job.definitionOfDone.map(criterion => criterion.id), evidence };
    });
    return { goalDigest: residentDevelopmentGoalDigest(input.goal), sequenceDigest: residentDevelopmentSequenceDigest(sequence),
      maxRisk: sequence.maxRisk, completedJobs };
  }

  async run(input: { goalId: string; goal: Goal; context: ContextItem[] }): Promise<BoundedRunReport> {
    const persistedJobs = await this.jobs.getByGoal(input.goalId);
    const sequence = this.planning.sequence;
    if (sequence) validateResidentDevelopmentSequence(sequence, input.goal, this.planning);
    else if (persistedJobs.some(candidate => candidate.evidence.some(item => item.kind === RESIDENT_SEQUENCE_EVIDENCE_KIND))) {
      throw Error("SEQUENCE_PERSISTED_JOB_MISMATCH");
    }
    const selected = sequence ? selectResidentDevelopmentSequenceJob(sequence, input.goalId, persistedJobs) : null;
    if (sequence && persistedJobs.some(candidate => candidate.definitionOfDone.some(criterion =>
      criterion.description !== input.goal.successCriteria[Number(criterion.id.slice("criterion-".length)) - 1]))) throw Error("SEQUENCE_PERSISTED_GOAL_MISMATCH");
    const goalJobs = persistedJobs.filter((candidate) => candidate.phase !== "CANCELLED");
    // Completed Jobs must not hide existing unfinished work after restart.
    // Keep persisted order, including Human Gates and blockers on the next Job.
    let job = sequence ? selected?.job ?? null : goalJobs.find((candidate) => candidate.phase !== "COMPLETED") ?? goalJobs[0] ?? null;
    const report = (achieved: boolean, reason: string, blockers: string[] = []): BoundedRunReport => {
      if (!sequence) return buildReport(achieved, reason, blockers);
      const currentJobs = [...goalJobs.filter(candidate => candidate.jobId !== job?.jobId), ...(job ? [job] : [])];
      const completedCriteria = new Set(currentJobs.filter(candidate => candidate.phase === "COMPLETED").flatMap(candidate => candidate.definitionOfDone.map(criterion => criterion.id)));
      const allCriteria = input.goal.successCriteria.map((_, index) => `criterion-${index + 1}`);
      const result = buildReport(achieved && completedCriteria.size === allCriteria.length, reason, blockers);
      result.goalEvaluation!.verifiedRequired = allCriteria.filter(id => completedCriteria.has(id));
      result.goalEvaluation!.unverifiedRequired = allCriteria.filter(id => !completedCriteria.has(id));
      return result;
    };
    if (sequence && !selected) return report(true, "all approved development Jobs completed");
    if (!job) {
      const planned = new DevelopmentOrchestrator().plan({
        jobId: sequence ? residentDevelopmentSequenceJobId(input.goalId, sequence, selected!.definition.key) : jobId(input.goalId),
        goalId: input.goalId,
        objective: selected?.definition.objective ?? (input.goal.description?.trim() || input.goal.title),
        requirementIds: this.planning.requirementIds,
        acceptanceCriteria: selected ? selected.definition.criterionIds.map(id => input.goal.successCriteria[Number(id.slice("criterion-".length)) - 1]!)
          : input.goal.successCriteria.length ? input.goal.successCriteria : [input.goal.description?.trim() || input.goal.title],
        criterionIds: selected?.definition.criterionIds,
        baseRevision: selected?.definition.baseRevision ?? this.planning.baseRevision,
        taskScopeId: this.planning.taskScopeId,
        maxRisk: this.planning.maxRisk,
        targetFiles: selected?.definition.targetFiles ?? this.planning.targetFiles,
        contextDigest: this.planning.contextDigest,
      });
      job = planned.job;
      if (sequence) {
        job.approvalScope.expiresAt = sequence.expiresAt;
        job = this.controller.apply(job, { transitionId: `${job.jobId}:sequence`, actor: "state-controller", to: "PLANNING",
          reason: "host-approved development sequence bound before execution", evidence: [{ id: `${job.jobId}:sequence`,
            criterionId: "repository-plan", kind: RESIDENT_SEQUENCE_EVIDENCE_KIND, issuer: "resident-development-host", verified: false,
            artifactDigest: residentDevelopmentSequenceDigest(sequence), sourceRevision: sequence.goalDigest,
            environment: selected!.definition.key, recordedAt: new Date().toISOString() }] });
      }
      await this.jobs.put(job);
    }
    if (job.phase === "COMPLETED") return report(true, "durable development release completed");
    if (job.phase === "HUMAN_GATE") return report(false, "development release requires Human Gate", ["human_gate"]);
    if (job.phase === "BLOCKED") return report(false, "development release is blocked", job.blockers);

    const implementationItem = job.workItems.find((item) => item.id.endsWith(":implement")) ?? job.workItems[1] ?? job.workItems[0]!;
    const testItem = job.workItems.find((item) => item.id.endsWith(":test"));
    const assertSequenceChangeSet = (candidate: DevelopmentChangeSet): void => {
      if (selected && (candidate.baseRevision !== selected.definition.baseRevision
        || !candidate.changedPaths.length || candidate.changedPaths.some(path => !selected.definition.targetFiles.includes(path)))) {
        throw Error("SEQUENCE_CHANGESET_SCOPE_MISMATCH");
      }
    };
    const storedChangeSets = (await this.changeSets.list()).filter((candidate) => candidate.jobId === job!.jobId && candidate.status !== "REJECTED");
    let changeSet = storedChangeSets.find((candidate) => candidate.workItemId === implementationItem.id) ?? null;
    if (!changeSet) {
      if (job.phase === "QUEUED") {
        job = this.controller.apply(job, { transitionId: `${job.jobId}:planning`, actor: "state-controller", to: "PLANNING", reason: "resident development planning complete" });
        await this.jobs.put(job);
      }
      if (job.phase === "PLANNING") {
        job = this.controller.apply(job, { transitionId: `${job.jobId}:implementing`, actor: "state-controller", to: "IMPLEMENTING", reason: "resident Builder selected" });
        await this.jobs.put(job);
      }
      const existingTest = testItem ? storedChangeSets.find((candidate) => candidate.workItemId === testItem.id) : undefined;
      if (testItem && !existingTest) {
        let testChangeSet = await this.stages.build({ job, goal: input.goal, context: input.context, workItemId: testItem.id });
        if (testChangeSet.jobId !== job.jobId || testChangeSet.baseRevision !== job.baseRevision || testChangeSet.workItemId !== testItem.id) throw new Error("resident Builder returned an unbound TDD test Change Set");
        assertSequenceChangeSet(testChangeSet);
        if (testChangeSet.tddPhase !== "red" || !testChangeSet.tddEvidenceDigest) throw new Error("resident Builder did not supply a TDD test candidate");
        const independentRed = this.stages.verifyRed
          ? await this.stages.verifyRed({ job, changeSet: testChangeSet, goal: input.goal, context: input.context })
          : null;
        if (this.stages.verifyRed && (!independentRed || !/^[a-f0-9]{64}$/.test(independentRed.digest)
          || !independentRed.issuer || independentRed.issuer === testChangeSet.deviceId)) {
          throw new Error("independent RED attestation rejected");
        }
        testChangeSet = { ...testChangeSet,
          ...(independentRed ? { tddEvidenceDigest: independentRed.digest } : {}),
          status: "VERIFIED", updatedAt: nextTimestamp(testChangeSet.updatedAt) };
        await this.changeSets.put(testChangeSet);
        job = this.controller.apply(job, { transitionId: `${job.jobId}:tdd-red`, actor: "state-controller", to: "IMPLEMENTING", reason: "failing test Work Item persisted before implementation", evidence: [{ id: `${job.jobId}:tdd-red`, criterionId: "repository-tdd", kind: "development-tdd-red", issuer: independentRed?.issuer ?? testChangeSet.deviceId, verified: true, sourceRevision: testChangeSet.candidateRevision, artifactDigest: testChangeSet.tddEvidenceDigest, recordedAt: testChangeSet.updatedAt }] });
        await this.jobs.put(job);
      }
      changeSet = await this.stages.build({ job, goal: input.goal, context: input.context, workItemId: implementationItem.id });
      if (changeSet.jobId !== job.jobId || changeSet.baseRevision !== job.baseRevision || changeSet.workItemId !== implementationItem.id) throw new Error("resident Builder returned an unbound Change Set");
      assertSequenceChangeSet(changeSet);
      await this.changeSets.put(changeSet);
      job = this.controller.apply(job, { transitionId: `${job.jobId}:verify`, actor: "state-controller", to: "VERIFYING", reason: "isolated Change Set persisted" });
      await this.jobs.put(job);
    }
    assertSequenceChangeSet(changeSet);

    if (changeSet.status === "LOCAL" && job.phase !== "VERIFYING" && job.phase !== "RECOVERING") {
      job = this.controller.apply(job, { transitionId: `${job.jobId}:reconcile-verifying:${changeSet.changeSetId}`, actor: "state-controller", to: "VERIFYING", reason: "reconciled persisted Change Set after interrupted checkpoint" });
      await this.jobs.put(job);
    }
    if (changeSet.status === "READY_TO_PUBLISH" && job.phase === "VERIFYING") {
      const hasPersistedVerification = job.evidence.some((item) => item.kind.startsWith("development-check:") && item.sourceRevision === changeSet!.candidateRevision && item.artifactDigest === changeSet!.artifactDigest);
      if (!hasPersistedVerification) {
        changeSet = { ...changeSet, status: "LOCAL", updatedAt: nextTimestamp(changeSet.updatedAt) };
        await this.changeSets.put(changeSet);
      }
    }

    const verificationPlan = createDevelopmentVerificationPlan({
      builderId: changeSet.deviceId,
      sourceRevision: changeSet.candidateRevision,
      artifactDigest: changeSet.artifactDigest,
      changedPaths: changeSet.changedPaths,
    });
    const localCompletion = sequence?.completionMode === "verified-local-artifact";
    let localEvidence: DevelopmentEvidence[] = [];
    if (changeSet.status === "LOCAL") {
      const evidence = await this.stages.verify({ job, changeSet, plan: verificationPlan, goal: input.goal, context: input.context });
      if (sequence && evidence.some(item => Date.parse(item.recordedAt) < Date.parse(changeSet!.createdAt) - 60_000
        || Date.parse(item.recordedAt) > Date.now() + 60_000)) {
        return report(false, "independent verification evidence predates the candidate or is future-dated", ["verification_evidence_stale"]);
      }
      const verification = evaluateDevelopmentVerification(verificationPlan, evidence);
      if (!verification.passed) {
        // Missing independent check receipts are WAITING, not failed code.
        // Preserve the exact candidate and durable VERIFYING checkpoint rather
        // than rejecting a good artifact and rerunning a now-dirty Builder.
        // Only genuinely failed/stale/inconsistent evidence enters recovery.
        const outstanding = verification.reasons.every(reason => reason.startsWith("missing_evidence:"));
        if (outstanding && this.stages.deferMissingVerification === true) {
          return report(false, `independent_verifier_pending:${verification.reasons.join(",")}`);
        }
        const signature = createHash("sha256").update(verification.reasons.slice().sort().join("\n")).digest("hex");
        const strategyId = `verify-recovery-${job.attempts.length + 1}`;
        changeSet = { ...changeSet, status: "REJECTED", updatedAt: nextTimestamp(changeSet.updatedAt) };
        await this.changeSets.put(changeSet);
        job = this.controller.apply(job, { transitionId: `${job.jobId}:verification-failed:${signature}`, actor: "state-controller", to: "RECOVERING", reason: "independent verification failed; a materially different Builder attempt is required", evidence: evidence.map((item) => ({ id: `${job!.jobId}:failed-check:${item.check}:${signature}`, criterionId: "repository-verification", kind: `development-check:${item.check}`, issuer: item.verifierId, verified: false, sourceRevision: item.sourceRevision, artifactDigest: item.artifactDigest, recordedAt: item.recordedAt })), failure: { signature, strategyId, hypothesis: verification.reasons.join(",") } });
        await this.jobs.put(job);
        return report(false, "independent verification failed; recovery persisted", verification.reasons);
      }
      const acceptanceEvidence = await this.stages.acceptanceEvidence?.({ job, changeSet, plan: verificationPlan, goal: input.goal, context: input.context }) ?? [];
      const invalidAcceptance = acceptanceEvidence.filter((item) =>
        !job!.definitionOfDone.some((criterion) => criterion.id === item.criterionId)
        || !item.verified
        || item.sourceRevision !== verificationPlan.sourceRevision
        || item.artifactDigest !== verificationPlan.artifactDigest
        || !item.issuer.trim()
        || item.issuer === verificationPlan.builderId
        || !item.recordedAt
        || !Number.isFinite(Date.parse(item.recordedAt))
        || (sequence && (Date.parse(item.recordedAt) < Date.parse(changeSet!.createdAt) - 60_000
          || Date.parse(item.recordedAt) > Date.now() + 60_000)),
      );
      if (invalidAcceptance.length) return report(false, "criterion-specific acceptance evidence is invalid", ["acceptance_evidence_invalid"]);
      const missingAcceptance = job.definitionOfDone.filter(criterion => criterion.required
        && !acceptanceEvidence.some(item => item.criterionId === criterion.id));
      if (sequence && missingAcceptance.length) return report(false, `independent_verifier_pending:${missingAcceptance.map(item => `missing_acceptance_evidence:${item.id}`).join(",")}`);
      const completeEvidence: DevelopmentEvidence[] = [
          ...evidence.map((item) => ({
            id: `${job!.jobId}:check:${item.check}`,
            criterionId: "repository-verification",
            kind: `development-check:${item.check}`,
            issuer: item.verifierId,
            verified: item.status === "passed",
            sourceRevision: item.sourceRevision,
            artifactDigest: item.artifactDigest,
            recordedAt: item.recordedAt,
          })),
          ...acceptanceEvidence,
      ];
      if (localCompletion) {
        // Keep the durable candidate in VERIFYING until both the trusted local
        // contract and the non-bypassable gate have passed. The final Job write
        // atomically commits acceptance and completion together.
        localEvidence = completeEvidence;
      } else {
        changeSet = { ...changeSet, status: "READY_TO_PUBLISH", updatedAt: nextTimestamp(changeSet.updatedAt) };
        await this.changeSets.put(changeSet);
        job = this.controller.apply(job, {
          transitionId: `${job.jobId}:ready-to-publish`, actor: "state-controller", to: "READY_TO_PUBLISH",
          reason: "independent verification passed", evidence: completeEvidence,
        });
        await this.jobs.put(job);
      }
    }

    const releaseState = await this.stages.releaseState({ job, changeSet, goal: input.goal, context: input.context });
    if (releaseState.taskScopeId !== job.approvalScope.taskScopeId) {
      job = this.controller.apply(job, { transitionId: `${job.jobId}:scope-mismatch`, actor: "state-controller", to: "HUMAN_GATE", reason: "release authorization scope does not match durable Job", blockers: ["release_authorization_scope_mismatch"] });
      await this.jobs.put(job);
      return report(false, "release authorization scope mismatch", ["human_gate"]);
    }
    if (localCompletion) {
      // An explicitly approved LOW local artifact contract cannot authorize any
      // protected operation, and never invokes publishing or Production stages.
      if (releaseState.protectedConditions.length || job.approvalScope.maxRisk !== "low") {
        job = this.controller.apply(job, { transitionId: `${job.jobId}:local-human-gate`, actor: "state-controller", to: "HUMAN_GATE",
          reason: "local artifact contract encountered a protected condition", blockers: releaseState.protectedConditions });
        await this.jobs.put(job);
        return report(false, "local artifact requires Human Gate", ["human_gate"]);
      }
      if (!releaseState.classifications?.destructiveChangeAbsent || !releaseState.classifications.privilegedChangeAbsent) {
        job = this.controller.apply(job, { transitionId: `${job.jobId}:local-classification`, actor: "state-controller", to: "BLOCKED",
          reason: "trusted safe local change classification is missing", blockers: ["trusted_change_classification_missing"] });
        await this.jobs.put(job);
        return report(false, "local change classification is missing", ["trusted_change_classification_missing"]);
      }
      if (job.phase !== "VERIFYING" || !localEvidence.length) return report(false, "local verification checkpoint is incomplete", ["local_verification_incomplete"]);
      // Recheck expiry after potentially long Builder/verifier operations.
      validateResidentDevelopmentSequence(sequence!, input.goal, this.planning);
      job = this.controller.apply(job, { transitionId: `${job.jobId}:completed`, actor: "state-controller", to: "COMPLETED",
        reason: "host-approved local artifact criteria independently verified", evidence: localEvidence });
      await this.jobs.put(job);
      changeSet = { ...changeSet, status: "VERIFIED", updatedAt: nextTimestamp(changeSet.updatedAt) };
      await this.changeSets.put(changeSet);
      const remaining = selectResidentDevelopmentSequenceJob(sequence!, input.goalId, await this.jobs.getByGoal(input.goalId));
      return report(!remaining, remaining ? "development Job completed; next approved Job remains" : "all approved local artifact Jobs completed");
    }
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
      taskScopeId: job.approvalScope.taskScopeId,
      taskAuthorization: releaseState.taskAuthorization,
      changedFiles: changeSet.changedPaths,
      verificationPlan,
      verificationEvidence: persistedEvidence,
      protectedConditions: releaseState.protectedConditions,
      classifications: releaseState.classifications,
      pullRequest: releaseState.pullRequest,
      mainCi: releaseState.mainCi,
      deployment: releaseState.deployment,
      postDeploymentEvidence: releaseState.postDeploymentEvidence,
      now: releaseState.now,
    });

    if (gate.action === "READY_TO_PUBLISH" || gate.action === "WAIT_FOR_MERGE" || gate.action === "WAIT_MAIN_CI") {
      return report(false, `publication_wait:${gate.action}:${gate.reasons[0] ?? "external_state_pending"}`);
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
      const missingCriteria = job.definitionOfDone
        .filter((criterion) => criterion.required)
        .filter((criterion) => !job!.evidence.some((item) => item.criterionId === criterion.id
          && item.verified
          && item.sourceRevision === verificationPlan.sourceRevision
          && item.artifactDigest === verificationPlan.artifactDigest
          && item.issuer !== verificationPlan.builderId));
      if (missingCriteria.length) return report(false, "criterion-specific acceptance evidence is missing", missingCriteria.map((item) => `missing_acceptance_evidence:${item.id}`));
      if (job.phase === "READY_TO_PUBLISH") {
        job = this.controller.apply(job, { transitionId: `${job.jobId}:publishing`, actor: "state-controller", to: "PUBLISHING", reason: "verified release evidence present" });
      }
      job = this.controller.apply(job, { transitionId: `${job.jobId}:completed`, actor: "state-controller", to: "COMPLETED", reason: "exact Production artifact independently verified" });
      await this.jobs.put(job);
      if (sequence) {
        const remaining = selectResidentDevelopmentSequenceJob(sequence, input.goalId, await this.jobs.getByGoal(input.goalId));
        return report(!remaining, remaining ? "development Job completed; next approved Job remains" : "all approved development releases completed");
      }
      const unfinishedJobs = (await this.jobs.getByGoal(input.goalId))
        .some((candidate) => candidate.phase !== "COMPLETED" && candidate.phase !== "CANCELLED");
      if (unfinishedJobs) return report(false, "development Job completed; next persisted Job remains");
      return report(true, "durable development release completed");
    }
    if (!this.stages.executeRelease) return report(false, `release capability unavailable:${gate.action}`, ["release_capability_unavailable"]);
    if (job.phase === "READY_TO_PUBLISH") {
      job = this.controller.apply(job, { transitionId: `${job.jobId}:publishing`, actor: "state-controller", to: "PUBLISHING", reason: `release gate requested ${gate.action}` });
      await this.jobs.put(job);
    }
    const operationId = `${job.jobId}:${gate.action}:${changeSet.changeSetId}:${changeSet.candidateRevision}`;
    job = this.controller.apply(job, { transitionId: operationId, actor: "state-controller", to: "PUBLISHING", reason: `durable idempotent release operation requested:${gate.action}`, evidence: [{ id: operationId, criterionId: "repository-release", kind: `release-operation:${gate.action}`, issuer: "resident-release-gate", verified: false, sourceRevision: changeSet.candidateRevision, artifactDigest: changeSet.artifactDigest, recordedAt: new Date().toISOString() }] });
    await this.jobs.put(job);
    await this.stages.executeRelease(gate.action, { operationId, job, changeSet, goal: input.goal, context: input.context });
    return report(false, `release action executed:${gate.action}`);
  }
}
