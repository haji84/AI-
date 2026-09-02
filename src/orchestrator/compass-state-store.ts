import type { CompassStore, GoalRecord, StateRecord, WriteBackInput } from "../compass/store.ts";
import type { Goal, LoopState, StateStore, WriteBackRecord } from "./goal-loop.ts";

function strings(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string");
}

export function compassGoalToLoopGoal(goal: GoalRecord): Goal {
  return {
    title: goal.title,
    description: goal.description || undefined,
    successCriteria: strings(goal.successCriteria),
    constraints: strings(goal.constraints),
  };
}

export function compassStateToLoopState(state: StateRecord): LoopState {
  return {
    paused: state.status === "PAUSED",
    retriesForCurrentAction: 0,
    completed: strings(state.completed),
    blockers: strings(state.blockers),
    nextAction: state.nextAction,
  };
}

export class CompassStateStoreAdapter implements StateStore {
  private readonly compass: CompassStore;

  constructor(compass: CompassStore) {
    this.compass = compass;
  }

  async getState(): Promise<LoopState> {
    return compassStateToLoopState(this.compass.getState());
  }

  async writeBack(record: WriteBackRecord): Promise<void> {
    const current = this.compass.getState();
    const completed = [...strings(current.completed)];
    if (record.result?.ok && record.action?.description && !completed.includes(record.action.description)) {
      completed.push(record.action.description);
    }

    const blockers = strings(current.blockers);
    if (record.result?.blocker && !blockers.includes(record.result.blocker)) blockers.push(record.result.blocker);

    const verification = record.verification
      ? {
          status: record.verification.ok ? "PASS" as const : "FAIL" as const,
          summary: record.verification.summary,
          evidence: record.verification.evidence,
        }
      : undefined;

    const input: WriteBackInput = {
      status: record.stopReason,
      summary: record.result?.summary ?? record.intent.summary,
      completed,
      blockers,
      verification,
      nextAction: record.nextAction ?? null,
    };

    this.compass.writeBack(input);
  }
}
