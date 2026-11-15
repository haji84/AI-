import { isDeepStrictEqual } from "node:util";
import type { Goal } from "./goal-loop.ts";
import type { StateRecord } from "../compass/store.ts";
import type { WorkRunState } from "./work-run-state.ts";
import type { WorkState } from "./work-state.ts";
import type { GoalBridgeEvent } from "./goal-bridge-events.ts";
import type { ResidentDevelopmentGoalHost } from "./resident-development-goal-host.ts";
import { canonicalRequirementBlockers } from "./owner-requirement-canonical.ts";
import { ResidentExecutionStop } from "./resident-development-admission.ts";

export type ResidentPersistence = Pick<ConstructorParameters<typeof ResidentDevelopmentGoalHost>[0], "jobs" | "changeSets">;
export type ResidentControlState = Pick<StateRecord, "status" | "blockers" | "active" | "nextAction">;
export interface ResidentAuthoritySnapshot {
  goalId: string;
  goal: Goal;
  control: ResidentControlState;
  run: WorkRunState;
  work: WorkState | null;
  events: GoalBridgeEvent[];
}
/** A trusted host dependency, never an intake/model supplied authority. */
export interface ResidentExecutionAuthority {
  readonly kind: "compass" | "shared";
  readonly authorityPath: string;
  readonly persistence: ResidentPersistence;
  read(goalId: string): Promise<ResidentAuthoritySnapshot>;
  assertFence(): Promise<void>;
  commit(expected: ResidentAuthoritySnapshot, next: ResidentAuthoritySnapshot): Promise<void>;
}
const managed = new Set(["jarvis-work-runs", "gai-work-state", "goriq-goal-bridge-events"]);
export function residentControl(state: ResidentControlState): ResidentControlState {
  return structuredClone({ status: state.status, blockers: state.blockers, nextAction: state.nextAction,
    active: state.active.filter(item => !item || typeof item !== "object" || !managed.has(String((item as { kind?: unknown }).kind))) });
}
export const residentRunnablePhases = ["QUEUED", "PLANNING", "RUNNING", "VERIFYING", "RECOVERING"];
export function assertResidentAuthority(snapshot: ResidentAuthoritySnapshot): void {
  if (snapshot.control.status === "PAUSED") throw new ResidentExecutionStop("paused", "project_paused");
  if (snapshot.run.phase === "HUMAN_GATE") throw new ResidentExecutionStop("human_gate", "human_gate");
  if (!residentRunnablePhases.includes(snapshot.run.phase)) throw new ResidentExecutionStop("blocked", "resident_work_run_no_longer_runnable");
  if (snapshot.control.blockers.length || snapshot.work?.blockers.length ||
      canonicalRequirementBlockers(snapshot.control.active, snapshot.goalId).length) {
    throw new ResidentExecutionStop("blocked", "resident_authority_blocked");
  }
}
/** Runtime progress cannot change any owner control or accepted contract. */
export function assertResidentMutation(before: ResidentAuthoritySnapshot, next: ResidentAuthoritySnapshot): void {
  if (!isDeepStrictEqual(before.control, next.control)) throw Error("RESIDENT_AUTHORITY_CONTROL_IMMUTABLE");
  if (before.goalId !== next.goalId || !isDeepStrictEqual(before.goal, next.goal) ||
      next.run.goalId !== before.goalId || next.run.runId !== before.run.runId ||
      next.run.createdAt !== before.run.createdAt || Date.parse(next.run.updatedAt) < Date.parse(before.run.updatedAt) ||
      next.run.completedJobs < before.run.completedJobs || next.run.recoveryCount < before.run.recoveryCount ||
      before.run.blockers.some(blocker => !next.run.blockers.includes(blocker)) ||
      next.run.evidenceRefs.length < before.run.evidenceRefs.length || before.run.evidenceRefs.some((ref, index) => next.run.evidenceRefs[index] !== ref) ||
      ["HUMAN_GATE", "BLOCKED", "COMPLETED", "FAILED"].includes(before.run.phase) && !isDeepStrictEqual(before.run, next.run)) {
    throw Error("RESIDENT_AUTHORITY_CONTRACT_IMMUTABLE");
  }
  if (next.events.length < before.events.length || before.events.some((event, i) => !isDeepStrictEqual(event, next.events[i])) ||
      next.events.some(event => event.goalId !== before.goalId)) throw Error("RESIDENT_AUTHORITY_EVENTS_IMMUTABLE");
  if (before.work) {
    if (!next.work || ["goalId", "objective", "definitionOfDone", "riskClass", "constraints", "decisions", "artifacts", "childWorkItems"].some(key =>
      !isDeepStrictEqual(before.work![key as keyof WorkState], next.work![key as keyof WorkState])) ||
      before.work.blockers.some(blocker => !next.work!.blockers.includes(blocker)) ||
      before.work.verificationResults.some(result => !next.work!.verificationResults.some(item => isDeepStrictEqual(item, result))) ||
      before.work.status === "COMPLETED" && next.work.status !== "COMPLETED") throw Error("RESIDENT_AUTHORITY_WORK_IMMUTABLE");
  }
}
