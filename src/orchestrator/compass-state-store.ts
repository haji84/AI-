import type { DurableTaskExecutionClaim, DurableTaskRuntime } from "../gai/durable-task-runtime.ts";
import { canonicalRequirementBlockers } from "./owner-requirement-canonical.ts";
import { goalWorkStateId } from "./work-state-integration.ts";
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

/** Verify an existing fenced execution claim before Compass accepts progress. */
export function durableClaimWriteAuthority(runtime: DurableTaskRuntime, claim: DurableTaskExecutionClaim): () => Promise<void> {
  return async () => {
    // Heartbeat validates owner, epoch, fencing token and lease expiry atomically
    // in the durable store. It does not confer any new Goal or approval authority.
    await runtime.heartbeatClaimed(claim);
  };
}

export class CompassStateStoreAdapter implements StateStore {
  private readonly compass: CompassStore;
  private readonly assertWriteAuthority?: () => Promise<void>;
  private readonly assertAtomicWriteAuthority?: () => void;

  constructor(compass: CompassStore, assertWriteAuthority?: () => Promise<void>, assertAtomicWriteAuthority?: () => void) {
    this.compass = compass;
    this.assertWriteAuthority = assertWriteAuthority;
    this.assertAtomicWriteAuthority = assertAtomicWriteAuthority;
  }

  async completionBlockers(goal: Goal): Promise<string[]> {
    return canonicalRequirementBlockers(this.compass.getState().active, goalWorkStateId(goal));
  }

  async getState(): Promise<LoopState> {
    return compassStateToLoopState(this.compass.getState());
  }

  async writeBack(record: WriteBackRecord): Promise<void> {
    if (record.stopReason === "goal_complete") {
      const pending = await this.completionBlockers(record.goal);
      if (pending.length) record = { ...record, stopReason: "blocked", nextAction: pending.join("; ") };
    }
    const current = this.compass.getState();
    const completed = [...strings(current.completed)];
    if (record.result?.ok && record.action?.description && !completed.includes(record.action.description)) {
      completed.push(record.action.description);
    }

    let blockers = strings(current.blockers);
    if (record.action && record.result?.blocker) {
      blockers = [record.result.blocker];
    } else if (record.action && record.result?.ok && record.verification?.ok) {
      blockers = [];
    }

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

    // Reject stale ownership before committing Goal progress. This guard must be
    // backed by the authoritative execution claim, not a PID or lock-file probe.
    await this.assertWriteAuthority?.();
    // A separate lease check cannot make the following Compass write atomic.
    // Refuse success/progress commits until a shared transaction or fencing
    // boundary covers both authority validation and the Compass mutation.
    if (this.assertWriteAuthority && (record.result?.ok || record.stopReason === "goal_complete" || record.verification?.ok)) {
      throw new Error("COMPASS_FENCED_WRITE_ATOMICITY_REQUIRED");
    }
    this.compass.writeBack(input, this.assertAtomicWriteAuthority);
  }
}
