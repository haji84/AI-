import { createHash } from "node:crypto";
import type { GoalExecutionAdapter } from "./goal-controller-execution-bridge.ts";
import type { WorkStateStore } from "./work-state.ts";
import { evaluateGoalFromWorkState } from "./goal-evaluator.ts";
import type { BoundedRunReport } from "./bounded-runner.ts";
import { DevelopmentJobStateController, type DevelopmentEvidence, type DevelopmentJob, type DevelopmentJobPhase } from "./development-job.ts";
import type { DevelopmentJobStore } from "./development-job-store.ts";
import type { JsonFileDevelopmentChangeSetStore } from "./development-change-set-store.ts";
import type { DevelopmentChangeSet } from "./development-change-set.ts";
import { assertDevelopmentChangeSet } from "./development-change-set.ts";
import { createDevelopmentVerificationPlan, evaluateDevelopmentVerification } from "./development-verification-plan.ts";
import { validateSignedLocalVerifierReceipt, type SignedLocalVerifierReceipt } from "./signed-local-verifier-receipt.ts";
import { routeDurableGoalJobs, type DurableGoalJob } from "./hosted-goal-work-router.ts";
import type { FabricNode } from "./capability-fabric-router.ts";

/** An already-approved, host-supplied binding to existing persisted Jobs. Not model/Goal input. */
export interface HostedJobBinding {
  goalId: string;
  jobId: string;
  dependsOn: string[];
  allowedPaths: string[];
  privacy: "public" | "sensitive" | "secret";
  evidenceMode: "ONLINE" | "LOCAL" | "CONNECTED" | "DEVICE";
}

/** The host owns leases, execution, verifier identity and artifact acceptance. */
export interface HostedJobAuthority {
  assertEligible(input: { goalId: string; jobId: string; nodeId: string }): Promise<void>;
  currentGate(goalId: string): Promise<{ paused: boolean; blockers: string[] }>;
  build(input: { job: DevelopmentJob; nodeId: string; allowedPaths: string[] }): Promise<DevelopmentChangeSet>;
  readVerifierReceipt(job: DevelopmentJob): Promise<SignedLocalVerifierReceipt | null>;
  verifyArtifactAcceptance(input: { job: DevelopmentJob; candidate: DevelopmentChangeSet }): Promise<boolean>;
}

export interface HostedGoalControllerAdapterOptions {
  goalId: string;
  baseRevision: string;
  taskScopeId: string;
  builderId: string;
  verifierId: string;
  verifierPublicKeyPem: string;
  bindings: readonly HostedJobBinding[];
  nodes: readonly FabricNode[];
  jobs: DevelopmentJobStore;
  goalWorkState: WorkStateStore;
  changes: JsonFileDevelopmentChangeSetStore;
  authority: HostedJobAuthority;
}

function evidenceValid(job: DevelopmentJob, verifierId: string): boolean {
  return job.phase === "COMPLETED" && job.definitionOfDone.filter(c => c.required).every(c =>
    job.evidence.some(e => e.criterionId === c.id && e.kind === "signed-independent:v1" &&
      e.issuer === verifierId && e.verified === true &&
      e.sourceRevision && /^[a-f0-9]{40,64}$/.test(e.sourceRevision) &&
      e.artifactDigest && /^[a-f0-9]{64}$/.test(e.artifactDigest)));
}

