import { canonicalRequirementBlockers } from "./owner-requirement-canonical.ts";
import type { CompassStore } from "../compass/store.ts";
import type { WorkEvent, WorkState, WorkStateStore } from "./work-state.ts";

const KIND = "gai-work-state";
const VERSION = 1;
const MAX_EVENTS = 100;

interface WorkStateEnvelope {
  kind: typeof KIND;
  version: typeof VERSION;
  goalId: string;
  state: WorkState;
  events: WorkEvent[];
}

function isEnvelope(value: unknown): value is WorkStateEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === KIND
    && record.version === VERSION
    && typeof record.goalId === "string"
    && !!record.state
    && typeof record.state === "object"
    && Array.isArray(record.events);
}

export class CompassWorkStateStoreAdapter implements WorkStateStore {
  private readonly compass: CompassStore;
  private readonly fenced: boolean;
  private readonly assertAtomicWriteAuthority?: () => void;

  constructor(compass: CompassStore, fenced = false, assertAtomicWriteAuthority?: () => void) {
    this.compass = compass;
    this.fenced = fenced;
    this.assertAtomicWriteAuthority = assertAtomicWriteAuthority;
  }

  private assertAtomicAuthority(): void {
    // A separate Durable Task lease check cannot protect this Compass mutation.
    // Reject fenced writes until the lease and Compass share an atomic boundary.
    if (this.fenced && !this.assertAtomicWriteAuthority) throw new Error("COMPASS_FENCED_WORK_STATE_ATOMICITY_REQUIRED");
  }

  async get(goalId: string): Promise<WorkState | null> {
    const envelope = this.envelopes().find((entry) => entry.goalId === goalId);
    if (!envelope) return null;
    const state = structuredClone(envelope.state);
    const pending = canonicalRequirementBlockers(this.compass.getState().active, goalId);
    state.blockers = [...state.blockers.filter(b => !b.startsWith("spec_sync_")), ...pending];
    if (pending.length) state.status = "BLOCKED";
    return state;
  }

  async put(state: WorkState): Promise<void> {
    this.assertAtomicAuthority();
    this.compass.updateActive(active => {
      const existing = active.filter(isEnvelope).find(entry => entry.goalId === state.goalId);
      const next: WorkStateEnvelope = {
        kind: KIND,
        version: VERSION,
        goalId: state.goalId,
        state: structuredClone(state),
        events: existing?.events ?? [],
      };
      return [...active.filter(entry => !(isEnvelope(entry) && entry.goalId === state.goalId)), next];
    }, this.assertAtomicWriteAuthority);
  }

  async appendEvent(goalId: string, event: WorkEvent): Promise<void> {
    this.assertAtomicAuthority();
    this.compass.updateActive(active => {
      const existing = active.filter(isEnvelope).find(entry => entry.goalId === goalId);
      if (!existing) return active;
      const next: WorkStateEnvelope = {
        ...existing,
        state: structuredClone(existing.state),
        events: [...existing.events, structuredClone(event)].slice(-MAX_EVENTS),
      };
      return [...active.filter(entry => !(isEnvelope(entry) && entry.goalId === goalId)), next];
    }, this.assertAtomicWriteAuthority);
  }

  private envelopes(): WorkStateEnvelope[] {
    return this.compass.getState().active.filter(isEnvelope);
  }
}
