import { createHash } from "node:crypto";
import type { CompassStore } from "../compass/store.ts";
import type { IntakeSource } from "./goal-controller-runtime.ts";

export type SharedContextKind =
  | "QUESTION"
  | "INSPECTION"
  | "COMMAND"
  | "DEVELOPMENT_TASK"
  | "GOAL"
  | "DECISION"
  | "EVIDENCE"
  | "FAILURE"
  | "CORRECTION"
  | "ARTIFACT";

export type SharedContextStatus = "ACTIVE" | "SUPERSEDED" | "RETRACTED";

export interface SharedContextRecord {
  id: string;
  kind: SharedContextKind;
  source: IntakeSource;
  text: string;
  goalId?: string;
  jobId?: string;
  attemptId?: string;
  supersedesId?: string;
  status: SharedContextStatus;
  createdAt: string;
  metadata: Record<string, unknown>;
  authority: "CONTEXT_ONLY";
}

export interface SharedContextInput {
  id?: string;
  kind: SharedContextKind;
  source: IntakeSource;
  text: string;
  goalId?: string;
  jobId?: string;
  attemptId?: string;
  supersedesId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface SharedContextStore {
  put(input: SharedContextInput): Promise<SharedContextRecord>;
  list(): Promise<SharedContextRecord[]>;
}

const KIND = "gai-shared-context";
const VERSION = 1;
const MAX_RECORDS = 300;

interface SharedContextEnvelope {
  kind: typeof KIND;
  version: typeof VERSION;
  records: SharedContextRecord[];
}

function isEnvelope(value: unknown): value is SharedContextEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.kind === KIND && record.version === VERSION && Array.isArray(record.records);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function normalizedTerms(value: string): Set<string> {
  const lower = value.toLowerCase().normalize("NFKC");
  const terms = new Set(lower.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 2));
  const cjk = [...lower.replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, "")];
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    terms.add(`${cjk[index]}${cjk[index + 1]}`);
  }
  return terms;
}

function relevance(query: string, candidate: string): number {
  const left = normalizedTerms(query);
  const right = normalizedTerms(candidate);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const term of left) if (right.has(term)) common += 1;
  return common / Math.min(left.size, right.size);
}

/**
 * Shared Context is a context-only projection. Even an EVIDENCE record here is
 * merely a reference/snapshot for later resolution; canonical verifier evidence,
 * Goal state, and WorkState are never written through this store.
 */
export class CompassSharedContextStore implements SharedContextStore {
  constructor(private readonly compass: CompassStore) {}

  async list(): Promise<SharedContextRecord[]> {
    return structuredClone(this.readEnvelope().records);
  }

  async put(input: SharedContextInput): Promise<SharedContextRecord> {
    const text = input.text.trim();
    if (!text) throw new Error("shared context text must not be empty");
    const createdAt = input.createdAt ?? new Date().toISOString();
    const id = input.id?.trim()
      || `context-${digest(JSON.stringify({ kind: input.kind, source: input.source, text, createdAt }))}`;
    const envelope = this.readEnvelope();
    const nextRecords = envelope.records.map((record) => (
      input.supersedesId && record.id === input.supersedesId
        ? { ...record, status: "SUPERSEDED" as const }
        : record
    ));
    const record: SharedContextRecord = {
      id,
      kind: input.kind,
      source: input.source,
      text,
      ...(input.goalId?.trim() ? { goalId: input.goalId.trim() } : {}),
      ...(input.jobId?.trim() ? { jobId: input.jobId.trim() } : {}),
      ...(input.attemptId?.trim() ? { attemptId: input.attemptId.trim() } : {}),
      ...(input.supersedesId?.trim() ? { supersedesId: input.supersedesId.trim() } : {}),
      status: "ACTIVE",
      createdAt,
      metadata: structuredClone(input.metadata ?? {}),
      authority: "CONTEXT_ONLY",
    };
    const retained = nextRecords.filter((entry) => entry.id !== id);
    this.writeEnvelope({
      ...envelope,
      records: [...retained, record].slice(-MAX_RECORDS),
    });
    return structuredClone(record);
  }

  private readEnvelope(): SharedContextEnvelope {
    return this.compass.getState().active.find(isEnvelope)
      ?? { kind: KIND, version: VERSION, records: [] };
  }

  private writeEnvelope(envelope: SharedContextEnvelope): void {
    const active = this.compass.getState().active;
    const retained = active.filter((entry) => !isEnvelope(entry));
    this.compass.updateState({ active: [...retained, structuredClone(envelope)] });
  }
}

export interface ContextResolutionRequest {
  text: string;
  goalId?: string;
  kinds?: SharedContextKind[];
  limit?: number;
  minimumRelevance?: number;
}

export class SharedContextResolver {
  constructor(private readonly store: SharedContextStore) {}

  async resolve(input: ContextResolutionRequest): Promise<SharedContextRecord[]> {
    const text = input.text.trim();
    if (!text) return [];
    const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
    const minimumRelevance = input.minimumRelevance ?? 0.2;
    const allowedKinds = input.kinds ? new Set(input.kinds) : null;
    const records = await this.store.list();

    return records
      .filter((record) => record.status === "ACTIVE")
      .filter((record) => !allowedKinds || allowedKinds.has(record.kind))
      .map((record) => ({
        record,
        goalMatch: Boolean(input.goalId && record.goalId === input.goalId),
        score: relevance(text, record.text),
      }))
      .filter((entry) => entry.goalMatch || entry.score >= minimumRelevance)
      .sort((left, right) => Number(right.goalMatch) - Number(left.goalMatch)
        || right.score - left.score
        || right.record.createdAt.localeCompare(left.record.createdAt))
      .slice(0, limit)
      .map((entry) => structuredClone(entry.record));
  }
}
