import { createHash } from "node:crypto";

import type {
  ActionResult,
  ContextItem,
  ContextSource,
  Goal,
  StateStore,
  WriteBackRecord,
} from "../orchestrator/goal-loop.ts";
import { PersistentMemoryStore } from "./memory-store.ts";
import type { MemoryKind, MemoryRecord } from "./types.ts";

export interface MemoryIntegrationOptions {
  contextLimit?: number;
  minConfidence?: number;
  maxContentChars?: number;
}

export interface MemorySyncEnvelope {
  version: 1;
  generatedAt: string;
  records: MemoryRecord[];
}

interface LearningEvidence {
  transferableRule?: unknown;
  procedure?: unknown;
  memoryTags?: unknown;
  memoryConfidence?: unknown;
}

function stableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function boundedText(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
    : [];
}

function confidenceValue(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function goalQuery(goal: Goal): string {
  return [goal.title, goal.description ?? "", ...goal.successCriteria, ...goal.constraints].filter(Boolean).join(" ");
}

function evidenceObject(result: ActionResult | null | undefined): LearningEvidence {
  if (!result?.evidence || typeof result.evidence !== "object" || Array.isArray(result.evidence)) return {};
  return result.evidence as LearningEvidence;
}

function evidenceSummary(record: WriteBackRecord): string[] {
  const raw = record.verification?.evidence;
  if (Array.isArray(raw)) return stringArray(raw);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  if (raw && typeof raw === "object") return [JSON.stringify(raw)];
  const resultEvidence = record.result?.evidence;
  if (resultEvidence && typeof resultEvidence === "object") return [JSON.stringify(resultEvidence)];
  return [];
}

export class GaiMemoryContextSource implements ContextSource {
  readonly name = "gai-memory";
  private readonly store: PersistentMemoryStore;
  private readonly options: Required<MemoryIntegrationOptions>;

  constructor(store: PersistentMemoryStore, options: MemoryIntegrationOptions = {}) {
    this.store = store;
    this.options = {
      contextLimit: options.contextLimit ?? 8,
      minConfidence: options.minConfidence ?? 0.5,
      maxContentChars: options.maxContentChars ?? 1200,
    };
  }

  async collect(input: { goal: Goal }): Promise<ContextItem[]> {
    const query = goalQuery(input.goal);
    const workingId = `working:goal:${stableId(query)}`;
    await this.store.upsert({
      id: workingId,
      kind: "working",
      content: boundedText(`Goal: ${input.goal.title}. ${input.goal.description ?? ""} DoD: ${input.goal.successCriteria.join("; ")}`, this.options.maxContentChars),
      source: "goal-loop",
      confidence: 1,
      tags: ["goal", "working"],
    });

    const records = await this.store.query({
      text: query,
      kinds: ["working", "episodic", "semantic", "procedural"],
      minConfidence: this.options.minConfidence,
      limit: this.options.contextLimit,
    });

    if (records.length === 0) return [];
    return [{
      source: this.name,
      summary: `Retrieved ${records.length} bounded memory records for current Goal/DoD`,
      data: {
        records: records.map((record) => ({
          id: record.id,
          kind: record.kind,
          content: boundedText(record.content, this.options.maxContentChars),
          source: record.source,
          confidence: record.confidence,
          tags: record.tags,
          createdAt: record.createdAt,
          lastUsedAt: record.lastUsedAt,
        })),
      },
    }];
  }
}

export class MemoryLearningStateStore implements StateStore {
  private readonly inner: StateStore;
  private readonly memory: PersistentMemoryStore;
  private readonly maxContentChars: number;

  constructor(inner: StateStore, memory: PersistentMemoryStore, options: Pick<MemoryIntegrationOptions, "maxContentChars"> = {}) {
    this.inner = inner;
    this.memory = memory;
    this.maxContentChars = options.maxContentChars ?? 1600;
  }

  getState() {
    return this.inner.getState();
  }

  async writeBack(record: WriteBackRecord): Promise<void> {
    await this.inner.writeBack(record);
    if (!record.action || !record.result || !record.verification) return;
    if (!record.verification.ok) return;

    const verifiedEvidence = evidenceSummary(record);
    if (verifiedEvidence.length === 0) return;

    const success = record.result.ok;
    const base = `memory:${stableId(`${record.goal.title}|${record.action.id}|${record.result.summary}|${record.verification.summary}`)}`;
    const learned = evidenceObject(record.result);
    const explicitTags = stringArray(learned.memoryTags);
    const confidence = confidenceValue(learned.memoryConfidence, success ? 0.85 : 0.7);

    await this.memory.upsert({
      id: `${base}:episodic`,
      kind: "episodic",
      content: boundedText(`${record.action.description} -> ${record.result.summary}`, this.maxContentChars),
      source: `goal-loop:${record.action.id}`,
      confidence,
      tags: ["verified", success ? "success" : "failure", ...explicitTags],
    });

    if (!success) return;

    const transferableRule = stringValue(learned.transferableRule);
    if (transferableRule) {
      await this.memory.upsert({
        id: `${base}:semantic`,
        kind: "semantic",
        content: boundedText(transferableRule, this.maxContentChars),
        source: `${base}:episodic`,
        confidence: Math.min(0.95, confidence),
        tags: ["verified", "generalized", ...explicitTags],
      });
    }

    const procedure = stringValue(learned.procedure);
    if (procedure) {
      await this.memory.upsert({
        id: `${base}:procedural`,
        kind: "procedural",
        content: boundedText(procedure, this.maxContentChars),
        source: `${base}:episodic`,
        confidence: Math.min(0.9, confidence),
        tags: ["verified", "procedure", ...explicitTags],
      });
    }
  }
}

export async function exportMemorySyncEnvelope(
  store: PersistentMemoryStore,
  input: { text?: string; kinds?: MemoryKind[]; minConfidence?: number; limit?: number } = {},
): Promise<MemorySyncEnvelope> {
  const records = await store.query({
    text: input.text,
    kinds: input.kinds ?? ["working", "episodic", "semantic", "procedural"],
    minConfidence: input.minConfidence ?? 0,
    limit: input.limit ?? 500,
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    records: records.map((record) => ({ ...record, tags: [...record.tags] })),
  };
}
