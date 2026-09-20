import { createHash } from "node:crypto";
import type { CompassStore } from "../compass/store.ts";
import { compassGoalToLoopGoal } from "./compass-state-store.ts";
import type {
  ActiveGoal,
  GoalControllerDecision,
  GoalDecisionStore,
  GoalRegistry,
} from "./goal-controller-runtime.ts";
import type { SharedContextRecord, SharedContextStatus, SharedContextStore } from "./shared-context.ts";
import { goalWorkStateId } from "./work-state-integration.ts";
import type { WorkStateStore } from "./work-state.ts";

const DECISION_KIND = "gai-goal-controller-decisions";
const CONTEXT_KIND = "gai-shared-context";
const VERSION = 1;
const MAX_DECISIONS = 200;
const MAX_CONTEXT = 300;

interface DecisionRecord {
  keyDigest: string;
  decision: GoalControllerDecision;
  updatedAt: string;
}

interface DecisionEnvelope {
  kind: typeof DECISION_KIND;
  version: typeof VERSION;
  records: DecisionRecord[];
}

interface ContextEnvelope {
  kind: typeof CONTEXT_KIND;
  version: typeof VERSION;
  records: SharedContextRecord[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isDecisionEnvelope(value: unknown): value is DecisionEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === DECISION_KIND
    && record.version === VERSION
    && Array.isArray(record.records);
}

function isContextEnvelope(value: unknown): value is ContextEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === CONTEXT_KIND
    && record.version === VERSION
    && Array.isArray(record.records);
}

/**
 * Uses Compass' existing single active Goal as the Goal Controller authority.
 * It never creates a second Goal table or silently overwrites a concurrently
 * established Goal. WorkState remains authoritative in its own adapter.
 */
export class CompassGoalRegistryAdapter implements GoalRegistry {
  constructor(
    private readonly compass: CompassStore,
    private readonly workStateStore?: WorkStateStore,
  ) {}

  async listActive(): Promise<ActiveGoal[]> {
    const record = this.compass.getGoal();
    if (!record) return [];
    const goal = compassGoalToLoopGoal(record);
    const goalId = goalWorkStateId(goal);
    const workState = this.workStateStore ? await this.workStateStore.get(goalId) : null;
    return [{ goal, goalId, workState }];
  }

  async create(input: {
    title: string;
    description: string;
    successCriteria: string[];
    constraints: string[];
  }): Promise<ActiveGoal> {
    const existing = await this.listActive();
    if (existing.length > 0) return existing[0];
    const record = this.compass.setGoal({
      title: input.title,
      description: input.description,
      successCriteria: input.successCriteria,
      constraints: input.constraints,
    });
    const goal = compassGoalToLoopGoal(record);
    return { goal, goalId: goalWorkStateId(goal), workState: null };
  }
}

/**
 * Persists material-intake deduplication inside Compass state.active. Raw
 * idempotency keys are not stored. This avoids a second schema/source of truth.
 */
export class CompassGoalDecisionStoreAdapter implements GoalDecisionStore {
  constructor(private readonly compass: CompassStore) {}

  async get(idempotencyKey: string): Promise<GoalControllerDecision | null> {
    const keyDigest = digest(idempotencyKey);
    const record = this.read().records.find((entry) => entry.keyDigest === keyDigest);
    return record ? clone(record.decision) : null;
  }

  async put(idempotencyKey: string, decision: GoalControllerDecision): Promise<void> {
    const keyDigest = digest(idempotencyKey);
    const envelope = this.read();
    const next: DecisionRecord = {
      keyDigest,
      decision: clone(decision),
      updatedAt: new Date().toISOString(),
    };
    const records = [...envelope.records.filter((entry) => entry.keyDigest !== keyDigest), next]
      .slice(-MAX_DECISIONS);
    this.write({ ...envelope, records });
  }

  private read(): DecisionEnvelope {
    return this.compass.getState().active.find(isDecisionEnvelope)
      ?? { kind: DECISION_KIND, version: VERSION, records: [] };
  }

  private write(envelope: DecisionEnvelope): void {
    const active = this.compass.getState().active;
    const retained = active.filter((entry) => !isDecisionEnvelope(entry));
    this.compass.updateState({ active: [...retained, clone(envelope)] });
  }
}

/**
 * Shared Context is context-only metadata in Compass state.active. EVIDENCE
 * records here are references for resolution and never replace Compass
 * verification records, Goal state, or WorkState.
 */
export class CompassSharedContextStoreAdapter implements SharedContextStore {
  constructor(private readonly compass: CompassStore) {}

  async put(record: SharedContextRecord): Promise<void> {
    const envelope = this.read();
    const records = envelope.records.map((entry) => (
      record.supersedes && entry.id === record.supersedes
        ? { ...entry, status: "SUPERSEDED" as const }
        : entry
    ));
    const retained = records.filter((entry) => entry.id !== record.id);
    this.write({ ...envelope, records: [...retained, clone(record)].slice(-MAX_CONTEXT) });
  }

  async list(input: { goalId?: string; status?: SharedContextStatus; limit?: number } = {}): Promise<SharedContextRecord[]> {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    return this.read().records
      .filter((record) => !input.goalId || record.goalId === input.goalId)
      .filter((record) => !input.status || record.status === input.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  private read(): ContextEnvelope {
    return this.compass.getState().active.find(isContextEnvelope)
      ?? { kind: CONTEXT_KIND, version: VERSION, records: [] };
  }

  private write(envelope: ContextEnvelope): void {
    const active = this.compass.getState().active;
    const retained = active.filter((entry) => !isContextEnvelope(entry));
    this.compass.updateState({ active: [...retained, clone(envelope)] });
  }
}
