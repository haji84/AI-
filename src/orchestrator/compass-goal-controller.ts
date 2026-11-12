import { createHash } from "node:crypto";
import type { CompassStore } from "../compass/store.ts";
import { compassGoalToLoopGoal } from "./compass-state-store.ts";
import { assertIntakeReplayMatches } from "./goal-controller-runtime.ts";
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

function decisionForPersistence(decision: GoalControllerDecision, keyDigest: string): GoalControllerDecision {
  const persisted = clone(decision);
  persisted.resolution.intake.idempotencyKey = `sha256:${keyDigest}`;
  return persisted;
}

function isDecisionEnvelope(value: unknown): value is DecisionEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === DECISION_KIND
    && record.version === VERSION
    && Array.isArray(record.records);
}

function recordDecision(active: unknown[], decision: GoalControllerDecision): {
  active: unknown[]; decision: GoalControllerDecision;
} {
  const keyDigest = digest(decision.resolution.intake.idempotencyKey);
  const envelope = active.find(isDecisionEnvelope)
    ?? { kind: DECISION_KIND, version: VERSION, records: [] };
  const existing = envelope.records.find(entry => entry.keyDigest === keyDigest);
  if (existing) {
    assertIntakeReplayMatches(existing.decision, decision.resolution.intake);
    if (existing.decision.goalId !== decision.goalId) throw new Error("INTAKE_IDEMPOTENCY_CONFLICT");
    return { active, decision: clone(existing.decision) };
  }
  const next: DecisionRecord = {
    keyDigest, decision: decisionForPersistence(decision, keyDigest), updatedAt: new Date().toISOString(),
  };
  const records = [...envelope.records, next].slice(-MAX_DECISIONS);
  return { active: [...active.filter(entry => !isDecisionEnvelope(entry)), { ...envelope, records }], decision };
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
  private readonly compass: CompassStore;
  private readonly workStateStore?: WorkStateStore;

  constructor(compass: CompassStore, workStateStore?: WorkStateStore) {
    this.compass = compass;
    this.workStateStore = workStateStore;
  }

  usesCompass(compass: CompassStore): boolean { return this.compass === compass; }

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
    const record = this.compass.createGoalIfAbsent({
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
  private readonly compass: CompassStore;

  constructor(compass: CompassStore) {
    this.compass = compass;
  }

  async get(idempotencyKey: string): Promise<GoalControllerDecision | null> {
    const keyDigest = digest(idempotencyKey);
    const record = this.read().records.find((entry) => entry.keyDigest === keyDigest);
    return record ? clone(record.decision) : null;
  }

  async put(idempotencyKey: string, decision: GoalControllerDecision): Promise<void> {
    this.compass.updateActive(active => recordDecision(active, {
      ...decision, resolution: { ...decision.resolution,
        intake: { ...decision.resolution.intake, idempotencyKey } },
    }).active);
  }

  async createGoalAndPut(
    registry: GoalRegistry,
    input: Parameters<GoalRegistry["create"]>[0],
    decisionForGoal: (goal: ActiveGoal) => GoalControllerDecision,
  ): Promise<GoalControllerDecision> {
    if (!(registry instanceof CompassGoalRegistryAdapter) || !registry.usesCompass(this.compass)) {
      throw new Error("atomic intake requires the same Compass Goal authority");
    }
    let committed: GoalControllerDecision | undefined;
    this.compass.createGoalIfAbsent(input, (record, active) => {
      const goal = compassGoalToLoopGoal(record);
      const next = recordDecision(active, decisionForGoal({ goal, goalId: goalWorkStateId(goal), workState: null }));
      committed = next.decision;
      return next.active;
    });
    if (!committed) throw new Error("Goal intake decision was not committed");
    return committed;
  }

  private read(): DecisionEnvelope {
    return this.compass.getState().active.find(isDecisionEnvelope)
      ?? { kind: DECISION_KIND, version: VERSION, records: [] };
  }

}

/**
 * Shared Context is context-only metadata in Compass state.active. EVIDENCE
 * records here are references for resolution and never replace Compass
 * verification records, Goal state, or WorkState.
 */
export class CompassSharedContextStoreAdapter implements SharedContextStore {
  private readonly compass: CompassStore;

  constructor(compass: CompassStore) {
    this.compass = compass;
  }

  async put(record: SharedContextRecord): Promise<void> {
    this.compass.updateActive(active => {
      const envelope = active.find(isContextEnvelope)
        ?? { kind: CONTEXT_KIND, version: VERSION, records: [] };
      const records = envelope.records.map((entry) => (
        record.supersedes && entry.id === record.supersedes
          ? { ...entry, status: "SUPERSEDED" as const }
          : entry
      ));
      const retained = records.filter((entry) => entry.id !== record.id);
      return [...active.filter((entry) => !isContextEnvelope(entry)),
        { ...envelope, records: [...retained, clone(record)].slice(-MAX_CONTEXT) }];
    });
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

}
