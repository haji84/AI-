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

  constructor(compass: CompassStore) {
    this.compass = compass;
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
    const active = this.compass.getState().active;
    const next: WorkStateEnvelope = {
      kind: KIND,
      version: VERSION,
      goalId: state.goalId,
      state: structuredClone(state),
      events: this.envelopes().find((entry) => entry.goalId === state.goalId)?.events ?? [],
    };
    const retained = active.filter((entry) => !(isEnvelope(entry) && entry.goalId === state.goalId));
    this.compass.updateState({ active: [...retained, next] });
  }

  async appendEvent(goalId: string, event: WorkEvent): Promise<void> {
    const active = this.compass.getState().active;
    const existing = this.envelopes().find((entry) => entry.goalId === goalId);
    if (!existing) return;
    const next: WorkStateEnvelope = {
      ...existing,
      state: structuredClone(existing.state),
      events: [...existing.events, structuredClone(event)].slice(-MAX_EVENTS),
    };
    const retained = active.filter((entry) => !(isEnvelope(entry) && entry.goalId === goalId));
    this.compass.updateState({ active: [...retained, next] });
  }

  private envelopes(): WorkStateEnvelope[] {
    return this.compass.getState().active.filter(isEnvelope);
  }
}
