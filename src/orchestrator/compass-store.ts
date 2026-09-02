import type { CompassStore } from "../compass/store.ts";
import type { LoopState, StateStore, WriteBackRecord } from "./goal-loop.ts";

function strings(values: unknown[]): string[] {
  return values.map((value) => typeof value === "string" ? value : JSON.stringify(value));
}

export class CompassLoopStateStore implements StateStore {
  constructor(private readonly compass: CompassStore) {}

  async getState(): Promise<LoopState> {
    const state = this.compass.getState();
    return {
      paused: state.status === "PAUSED",
      completed: strings(state.completed),
      blockers: strings(state.blockers),
      nextAction: state.nextAction,
    };
  }

  async writeBack(record: WriteBackRecord): Promise<void> {
    const result = record.result;
    const verification = record.verification;
    const blockers = result?.blocker ? [result.blocker] : record.stopReason === "blocked" ? [verification?.summary ?? "blocked"] : [];

    this.compass.writeBack({
      status: record.stopReason.toUpperCase(),
      summary: result?.summary ?? `Goal loop stopped: ${record.stopReason}`,
      completed: result?.ok ? [result.summary] : undefined,
      blockers,
      verification: verification ? {
        status: verification.ok ? "PASS" : "FAIL",
        summary: verification.summary,
        evidence: verification.evidence,
      } : undefined,
      nextAction: record.nextAction ?? null,
    });
  }
}
