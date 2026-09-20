import { createHash } from "node:crypto";
import type { CompassStore } from "../compass/store.ts";
import type { Goal } from "./goal-loop.ts";
import type {
  ActiveGoal,
  GoalControllerDecision,
  GoalControllerDecisionStore,
  GoalRegistry,
} from "./goal-controller-runtime.ts";

const REGISTRY_KIND = "gai-goal-controller-registry";
const DECISION_KIND = "gai-goal-controller-decisions";
const VERSION = 1;
const MAX_DECISIONS = 200;

interface RegistryEnvelope {
  kind: typeof REGISTRY_KIND;
  version: typeof VERSION;
  goals: Array<{ goalId: string; goal: Goal }>;
}

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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function keyDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function goalIdFor(input: { title: string; description: string }): string {
  return `goal-${createHash("sha256")
    .update(`${input.title.trim()}\u0000${input.description.trim()}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function isRegistryEnvelope(value: unknown): value is RegistryEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === REGISTRY_KIND
    && record.version === VERSION
    && Array.isArray(record.goals);
}

function isDecisionEnvelope(value: unknown): value is DecisionEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === DECISION_KIND
    && record.version === VERSION
    && Array.isArray(record.records);
}

/**
 * Stores Goal Controller metadata inside Compass' existing namespaced active-state
 * collection. This deliberately does not introduce a second database or schema.
 * WorkState and verification evidence remain authoritative in their own adapters.
 */
export class CompassGoalRegistry implements GoalRegistry {
  constructor(private readonly compass: CompassStore) {}

  async listActive(): Promise<ActiveGoal[]> {
    const envelope = this.readEnvelope();
    return envelope.goals.map((entry) => ({
      goalId: entry.goalId,
      goal: clone(entry.goal),
      workState: null,
    }));
  }

  async create(input: {
    title: string;
    description: string;
    successCriteria: string[];
    constraints: string[];
  }): Promise<ActiveGoal> {
    const goal: Goal = {
      title: input.title,
      description: input.description,
      successCriteria: [...input.successCriteria],
      constraints: [...input.constraints],
    };
    const goalId = goalIdFor({ title: input.title, description: input.description });
    const envelope = this.readEnvelope();
    const existing = envelope.goals.find((entry) => entry.goalId === goalId);
    if (existing) return { goalId, goal: clone(existing.goal), workState: null };

    this.writeEnvelope({
      ...envelope,
      goals: [...envelope.goals, { goalId, goal }],
    });
    return { goalId, goal: clone(goal), workState: null };
  }

  private readEnvelope(): RegistryEnvelope {
    return this.compass.getState().active.find(isRegistryEnvelope)
      ?? { kind: REGISTRY_KIND, version: VERSION, goals: [] };
  }

  private writeEnvelope(envelope: RegistryEnvelope): void {
    const active = this.compass.getState().active;
    const retained = active.filter((entry) => !isRegistryEnvelope(entry));
    this.compass.updateState({ active: [...retained, clone(envelope)] });
  }
}

/**
 * Durable idempotency for material intake. Raw idempotency keys are never stored;
 * only SHA-256 digests are persisted. Informational QUESTION/INSPECTION decisions
 * are intentionally not written by GoalControllerRuntime.
 */
export class CompassGoalControllerDecisionStore implements GoalControllerDecisionStore {
  constructor(private readonly compass: CompassStore) {}

  async get(idempotencyKey: string): Promise<GoalControllerDecision | null> {
    const digest = keyDigest(idempotencyKey);
    const record = this.readEnvelope().records.find((entry) => entry.keyDigest === digest);
    return record ? clone(record.decision) : null;
  }

  async put(idempotencyKey: string, decision: GoalControllerDecision): Promise<void> {
    const digest = keyDigest(idempotencyKey);
    const envelope = this.readEnvelope();
    const retained = envelope.records.filter((entry) => entry.keyDigest !== digest);
    const next: DecisionRecord = {
      keyDigest: digest,
      decision: clone(decision),
      updatedAt: new Date().toISOString(),
    };
    this.writeEnvelope({
      ...envelope,
      records: [...retained, next].slice(-MAX_DECISIONS),
    });
  }

  private readEnvelope(): DecisionEnvelope {
    return this.compass.getState().active.find(isDecisionEnvelope)
      ?? { kind: DECISION_KIND, version: VERSION, records: [] };
  }

  private writeEnvelope(envelope: DecisionEnvelope): void {
    const active = this.compass.getState().active;
    const retained = active.filter((entry) => !isDecisionEnvelope(entry));
    this.compass.updateState({ active: [...retained, clone(envelope)] });
  }
}
