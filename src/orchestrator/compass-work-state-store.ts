import { canonicalRequirementBlockers } from "./owner-requirement-canonical.ts";
import type { CompassStore } from "../compass/store.ts";
import type { WorkEvent, WorkState, WorkStateStore } from "./work-state.ts";
import { assessCompletionPath, type CompletionInput, type CompletionCycle } from "./completion-path.ts";

const KIND = "gai-work-state";
const VERSION = 1;
const MAX_EVENTS = 100;

interface WorkStateEnvelope {
  kind: typeof KIND;
  version: typeof VERSION;
  goalId: string;
  state: WorkState;
  events: WorkEvent[];
  completionAdvisory?: CompletionCycle[];
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
    this.compass.updateActive(active => {
      const existing = active.find(entry => isEnvelope(entry) && entry.goalId === state.goalId) as WorkStateEnvelope | undefined;
      const next: WorkStateEnvelope = {
        kind: KIND, version: VERSION, goalId: state.goalId, state: structuredClone(state),
        events: existing?.events ?? [], completionAdvisory: existing?.completionAdvisory,
      };
      return [...active.filter(entry => !(isEnvelope(entry) && entry.goalId === state.goalId)), next];
    });
  }

  async appendEvent(goalId: string, event: WorkEvent): Promise<void> {
    this.compass.updateActive(active => active.map(entry => isEnvelope(entry) && entry.goalId === goalId
      ? { ...entry, events: [...entry.events, structuredClone(event)].slice(-MAX_EVENTS) } : entry));
  }

  private envelopes(): WorkStateEnvelope[] {
    return this.compass.getState().active.filter(isEnvelope);
  }

  async getCompletionHistory(goalId: string): Promise<CompletionCycle[]> {
    return structuredClone(this.envelopes().find(entry => entry.goalId === goalId)?.completionAdvisory ?? []);
  }

  /** Transactional journal-only write; no authoritative WorkState fields change. */
  async recordCompletionAssessment(input: CompletionInput): Promise<CompletionCycle> {
    let result: CompletionCycle | undefined;
    this.compass.updateActive(active => {
      const index = active.findIndex(entry => isEnvelope(entry) && entry.goalId === input.goalId);
      if (index < 0) throw Error("completion assessment requires existing WorkState");
      const envelope = active[index] as WorkStateEnvelope;
      const history = envelope.completionAdvisory ?? [];
      const state = structuredClone(envelope.state);
      const pending = canonicalRequirementBlockers(active, input.goalId);
      state.blockers = [...state.blockers.filter(b => !b.startsWith("spec_sync_")), ...pending];
      if (pending.length) state.status = "BLOCKED";
      result = assessCompletionPath(state, input, history);
      if (!history.some(cycle => cycle.cycleId === input.cycleId)) {
        active[index] = { ...envelope, completionAdvisory: [...history, result] };
      }
      return active;
    });
    return structuredClone(result!);
  }
}
