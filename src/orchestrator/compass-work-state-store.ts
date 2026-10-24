import { canonicalRequirementBlockers } from "./owner-requirement-canonical.ts";
import type { CompassStore } from "../compass/store.ts";
import type { WorkEvent, WorkState, WorkStateStore } from "./work-state.ts";
import { deriveWorkStatus } from "./work-state.ts";
import { randomUUID } from "node:crypto";
import { assessCompletionPath, completionDigest, type CompletionInput, type CompletionCycle } from "./completion-path.ts";
import type { CompletionExecutionCheckpoint } from "./completion-execution.ts";

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
  completionInput?: CompletionInput;
  completionExecution?: CompletionExecutionCheckpoint;
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

function currentState(envelope: WorkStateEnvelope, active: unknown[]): WorkState {
  const state = structuredClone(envelope.state);
  const pending = canonicalRequirementBlockers(active, state.goalId);
  state.blockers = [...state.blockers.filter(b => !b.startsWith('spec_sync_')), ...pending];
  if (pending.length) state.status = 'BLOCKED';
  return state;
}

function observedState(state: WorkState, cycle: CompletionCycle, input: CompletionInput): WorkState {
  const updated = { ...state, verificationResults: state.definitionOfDone.map(c => ({ itemId: c.id, passed: cycle.verifiedCriteria.includes(c.id), evidence: input.evidence.filter(e => e.criterionId === c.id) })) };
  updated.status = deriveWorkStatus(updated);
  return updated;
}

