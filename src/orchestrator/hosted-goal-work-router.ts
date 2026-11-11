import { routeFabricJob, type FabricJob, type FabricNode } from "./capability-fabric-router.ts";

/** Only prepares routing decisions. Execution is performed by the existing Goal Controller. */
export type DurableJobPhase = "QUEUED" | "RUNNING" | "VERIFYING" | "COMPLETED" | "BLOCKED" | "PAUSED";

export interface DurableGoalJob {
  goalId: string;
  job: FabricJob;
  phase: DurableJobPhase;
  dependsOn?: string[];
  /** Must come from a trusted independent verifier; a completed worker claim is not enough. */
  verified?: boolean;
  humanApprovalRequired?: boolean;
}

export type JobDisposition =
  | "RUN_HOSTED" | "RUN_OWNER_WORKER" | "WAITING_FOR_CAPABILITY"
  | "WAITING_FOR_DEPENDENCY" | "HUMAN_REQUIRED" | "WAITING_FOR_VERIFICATION"
  | "IN_PROGRESS" | "ALREADY_VERIFIED" | "PAUSED" | "BLOCKED";

export interface GoalJobRoute {
  goalId: string;
  jobId: string;
  disposition: JobDisposition;
  nodeId: string | null;
  reason: string;
}

const pairKey = (goalId: string, jobId: string) => JSON.stringify([goalId, jobId]);
const jobKey = (item: Pick<DurableGoalJob, "goalId" | "job">) => pairKey(item.goalId, item.job.id);
const idSafe = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id);

/**
 * Route each already-accepted Job independently. GitHub-hosted public work can
 * continue while ZBook/Mac capabilities are offline; dependent work waits for
 * independently verified completion. No Goal/Job IDs, authority or credentials
 * are minted here, and selecting a node does not authorize execution.
 */