function routingPhase(phase: DevelopmentJobPhase): DurableGoalJob["phase"] {
  if (phase === "QUEUED" || phase === "VERIFYING" || phase === "COMPLETED" || phase === "BLOCKED") return phase;
  if (phase === "HUMAN_GATE" || phase === "CANCELLED" || phase === "WAITING_FOR_RESOURCE" || phase === "WAITING_FOR_CONNECTIVITY") return "BLOCKED";
  return "RUNNING"; // Do not duplicate existing partial/in-flight work.
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Bounded GoalControllerExecutionBridge adapter for trusted GitHub-hosted Jobs.
 * Uses existing DevelopmentJob State Controller, Job Store, Change Set Store and
 * independently pinned Ed25519 verifier contract. Does not create Goal/Job IDs.
 * No lease implementation, model or credential may be supplied by a Goal text.
 */
export class HostedGoalControllerAdapter implements GoalExecutionAdapter {
  private readonly options: HostedGoalControllerAdapterOptions;
  private readonly state = new DevelopmentJobStateController();

  constructor(options: HostedGoalControllerAdapterOptions) {
    if (!options.goalId || !/^[a-f0-9]{40,64}$/.test(options.baseRevision) ||
      !options.taskScopeId.trim() || !options.builderId.trim() ||
      !options.verifierId.trim() || options.verifierId === options.builderId ||
      !options.verifierPublicKeyPem.trim() || !options.authority ||
      options.bindings.length < 1 || options.bindings.length > 32) {
      throw Error("HOSTED_GOAL_AUTHORITY_INVALID");
    }
    if (new Set(options.bindings.map(b => b.jobId)).size !== options.bindings.length ||
      options.bindings.some(b => b.goalId !== options.goalId || !b.allowedPaths.length ||
        new Set(b.allowedPaths).size !== b.allowedPaths.length)) throw Error("HOSTED_GOAL_JOB_BINDINGS_INVALID");
    this.options = options;
  }

  private async transition(job: DevelopmentJob, to: DevelopmentJobPhase, reason: string, evidence: DevelopmentEvidence[] = []): Promise<DevelopmentJob> {
    const at = new Date(Math.max(Date.now(), Date.parse(job.updatedAt) + 1)).toISOString();
    const updated = this.state.apply(job, {
      transitionId: `hosted:${job.jobId}:${to}`,
      actor: "state-controller",
      to,
      reason,
      at,
      evidence,
    });
    await this.options.jobs.put(updated);
    return updated;
  }

  private async report(jobs: DevelopmentJob[], blocked: string[] = [], wait?: string): Promise<BoundedRunReport> {
    const completed = jobs.filter(job => evidenceValid(job, this.options.verifierId));
    const state = await this.options.goalWorkState.get(this.options.goalId);
    // Completion is owned by the canonical WorkState/Goal Evaluator, not by
    // the number of routed Jobs. Missing/blocked Goal state must fail closed.
    const evaluation = state ? evaluateGoalFromWorkState(state) : null;
    const blockers = [...blocked, ...(evaluation?.blockers ?? (state ? [] : ["goal_work_state_unavailable"]))];
    const achieved = completed.length === this.options.bindings.length && evaluation?.achieved === true && blockers.length === 0;
    const pendingJobs = jobs.filter(job => !evidenceValid(job, this.options.verifierId)).map(job => `pending_job:${job.jobId}`);
    return {
      cycles: [],
      stopReason: blockers.includes("human_gate") ? "approval_required" : blockers.length ? "blocked" : achieved ? "goal_complete" : "cycle_budget_exhausted",
      goalEvaluation: {
        achieved,
        verifiedRequired: evaluation?.verifiedRequired ?? [],
        failedRequired: evaluation?.failedRequired ?? [],
        unverifiedRequired: evaluation?.unverifiedRequired ?? [],
        blockers,
        remainingGaps: [
          ...(evaluation?.remainingGaps ?? []), ...pendingJobs,
          ...blocked.map(b => `blocker:${b}`),
          ...(!achieved && wait ? [wait] : []),
        ],
      },
    };
  }

  private async completeWithSignedReceipt(job: DevelopmentJob): Promise<DevelopmentJob | null> {
    const candidates = (await this.options.changes.list()).filter(c => c.jobId === job.jobId);
    if (candidates.length !== 1) throw Error("HOSTED_GOAL_CHANGE_SET_IDENTITY_INVALID");
    const candidate = candidates[0]!;
    const binding = this.options.bindings.find(b => b.jobId === job.jobId)!;
    assertDevelopmentChangeSet(candidate);
    if (candidate.baseRevision !== this.options.baseRevision ||
      candidate.deviceId !== this.options.builderId ||
      candidate.changedPaths.some(path => !binding.allowedPaths.includes(path))) throw Error("HOSTED_GOAL_CHANGE_SET_SCOPE_INVALID");
    const receipt = await this.options.authority.readVerifierReceipt(job);
    if (!receipt) return null;
    if (receipt.payload.verifierId !== this.options.verifierId) throw Error("HOSTED_GOAL_VERIFIER_ID_INVALID");
    const plan = createDevelopmentVerificationPlan({
      builderId: this.options.builderId, sourceRevision: candidate.candidateRevision,
      artifactDigest: candidate.artifactDigest, changedPaths: candidate.changedPaths,
    });
    const evidence = validateSignedLocalVerifierReceipt({
      receipt, publicKeyPem: this.options.verifierPublicKeyPem, plan, changeSet: candidate,
      goalId: job.goalId,
    });
    if (!evaluateDevelopmentVerification(plan, evidence).passed) throw Error("HOSTED_GOAL_SIGNED_CHECKS_INCOMPLETE");
    if (!await this.options.authority.verifyArtifactAcceptance({ job, candidate })) throw Error("HOSTED_GOAL_ACCEPTANCE_NOT_VERIFIED");
    const accepted: DevelopmentEvidence[] = job.definitionOfDone.filter(item => item.required).map(item => ({
      id: `hosted:${digest(receipt.signatureBase64 + item.id)}`, criterionId: item.id,
      kind: "signed-independent:v1", issuer: receipt.payload.verifierId,
      verified: true, sourceRevision: candidate.candidateRevision,
      artifactDigest: candidate.artifactDigest, recordedAt: new Date().toISOString(),
    }));
    return this.transition(job, "COMPLETED", "pinned independent signed checks and artifact acceptance verified", accepted);
  }

  async run(goalId: string): Promise<BoundedRunReport> {
    if (goalId !== this.options.goalId) throw Error("HOSTED_GOAL_ID_MISMATCH");
    const original = await this.options.jobs.getByGoal(goalId);
    const bindingById = new Map(this.options.bindings.map(item => [item.jobId, item]));
    if (original.length !== bindingById.size || original.some(job => !bindingById.has(job.jobId))) throw Error("HOSTED_GOAL_PERSISTED_JOB_SET_MISMATCH");
    const gate = await this.options.authority.currentGate(goalId);
    const authoritative = await this.options.goalWorkState.get(goalId);
    if (!authoritative) return this.report(original, ["goal_work_state_unavailable"]);
    if (authoritative.blockers.length || authoritative.status === "BLOCKED") {
      return this.report(original, authoritative.blockers.length ? authoritative.blockers : ["goal_work_state_blocked"]);
    }
    if (authoritative.status === "COMPLETED" && original.some(job => !evidenceValid(job, this.options.verifierId))) {
      return this.report(original, ["goal_state_completed_before_jobs_verified"]);
    }
    if (gate.paused) return { ...await this.report(original), stopReason: "paused" };
    if (!Array.isArray(gate.blockers) || gate.blockers.length) return this.report(original, Array.isArray(gate.blockers) ? gate.blockers : ["HOSTED_GOAL_GATE_INVALID"]);
    for (const job of original) {
      if (job.goalId !== goalId || job.baseRevision !== this.options.baseRevision ||
        job.approvalScope.taskScopeId !== this.options.taskScopeId ||
        job.approvalScope.maxRisk !== "low" ||
        (job.approvalScope.expiresAt && Date.parse(job.approvalScope.expiresAt) <= Date.now()))
        throw Error("HOSTED_GOAL_PERSISTED_SCOPE_INVALID");
    }
    const routes = routeDurableGoalJobs(original.map(job => {
      const binding = bindingById.get(job.jobId)!;
      return {
        goalId, phase: routingPhase(job.phase), verified: evidenceValid(job, this.options.verifierId),
        dependsOn: binding.dependsOn,
        humanApprovalRequired: job.phase === "HUMAN_GATE",
        job: {
          id: job.jobId,
          privacy: binding.privacy,
          risk: job.approvalScope.maxRisk,
          freshness: "static",
          evidenceMode: binding.evidenceMode,
          maxIncrementalCost: 0,
          requiredCapabilities: [...new Set(job.workItems.flatMap(work => work.requiredCapabilities))],
        },
      };
    }), this.options.nodes);

    // Verification cannot be bypassed. A candidate is never an accepted Job.
    const verifying = original.find(job => job.phase === "VERIFYING");
    if (verifying) {
      const accepted = await this.completeWithSignedReceipt(verifying);
      const fresh = await this.options.jobs.getByGoal(goalId);
      return this.report(fresh, [], accepted ? undefined : `independent_verifier_pending:${verifying.jobId}`);
    }
    const first = routes.find(route => route.disposition === "RUN_HOSTED");
    if (!first?.nodeId) {
      if (original.every(job => evidenceValid(job, this.options.verifierId))) return this.report(original);
      const unavailable = routes.some(route => route.disposition === "HUMAN_REQUIRED");
      return this.report(original, unavailable ? ["human_gate"] : [], unavailable ? undefined : "resource_wait:hosted_capability_or_verified_predecessor");
    }
    const job = original.find(item => item.jobId === first.jobId)!;
    if (job.phase !== "QUEUED" || first.goalId !== goalId) throw Error("HOSTED_GOAL_DISPATCH_STATE_INVALID");
    const binding = bindingById.get(job.jobId)!;
    // Trusted host must validate its actual GitHub-hosted identity and exclusive lease.
    await this.options.authority.assertEligible({ goalId, jobId: job.jobId, nodeId: first.nodeId });
    let current = await this.transition(job, "PLANNING", "trusted hosted runner claimed queued Job");
    current = await this.transition(current, "IMPLEMENTING", "bounded approved hosted execution started");
    const candidate = await this.options.authority.build({ job: current, nodeId: first.nodeId, allowedPaths: [...binding.allowedPaths] });
    assertDevelopmentChangeSet(candidate);
    if (candidate.jobId !== job.jobId || candidate.baseRevision !== this.options.baseRevision ||
      candidate.deviceId !== this.options.builderId || candidate.changedPaths.some(path => !binding.allowedPaths.includes(path))) {
      throw Error("HOSTED_GOAL_BUILDER_SCOPE_INVALID");
    }
    await this.options.changes.put(candidate);
    current = await this.transition(current, "VERIFYING", "hosted candidate staged; independent receipt required");
    const complete = await this.completeWithSignedReceipt(current);
    const fresh = await this.options.jobs.getByGoal(goalId);
    return this.report(fresh, [], complete ? undefined : `independent_verifier_pending:${job.jobId}`);
  }
}