function validateCheckpoint(next: CompletionExecutionCheckpoint): void {
  if (!/^[a-f0-9]{64}$/.test(next.contractDigest) || next.completedTasks.length > 256 || next.evidence.length > 1024) throw Error('invalid completion checkpoint');
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
        ...existing,
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

  async getCompletionExecution(goalId: string): Promise<CompletionExecutionCheckpoint | null> {
    return structuredClone(this.envelopes().find(entry => entry.goalId === goalId)?.completionExecution ?? null);
  }

  async updateCompletionExecution(goalId: string, expected: CompletionExecutionCheckpoint | null, next: CompletionExecutionCheckpoint, expectedStateDigest?: string): Promise<void> {
    validateCheckpoint(next);
    this.compass.updateActive(active => {
      const index = active.findIndex(entry => isEnvelope(entry) && entry.goalId === goalId);
      if (index < 0) throw Error('completion requires existing WorkState');
      const envelope = active[index] as WorkStateEnvelope;
      if (expectedStateDigest && completionDigest(currentState(envelope, active)) !== expectedStateDigest) throw Error('completion state conflict');
      if (completionDigest(envelope.completionExecution ?? null) !== completionDigest(expected)) throw Error('completion checkpoint conflict');
      active[index] = { ...envelope, completionExecution: structuredClone(next) };
      return active;
    });
  }

  async finalizeCompletionOutcome(input: CompletionInput, expectedStateDigest: string, expected: CompletionExecutionCheckpoint, next: CompletionExecutionCheckpoint): Promise<CompletionCycle> {
    validateCheckpoint(next);
    let result: CompletionCycle | undefined;
    this.compass.updateActive(active => {
      const index = active.findIndex(entry => isEnvelope(entry) && entry.goalId === input.goalId);
      if (index < 0) throw Error('completion requires existing WorkState');
      const envelope = active[index] as WorkStateEnvelope;
      const state = currentState(envelope, active);
      if (completionDigest(state) !== expectedStateDigest) throw Error('completion state conflict');
      if (!expected.pending || next.pending || next.contractDigest !== expected.contractDigest || completionDigest(envelope.completionExecution ?? null) !== completionDigest(expected)) throw Error('completion checkpoint conflict');
      const history = envelope.completionAdvisory ?? [];
      result = assessCompletionPath(state, input, history);
      active[index] = { ...envelope, state: observedState(state, result, input), completionInput: structuredClone(input), completionAdvisory: [...history, result], completionExecution: structuredClone(next) };
      return active;
    });
    return structuredClone(result!);
  }

  async synchronizeCompletionCriteria(goalId: string, cycleId: string, expectedStateDigest: string): Promise<void> {
    this.compass.updateActive(active => {
      const index = active.findIndex(entry => isEnvelope(entry) && entry.goalId === goalId);
      if (index < 0) throw Error('completion requires existing WorkState');
      const envelope = active[index] as WorkStateEnvelope;
      const state = currentState(envelope, active);
      const latest = envelope.completionAdvisory?.at(-1);
      if (completionDigest(state) !== expectedStateDigest || latest?.cycleId !== cycleId || !envelope.completionInput || envelope.completionExecution?.pending) throw Error('completion state conflict');
      active[index] = { ...envelope, state: observedState(state, latest, envelope.completionInput) };
      return active;
    });
  }

  /** Existing owner route may acknowledge displayed IDs; this never grants approval. */
  async acknowledgeCompletionNotifications(goalId: string, request: { cycleId: string; notificationIds: string[] }, at = new Date().toISOString()): Promise<CompletionCycle> {
    if (!request || Object.keys(request).sort().join(',') !== 'cycleId,notificationIds' || typeof request.cycleId !== 'string' || !Array.isArray(request.notificationIds) || request.notificationIds.length < 1 || request.notificationIds.length > 64 || request.notificationIds.some(id => typeof id !== 'string') || new Set(request.notificationIds).size !== request.notificationIds.length) throw Error('invalid notification receipt request');
    let result: CompletionCycle | undefined;
    this.compass.updateActive(active => {
      const index = active.findIndex(entry => isEnvelope(entry) && entry.goalId === goalId);
      if (index < 0) throw Error('notification state unavailable');
      const envelope = active[index] as WorkStateEnvelope;
      const history = envelope.completionAdvisory ?? [];
      const seen = history.find(c => c.cycleId === request.cycleId);
      const latest = history.at(-1);
      if (!seen || !latest || !envelope.completionInput || request.notificationIds.some(id => !seen.notifications.some(n => n.id === id) || !latest.notifications.some(n => n.id === id))) throw Error('unknown notification or assessment');
      const ids = request.notificationIds.filter(id => !latest.notifications.find(n => n.id === id)!.delivery);
      if (!ids.length) { result = latest; return active; }
      const priorInput = structuredClone(envelope.completionInput);
      delete priorInput.attempt;
      const input: CompletionInput = { ...priorInput, cycleId: randomUUID(), at, responses: [], deliveries: ids.map(notificationId => ({ notificationId, at, receiptRef: `owner-display:${request.cycleId}:${notificationId}` })) };
      const state = structuredClone(envelope.state);
      const pending = canonicalRequirementBlockers(active, goalId);
      state.blockers = [...state.blockers.filter(b => !b.startsWith('spec_sync_')), ...pending];
      if (pending.length) state.status = 'BLOCKED';
      result = assessCompletionPath(state, input, history);
      active[index] = { ...envelope, completionInput: input, completionAdvisory: [...history, result] };
      return active;
    });
    return structuredClone(result!);
  }

  /** Transactional journal-only write; no authoritative WorkState fields change. */
  async recordCompletionAssessment(input: CompletionInput): Promise<CompletionCycle> {
    return this.recordAssessment(input, false);
  }

  /** Opted-in execution must revoke stale PASS before attempting any repair. */
  async recordExecutionAssessment(input: CompletionInput): Promise<CompletionCycle> {
    return this.recordAssessment(input, true);
  }

  private async recordAssessment(input: CompletionInput, invalidate: boolean): Promise<CompletionCycle> {
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
      if (invalidate) {
        state.verificationResults = state.verificationResults.map(v => (v.passed || v.waived) && !result!.verifiedCriteria.includes(v.itemId) ? { ...v, passed: false, waived: false, evidence: input.evidence.filter(e => e.criterionId === v.itemId) } : v);
        state.status = deriveWorkStatus(state);
        result = assessCompletionPath(state, input, history);
      }
      if (!history.some(cycle => cycle.cycleId === input.cycleId)) {
        active[index] = { ...envelope, ...(invalidate ? { state } : {}), completionInput: structuredClone(input), completionAdvisory: [...history, result] };
      }
      return active;
    });
    return structuredClone(result!);
  }
}
