import type { CompassStore, GoalRecord } from "../compass/store.ts";
import { assessGoalReadiness, type GoalDraft } from "./goal-draft.ts";

export interface GoalDraftCompassResult {
  ready: boolean;
  reasons: string[];
  goal: GoalRecord | null;
}

export function applyExecutionReadyGoalDraft(compass: CompassStore, draft: GoalDraft): GoalDraftCompassResult {
  const readiness = assessGoalReadiness(draft);
  if (!readiness.ready) {
    return { ready: false, reasons: readiness.reasons, goal: null };
  }

  const goal = compass.setGoal({
    title: draft.title,
    description: draft.desiredOutcome,
    successCriteria: draft.successCriteria,
    constraints: draft.constraints,
  });

  return { ready: true, reasons: [], goal };
}
