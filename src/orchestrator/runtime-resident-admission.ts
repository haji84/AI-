import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CompassStore } from "../compass/store.ts";
import type { Goal } from "./goal-loop.ts";
import { routeFabricJob, type FabricJob, type FabricNode } from "./capability-fabric-router.ts";
import { routeDurableGoalJobs, type DurableJobPhase } from "./hosted-goal-work-router.ts";
import { isResidentExecutionWriter, ResidentExecutionStop, type ResidentDevelopmentAdmission } from "./resident-development-admission.ts";
import { residentDevelopmentGoalDigest } from "./resident-development-sequence.ts";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "./resident-runtime-files.ts";
import { ResourceWaitError } from "../gai/development-resource-admission.ts";
import { goalWorkStateId } from "./work-state-integration.ts";
import { compassGoalToLoopGoal } from "./compass-state-store.ts";
import { CompassWorkRunStore } from "./compass-work-run-store.ts";
import { CompassWorkStateStoreAdapter } from "./compass-work-state-store.ts";
import { canonicalRequirementBlockers } from "./owner-requirement-canonical.ts";

interface HostRoutingConfiguration {
  version: 1;
  authorityPath: string;
  goalId: string;
  goalDigest: string;
  taskScopeId: string;
  executionContractDigest: string;
  expiresAt: string;
  hostId: string;
  privacy: FabricJob["privacy"];
  nodes: FabricNode[];
}

/**
 * An opt-in admission to the existing resident path, never another Controller.
 * The pinned host document references an existing execution contract. It cannot
 * create Goals, Jobs, criteria, capability executors, verifier keys or approvals.
 * Ownership remains the Compass adapter's live same-filesystem exclusive lease.
 */
