import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CompassStore } from "../compass/store.ts";
import { compassGoalToLoopGoal } from "./compass-state-store.ts";
import { goalWorkStateId } from "./work-state-integration.ts";
import { JsonFileDevelopmentJobStore } from "./development-job-store.ts";
import { JsonFileDevelopmentChangeSetStore } from "./development-change-set-store.ts";
import { assertResidentMutation, residentControl, type ResidentAuthoritySnapshot, type ResidentExecutionAuthority } from "./resident-execution-authority.ts";
import type { WorkRunState } from "./work-run-state.ts";
import type { WorkState } from "./work-state.ts";
import type { GoalBridgeEvent } from "./goal-bridge-events.ts";

export function createCompassResidentExecutionAuthority(input: { compassPath: string }): ResidentExecutionAuthority {
  const path = resolve(input.compassPath), stateRoot = join(dirname(path), "self-development");
  const observed = new WeakMap<ResidentAuthoritySnapshot, ResidentAuthoritySnapshot>();
  const view = (db: CompassStore, goalId: string): ResidentAuthoritySnapshot => {
    const record = db.getGoal();
    if (!record) throw Error("Compass goal is not set");
    const goal = compassGoalToLoopGoal(record);
    if (goalWorkStateId(goal) !== goalId) throw Error("RESIDENT_AUTHORITY_GOAL_MISMATCH");
    const state = db.getState();
    const envelopes = state.active.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    const run = (envelopes.find(item => item.kind === "jarvis-work-runs")?.runs as WorkRunState[] | undefined)?.find(item => item.goalId === goalId);
    if (!run) throw Error("Accepted Goal has no durable Work Run");
    const work = envelopes.find(item => item.kind === "gai-work-state" && item.goalId === goalId)?.state as WorkState | undefined;
    const events = (envelopes.find(item => item.kind === "goriq-goal-bridge-events")?.events as GoalBridgeEvent[] | undefined) ?? [];
    return structuredClone({ goalId, goal, control: residentControl(state), run, work: work ?? null, events: events.filter(event => event.goalId === goalId) });
  };
  return { kind: "compass", authorityPath: path, persistence: {
    jobs: new JsonFileDevelopmentJobStore(join(stateRoot, "jobs.json")),
    changeSets: new JsonFileDevelopmentChangeSetStore(join(stateRoot, "change-sets.json")),
  }, async assertFence() { /* The branded OS writer remains the Compass fence. */ },
  async read(goalId) {
    const db = new CompassStore(path);
    try { const snapshot = view(db, goalId); observed.set(snapshot, structuredClone(snapshot)); return snapshot; }
    finally { db.close(); }
  }, async commit(expected, next) {
    next = structuredClone(next);
    const prior = observed.get(expected); observed.delete(expected);
    if (!prior || !isDeepStrictEqual(prior, expected)) throw Error("RESIDENT_AUTHORITY_READ_REQUIRED");
    assertResidentMutation(prior, next);
    const db = new CompassStore(path);
    try { db.updateActive(active => {
      if (!isDeepStrictEqual(view(db, prior.goalId), prior)) throw Error("RESIDENT_AUTHORITY_STALE");
      const existingRuns = active.find(item => item && typeof item === "object" && (item as {kind?: unknown}).kind === "jarvis-work-runs") as {runs:WorkRunState[]};
      const existingEvents = active.find(item => item && typeof item === "object" && (item as {kind?: unknown}).kind === "goriq-goal-bridge-events") as {events:GoalBridgeEvent[]} | undefined;
      const existingWork = active.find(item => item && typeof item === "object" && (item as {kind?: unknown}).kind === "gai-work-state" && (item as {goalId?: unknown}).goalId === prior.goalId) as Record<string, unknown> | undefined;
      return [...active.filter(item => {
        if (!item || typeof item !== "object") return true;
        const value = item as {kind?:unknown;goalId?:unknown};
        return value.kind !== "jarvis-work-runs" && value.kind !== "goriq-goal-bridge-events" && !(value.kind === "gai-work-state" && value.goalId === prior.goalId);
      }), {kind:"jarvis-work-runs",version:1,runs:[...existingRuns.runs.filter(run => run.goalId !== prior.goalId),next.run]},
      {kind:"goriq-goal-bridge-events",version:1,events:[...(existingEvents?.events ?? []).filter(event => event.goalId !== prior.goalId),...next.events]},
      ...(next.work ? [{...existingWork,kind:"gai-work-state",version:1,goalId:prior.goalId,state:next.work,events:existingWork?.events ?? []}] : [])];
    }); } finally { db.close(); }
  } };
}
