import type { GoalRecord } from "../compass/store.ts";
import { validateCognitiveGoalRefinement } from "./cognitive-goal-input.ts";
export { validateCognitiveGoalRefinement, type CognitiveGoalRefinement } from "./cognitive-goal-input.ts";
import { cognitiveDigest } from "../gai/cognitive-state.ts";
import { compassGoalToLoopGoal } from "./compass-state-store.ts";
import { assessGoalReadiness, normalizeGoalDraft } from "./goal-draft.ts";
import type { Goal } from "./goal-loop.ts";
import { goalWorkStateId } from "./work-state-integration.ts";

/** Adoption audit data, never an execution grant or completion evidence. */
export interface CognitiveGoalRefinementReceipt {
  readonly kind: "goriq-cognitive-goal-refinement";
  readonly version: 1;
  readonly goalId: string;
  readonly requestDigest: string;
  readonly sourceGoalDigest: string;
  readonly targetGoalDigest: string;
  readonly criteriaDigest: string;
  readonly transition: readonly ["PROPOSED", "ADOPTED"];
}

const RECEIPT_FIELDS = ["kind", "version", "goalId", "requestDigest", "sourceGoalDigest", "targetGoalDigest", "criteriaDigest", "transition"];

function authoritativeGoal(record: GoalRecord): Goal {
  if (!record || typeof record.title !== "string" || !record.title.trim() || typeof record.description !== "string" ||
      !Array.isArray(record.successCriteria) || !Array.isArray(record.constraints) ||
      [...record.successCriteria, ...record.constraints].some((entry) => typeof entry !== "string" || !entry.trim())) throw Error("Invalid authoritative Compass Goal");
  return compassGoalToLoopGoal(record);
}

/**
 * Pure Goal Controller proposal. This function does not authorize or persist a
 * mutation. The owner-authenticated host must hold the shared execution lease,
 * reject any existing execution/material/learning/WorkState effects and commit
 * the new criteria plus receipt with an atomic full GoalRecord/StateRecord CAS.
 * Never apply this proposal using an unconditional CompassStore.setGoal call.
 */
export function prepareCognitiveGoalRefinement(record: GoalRecord, value: unknown): {
  goal: Goal;
  requestDigest: string;
  receipt: CognitiveGoalRefinementReceipt;
} {
  const input = validateCognitiveGoalRefinement(value);
  const current = authoritativeGoal(record);
  if (goalWorkStateId(current) !== input.goalId || cognitiveDigest(current) !== input.goalDigest) throw Error("Current Goal changed; reload before refining criteria");
  if (current.successCriteria.length !== 0) throw Error("Only a pristine Goal with empty criteria may be refined");
  const draft = normalizeGoalDraft({
    title: current.title,
    desiredOutcome: current.description || current.title,
    successCriteria: input.successCriteria,
    constraints: current.constraints,
    assumptions: [],
    unresolvedQuestions: [],
    // Confidence refers only to explicit owner-authored input, not its truth or
    // the executor's ability to complete it. Completion still requires evidence.
    confidence: 1,
    approvalRequired: false,
  });
  if (!assessGoalReadiness(draft).ready) throw Error("Explicit Goal criteria are not execution-ready");
  // Normalization validates the draft, but must not rename/reword the existing
  // authority fields or change the stable title/description-derived Goal ID.
  const goal: Goal = { ...current, successCriteria: [...draft.successCriteria], constraints: [...current.constraints] };
  const requestDigest = cognitiveDigest(input);
  const receipt: CognitiveGoalRefinementReceipt = Object.freeze({
    kind: "goriq-cognitive-goal-refinement",
    version: 1,
    goalId: input.goalId,
    requestDigest,
    sourceGoalDigest: input.goalDigest,
    targetGoalDigest: cognitiveDigest(goal),
    criteriaDigest: cognitiveDigest(goal.successCriteria),
    transition: Object.freeze(["PROPOSED", "ADOPTED"] as const),
  });
  return { goal, requestDigest, receipt };
}

/**
 * Idempotent acknowledgement only: a receipt cannot change current authority,
 * create a checkpoint, mark anything verified, or reopen a completed adoption.
 * A missing, stale or malformed receipt returns null so the mutation path must
 * perform its own pristine/CAS checks; it must not infer permission from null.
 */
export function findCognitiveGoalRefinementReplay(record: GoalRecord, decisions: unknown[], value: unknown): CognitiveGoalRefinementReceipt | null {
  const input = validateCognitiveGoalRefinement(value);
  const current = authoritativeGoal(record);
  if (!Array.isArray(decisions) || decisions.length > 10_000) throw Error("Invalid bounded Goal refinement decision history");
  if (current.successCriteria.length === 0 || goalWorkStateId(current) !== input.goalId) return null;
  let expected: CognitiveGoalRefinementReceipt;
  try { expected = prepareCognitiveGoalRefinement({ ...record, successCriteria: [] }, input).receipt; }
  catch { return null; }
  if (cognitiveDigest(current) !== expected.targetGoalDigest) return null;
  const matches = decisions.filter((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    return Object.keys(candidate).length === RECEIPT_FIELDS.length &&
      Object.keys(candidate).every((key) => RECEIPT_FIELDS.includes(key)) &&
      RECEIPT_FIELDS.every((key) => JSON.stringify(candidate[key]) === JSON.stringify(expected[key as keyof CognitiveGoalRefinementReceipt]));
  });
  if (matches.length > 1) throw Error("Duplicate Goal refinement receipts are ambiguous");
  return matches.length === 1 ? expected : null;
}