export function createRuntimeResidentAdmission(input: {
  env: Record<string, string | undefined>; runtimeRoot: string; compassPath: string; goal: Goal;
  executionContractDigest?: string; workspaces: string[]; now?: () => Date;
}): ResidentDevelopmentAdmission | undefined {
  const mode = input.env.GORIQ_EXECUTION_HOST_MODE?.trim();
  const file = input.env.GORIQ_HOSTED_ROUTING_FILE?.trim();
  const pin = input.env.GORIQ_HOSTED_ROUTING_SHA256?.trim();
  if (mode && mode !== "owner" && mode !== "hosted") throw Error("RESIDENT_EXECUTION_HOST_MODE_INVALID");
  if (!file && !pin && mode !== "hosted") return undefined;
  if (mode !== "hosted" || !file || !/^[a-f0-9]{64}$/.test(pin ?? "")) throw Error("HOSTED_ADMISSION_CONFIGURATION_REQUIRED");
  if (!/^[a-f0-9]{64}$/.test(input.executionContractDigest ?? "")) throw Error("HOSTED_EXECUTION_CONTRACT_REQUIRED");
  const hostId = input.env.GORIQ_EXECUTION_HOST_ID?.trim();
  if (!hostId) throw Error("HOSTED_EXECUTION_HOST_ID_REQUIRED");
  const now = input.now ?? (() => new Date());
  const goalDigest = residentDevelopmentGoalDigest(input.goal), goalId = goalWorkStateId(input.goal);
  const load = (): HostRoutingConfiguration => {
    const bytes = readBoundedRuntimeFile(file, 65_536, [input.runtimeRoot, ...input.workspaces]);
    if (createHash("sha256").update(bytes).digest("hex") !== pin) throw Error("HOSTED_ROUTING_PIN_MISMATCH");
    const value = JSON.parse(bytes.toString("utf8")) as HostRoutingConfiguration;
    if (!value || Object.keys(value).sort().join(",") !== "authorityPath,executionContractDigest,expiresAt,goalDigest,goalId,hostId,nodes,privacy,taskScopeId,version"
      || value.version !== 1 || value.goalId !== goalId || value.goalDigest !== goalDigest
      || typeof value.authorityPath !== "string" || resolve(value.authorityPath) !== resolve(input.compassPath)
      || value.executionContractDigest !== input.executionContractDigest
      || typeof value.taskScopeId !== "string" || !value.taskScopeId.trim()
      || !["public", "sensitive", "secret"].includes(value.privacy)
      || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))
      || Date.parse(value.expiresAt) <= now().getTime()) throw Error("HOSTED_ROUTING_SCOPE_INVALID_OR_EXPIRED");
    if (value.hostId !== hostId) throw Error("HOSTED_EXECUTION_HOST_ID_MISMATCH");
    assertExternalRuntimePath(value.authorityPath, input.workspaces);
    routeDurableGoalJobs([], value.nodes); // Use the existing router's strict inventory validation.
    if (value.nodes.find(node => node.id === hostId)?.kind !== "cloud") throw Error("HOSTED_EXECUTION_NODE_INVALID");
    return value;
  };
  load(); // Invalid explicit configuration cannot fall back to another runtime.
  const wait = (reason: string): never => { throw new ResourceWaitError({ status: "WAITING_FOR_RESOURCE",
    reason: "hosted_admission:" + reason, retryAfterMs: 30_000, observedAt: now().toISOString() }); };
  const readAuthority = async ({ goalId: requestedGoalId, goal, writer }: Parameters<ResidentDevelopmentAdmission["assertAuthority"]>[0]) => {
    const config = load();
    if (requestedGoalId !== config.goalId || residentDevelopmentGoalDigest(goal) !== config.goalDigest) throw Error("HOSTED_ROUTING_GOAL_SCOPE_MISMATCH");
    if (!isResidentExecutionWriter(writer, config.goalId, `${config.authorityPath}.cognitive-run.lock`)) {
      throw new ResidentExecutionStop("blocked", "HOSTED_EXCLUSIVE_WRITER_REQUIRED");
    }
    // The pinned authority is read here as well as at the adapter boundary.
    // A caller-supplied no-op callback or unrelated real lock grants nothing.
    const authority = new CompassStore(config.authorityPath);
    try {
      const [run, work] = await Promise.all([new CompassWorkRunStore(authority).getByGoal(config.goalId),
        new CompassWorkStateStoreAdapter(authority).get(config.goalId)]);
      const record = authority.getGoal(), state = authority.getState();
      if (!record || residentDevelopmentGoalDigest(compassGoalToLoopGoal(record)) !== config.goalDigest) {
        throw new ResidentExecutionStop("blocked", "hosted_canonical_goal_changed");
      }
      if (state.status === "PAUSED") throw new ResidentExecutionStop("paused", "project_paused");
      if (run?.phase === "HUMAN_GATE") throw new ResidentExecutionStop("human_gate", "human_gate");
      if (state.blockers.length || work?.blockers.length || canonicalRequirementBlockers(state.active, config.goalId).length
        || run && !["QUEUED", "PLANNING", "RUNNING", "VERIFYING", "RECOVERING"].includes(run.phase)) {
        throw new ResidentExecutionStop("blocked", "hosted_canonical_authority_blocked");
      }
    } finally { authority.close(); }
    return config;
  };
  return {
    async assertAuthority(input) { await readAuthority(input); },
    async check({ job, goal, workItemId, writer }) {
      const config = await readAuthority({ goalId: job.goalId, goal, writer });
      if (job.goalId !== config.goalId || residentDevelopmentGoalDigest(goal) !== config.goalDigest
        || job.approvalScope.taskScopeId !== config.taskScopeId) throw Error("HOSTED_ROUTING_JOB_SCOPE_MISMATCH");
      if (job.approvalScope.expiresAt && Date.parse(job.approvalScope.expiresAt) <= now().getTime()) {
        throw new ResidentExecutionStop("human_gate", "HOSTED_JOB_APPROVAL_EXPIRED");
      }
      if (job.phase === "CANCELLED") throw new ResidentExecutionStop("blocked", "development_job_cancelled");
      if (job.phase === "HUMAN_GATE") throw new ResidentExecutionStop("human_gate", "human_gate");
      const item = workItemId ? job.workItems.find(candidate => candidate.id === workItemId) : undefined;
      if (workItemId && !item) throw Error("HOSTED_ROUTING_WORK_ITEM_MISMATCH");
      const fabric: FabricJob = { id: job.jobId, privacy: config.privacy, risk: job.approvalScope.maxRisk,
        freshness: "static", evidenceMode: "LOCAL", maxIncrementalCost: 0,
        requiredCapabilities: [...new Set(job.workItems.flatMap(work => work.requiredCapabilities))] };
      const phase: DurableJobPhase = job.phase === "QUEUED" || job.phase === "PLANNING" ? "QUEUED"
        : job.phase === "BLOCKED" || job.phase === "COMPLETED" ? job.phase
          : job.phase === "VERIFYING" ? "VERIFYING" : "RUNNING";
      const route = routeDurableGoalJobs([{ goalId: job.goalId, job: fabric, phase }], config.nodes)[0]!;
      if (route.disposition === "HUMAN_REQUIRED") throw new ResidentExecutionStop("human_gate", "hosted_admission_human_required");
      if (route.disposition === "IN_PROGRESS") {
        // Preserve the actual in-flight phase. The exclusive canonical writer
        // resumes it; a new router dispatch never impersonates a QUEUED Job.
        const current = config.nodes.find(node => node.id === hostId)!;
        if (fabric.privacy !== "public" || fabric.risk !== "low" || current.privacy !== "public-ok"
          || routeFabricJob(fabric, [current]).blocked) wait("current_host_no_longer_eligible");
        return;
      }
      if (route.disposition === "RUN_HOSTED" && route.nodeId === hostId) return;
      if (route.disposition === "BLOCKED" || route.disposition === "PAUSED" || route.disposition === "WAITING_FOR_VERIFICATION") {
        throw new ResidentExecutionStop("blocked", "hosted_admission:" + route.disposition);
      }
      wait(route.nodeId && route.nodeId !== hostId ? "selected_host_unavailable_here" : route.disposition);
    },
  };
}
