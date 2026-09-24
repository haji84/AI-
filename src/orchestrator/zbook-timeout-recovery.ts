import type { CompassStore } from "../compass/store.ts";
import { CompassWorkRunStore } from "./compass-work-run-store.ts";
import { CompassWorkStateStoreAdapter } from "./compass-work-state-store.ts";

/** One bounded recovery transition for an independently confirmed coding timeout. */
export async function recoverTimedOutGoal(
  compass: CompassStore,
  goalId: string,
  proof: { timeoutConfirmed: boolean },
): Promise<"RECOVERED" | "ALREADY_QUEUED"> {
  const runs = new CompassWorkRunStore(compass);
  const work = new CompassWorkStateStoreAdapter(compass);
  const run = await runs.getByGoal(goalId);
  const state = await work.get(goalId);
  const loop = compass.getState();
  if (!run || !state || run.goalId !== state.goalId) throw new Error("Recovery requires an existing bound Goal and Work Run");
  if (run.phase === "QUEUED" && state.status === "IN_PROGRESS" && state.blockers.length === 0 && loop.blockers.length === 0) return "ALREADY_QUEUED";
  const originallyBlocked = state.status === "BLOCKED" && state.blockers.length === 1 && state.blockers[0] === "http_code_builder_error";
  const interruptedRecovery = state.status === "IN_PROGRESS" && state.blockers.length === 0;
  if (!proof.timeoutConfirmed || run.phase !== "BLOCKED" || !(originallyBlocked || interruptedRecovery)
    || !loop.blockers.every(blocker => blocker === "http_code_builder_error")
    || run.blockers.some(blocker => blocker !== "blocked" && blocker !== "http_code_builder_error")) {
    throw new Error("Recovery refused: timeout-only BLOCKED state was not proven");
  }
  const now = new Date().toISOString();
  const recovered = { ...state, status: "IN_PROGRESS" as const, blockers: [], nextAction: "Retry coding with increased bounded timeout", updatedAt: now };
  await work.put(recovered);
  try {
    compass.updateState({ blockers: [], nextAction: recovered.nextAction });
    await runs.put({ ...run, phase: "QUEUED", blockers: [], nextAction: recovered.nextAction, recoveryCount: run.recoveryCount + 1, updatedAt: now });
  } catch (error) {
    compass.updateState({ blockers: loop.blockers, nextAction: loop.nextAction });
    await work.put(state);
    throw error;
  }
  await work.appendEvent(goalId, { id: `timeout-recovery-${now}`, at: now, type: "RECOVERY", summary: "Confirmed coding timeout; same Work Run queued with bounded increased budget" });
  return "RECOVERED";
}