export function routeDurableGoalJobs(jobs: readonly DurableGoalJob[], nodes: readonly FabricNode[]): GoalJobRoute[] {
  if (!Array.isArray(jobs) || jobs.length > 64) throw new Error("GOAL_ROUTING_JOB_LIMIT");
  if (!Array.isArray(nodes) || nodes.length > 100) throw new Error("GOAL_ROUTING_NODE_LIMIT");
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node || !idSafe(node.id) ||
      !["cloud", "online", "local", "device", "gpu"].includes(node.kind) ||
      !["local-only", "redacted-ok", "public-ok"].includes(node.privacy) ||
      typeof node.online !== "boolean" || typeof node.healthy !== "boolean" ||
      !Number.isFinite(node.incrementalCost) || node.incrementalCost < 0 ||
      !Number.isFinite(node.reliability) || !Number.isFinite(node.latencyMs) ||
      !Array.isArray(node.capabilities) || node.capabilities.length > 64 ||
      node.capabilities.some((name) => typeof name !== "string" || !idSafe(name)) ||
      !Array.isArray(node.evidenceModes) ||
      node.evidenceModes.some((mode) => !["LOCAL", "ONLINE", "CONNECTED", "DEVICE"].includes(mode))) {
      throw new Error("GOAL_ROUTING_INVALID_NODE");
    }
    if (nodeIds.has(node.id)) throw new Error("GOAL_ROUTING_DUPLICATE_NODE");
    nodeIds.add(node.id);
  }
  const byKey = new Map<string, DurableGoalJob>();
  for (const item of jobs) {
    if (!item || !idSafe(item.goalId) || !idSafe(item.job?.id)
      || !Array.isArray(item.job.requiredCapabilities)
      || item.job.requiredCapabilities.length > 32
      || item.job.requiredCapabilities.some((s) => typeof s !== "string" || !idSafe(s))
      || !["secret", "sensitive", "public"].includes(item.job.privacy)
      || !["low", "medium", "high", "critical"].includes(item.job.risk)
      || !["current", "historical", "static"].includes(item.job.freshness)
      || (item.job.evidenceMode !== undefined && !["LOCAL", "ONLINE", "CONNECTED", "DEVICE"].includes(item.job.evidenceMode))
      || (item.job.maxIncrementalCost !== undefined && (!Number.isFinite(item.job.maxIncrementalCost) || item.job.maxIncrementalCost < 0))
      || !["QUEUED", "RUNNING", "VERIFYING", "COMPLETED", "BLOCKED", "PAUSED"].includes(item.phase)) {
      throw new Error("GOAL_ROUTING_INVALID_JOB");
    }
    if (byKey.has(jobKey(item))) throw new Error("GOAL_ROUTING_DUPLICATE_JOB");
    byKey.set(jobKey(item), item);
  }
  const dependencies = new Map<string, string[]>();
  for (const item of jobs) {
    const current = jobKey(item);
    const refs = item.dependsOn ?? [];
    if (!Array.isArray(refs) || refs.length > 64 || new Set(refs).size !== refs.length) {
      throw new Error("GOAL_ROUTING_INVALID_DEPENDENCY");
    }
    const keys = refs.map((jobId) => {
      if (typeof jobId !== "string" || !idSafe(jobId)) throw new Error("GOAL_ROUTING_INVALID_DEPENDENCY");
      const key = pairKey(item.goalId, jobId);
      if (key === current || !byKey.has(key)) throw new Error("GOAL_ROUTING_FOREIGN_OR_MISSING_DEPENDENCY");
      return key;
    });
    dependencies.set(current, keys);
  }
  const explored = new Set<string>(), inStack = new Set<string>();
  function visit(key: string): void {
    if (inStack.has(key)) throw new Error("GOAL_ROUTING_DEPENDENCY_CYCLE");
    if (explored.has(key)) return;
    inStack.add(key);
    for (const dep of dependencies.get(key) ?? []) visit(dep);
    inStack.delete(key);
    explored.add(key);
  }
  for (const key of byKey.keys()) visit(key);

  const output = (item: DurableGoalJob, disposition: JobDisposition, reason: string, nodeId: string | null = null): GoalJobRoute => ({
    goalId: item.goalId, jobId: item.job.id, disposition, nodeId, reason,
  });
  return jobs.map((item) => {
    if (item.phase === "PAUSED") return output(item, "PAUSED", "explicit pause; do not dispatch");
    if (item.phase === "BLOCKED") return output(item, "BLOCKED", "authoritative blocked state; do not dispatch");
    if (item.humanApprovalRequired === true || item.job.risk === "high" || item.job.risk === "critical") {
      return output(item, "HUMAN_REQUIRED", "existing authority gate required; routing does not grant approval");
    }
    if (item.phase === "COMPLETED") return item.verified === true
      ? output(item, "ALREADY_VERIFIED", "independent completion already recorded")
      : output(item, "WAITING_FOR_VERIFICATION", "completion lacks independent verification");
    if (item.phase === "RUNNING" || item.phase === "VERIFYING") {
      return output(item, "IN_PROGRESS", "existing in-flight Job; do not start a duplicate");
    }
    const unmet = (dependencies.get(jobKey(item)) ?? [])
      .filter((key) => {
        const predecessor = byKey.get(key)!;
        return predecessor.phase !== "COMPLETED" || predecessor.verified !== true;
      });
    if (unmet.length > 0) return output(item, "WAITING_FOR_DEPENDENCY", `unverified predecessors: ${unmet.length}`);
    // The hosted lane is public, bounded and requires zero incremental spend.
    // Real external/gpu/physical evidence must go through a matching worker.
    if (item.job.privacy === "public" && item.job.risk === "low") {
      const hosted = routeFabricJob({ ...item.job, maxIncrementalCost: 0 },
        nodes.filter((node) => node.kind === "cloud" && node.privacy === "public-ok" && node.online && node.healthy));
      if (!hosted.blocked && hosted.node) return output(item, "RUN_HOSTED", "eligible hosted capability declared; execution host must verify identity", hosted.node.id);
    }
    const worker = routeFabricJob({ ...item.job, maxIncrementalCost: 0 },
      nodes.filter((node) => node.kind === "local" || node.kind === "device" || node.kind === "gpu"));
    if (!worker.blocked && worker.node) return output(item, "RUN_OWNER_WORKER", "matching trusted owner worker available", worker.node.id);
    return output(item, "WAITING_FOR_CAPABILITY", "no verified zero-cost node satisfies capability/privacy/evidence/risk");
  });
}
