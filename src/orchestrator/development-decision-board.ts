import { createHash } from "node:crypto";
import type { WorkState } from "./work-state.ts";
import type { CompletionCycle, CompletionInput } from "./completion-path.ts";

const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const SHA = /^[a-f0-9]{40}$/;

function validResourceLocks(value: unknown): value is string[] {
  if (!Array.isArray(value) || !value.length) return false;
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false;
    const lock: unknown = value[index];
    if (typeof lock !== "string" || !lock.trim() || seen.has(lock)) return false;
    seen.add(lock);
  }
  return true;
}

export interface Ai09AdvisoryEvidence {
  expectedBaseSha: string;
  expectedHeadSha: string;
  receiptBaseSha: string;
  receiptHeadSha: string;
  expectedBatchCount: number;
  reviewedBatchCount: number;
  missingBatchIndexes: number[];
  invalidReceiptCount: number;
  pendingIndependentVerification: number;
  acceptedReview: boolean;
}
export interface DevelopmentDecisionBoardOptions {
  maxParallelJobs: number;
  /** Trusted host inventory, never model-inferred. Include a shared PR/branch lock for writers. */
  verifiedResourceLocks: Record<string, string[]>;
  ai09?: Ai09AdvisoryEvidence;
}

/** Read-only, evidence-bound answers to the five owner decisions. Never schedules or approves work. */
export function buildDevelopmentDecisionBoard(
  state: WorkState, input: CompletionInput, cycle: CompletionCycle,
  options: DevelopmentDecisionBoardOptions,
) {
  if (cycle.executionAuthority !== false || state.goalId !== input.goalId ||
      cycle.stateDigest !== digest(state) || cycle.inputDigest !== digest(input) ||
      cycle.cycleId !== input.cycleId ||
      !Number.isSafeInteger(options.maxParallelJobs) || options.maxParallelJobs < 1 ||
      options.maxParallelJobs > 32 || !options.verifiedResourceLocks ||
      typeof options.verifiedResourceLocks !== "object" ||
      cycle.candidates.length !== input.candidates.length ||
      new Set(cycle.candidates.map(c => c.taskId)).size !== cycle.candidates.length ||
      cycle.candidates.some(c => !input.candidates.some(x => x.workItem.id === c.taskId))) {
    throw Error("STALE_OR_UNTRUSTED_DECISION_BOARD_INPUT");
  }
  const ready = cycle.candidates.filter(c => c.status === "READY")
    .sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId));
  const parallel: string[] = [];
  const missingLocks: string[] = [];
  const heldLocks = new Set<string>();
  for (const task of ready) {
    const locks = options.verifiedResourceLocks[task.taskId];
    // Unknown write scopes must not silently become independent workers.
    if (!validResourceLocks(locks)) {
      missingLocks.push(task.taskId);
      continue;
    }
    if (parallel.length >= options.maxParallelJobs) continue;
    if (locks.some(lock => heldLocks.has(lock))) continue;
    parallel.push(task.taskId);
    locks.forEach(lock => heldLocks.add(lock));
  }
  const humanActions = cycle.notifications
    .filter(n => n.status !== "ANSWERED" || n.response?.status !== "approved")
    .map(n => ({taskId:n.taskId,kind:n.kind,operation:n.operation,
      target:n.target,status:n.status,response:n.response?.status ?? null,
      reason:n.reason}));
  const gatedTasks = cycle.candidates
    .filter(c => c.status === "HUMAN_REQUIRED" || c.status === "SECURITY_BLOCK")
    .map(c => ({taskId:c.taskId,status:c.status,reasons:c.reasons}));
  const a = options.ai09;
  let ai09 = "NO_EVIDENCE" as "NO_EVIDENCE" | "STALE_OR_INVALID" | "HOLD" | "SOURCE_COVERED_ADVISORY_ONLY";
  if (a) {
    const valid = [a.expectedBaseSha,a.expectedHeadSha,a.receiptBaseSha,a.receiptHeadSha].every(s=>SHA.test(s)) &&
      Number.isSafeInteger(a.expectedBatchCount) && a.expectedBatchCount > 0 &&
      Number.isSafeInteger(a.reviewedBatchCount) && a.reviewedBatchCount >= 0 &&
      Array.isArray(a.missingBatchIndexes) &&
      a.missingBatchIndexes.every(n=>Number.isSafeInteger(n) && n>=0 && n<a.expectedBatchCount) &&
      Number.isSafeInteger(a.invalidReceiptCount) && a.invalidReceiptCount>=0 &&
      Number.isSafeInteger(a.pendingIndependentVerification) && a.pendingIndependentVerification>=0 &&
      typeof a.acceptedReview === "boolean";
    if (!valid || a.expectedBaseSha !== a.receiptBaseSha ||
        a.expectedHeadSha !== a.receiptHeadSha) ai09="STALE_OR_INVALID";
    else if (a.acceptedReview && a.expectedBatchCount === a.reviewedBatchCount &&
        a.missingBatchIndexes.length===0 && a.invalidReceiptCount===0 &&
        a.pendingIndependentVerification===0) ai09="SOURCE_COVERED_ADVISORY_ONLY";
    else ai09="HOLD";
  }
  return {
    executionAuthority: false as const,
    goalId:state.goalId, cycleId:cycle.cycleId,
    missingFromGoal:[...cycle.remainingCriteria],
    missingEvidenceAndBlockers:[...cycle.gaps,...cycle.blockers],
    next:cycle.recommendation ? {
      taskId:cycle.recommendation.taskId,mode:cycle.recommendation.mode,
      reuse:cycle.recommendation.reuse,
    } : null,
    parallel:{proposals:parallel,resourceLockEvidenceMissing:missingLocks,
      maxSlots:options.maxParallelJobs},
    humanActions,gatedTasks,
    completion:cycle.readyForCompletionReview ? "INDEPENDENT_ACCEPTANCE_REQUIRED" as const : "REQUIREMENTS_OPEN" as const,
    ai09,
    // Neither model review nor this advisory is an execution/merge/completion grant.
    mergeAuthorized:false as const,goalAchieved:false as const,
  };
}
