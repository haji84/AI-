import { createHash } from "node:crypto";
import type { IntakeIntent, IntakeSource, NormalizedIntake } from "./goal-controller-runtime.ts";

export type SharedContextType =
  | IntakeIntent
  | "DECISION"
  | "EVIDENCE"
  | "FAILURE"
  | "CORRECTION"
  | "ARTIFACT";

export type SharedContextStatus = "ACTIVE" | "SUPERSEDED" | "RESOLVED";

export interface SharedContextRecord {
  id: string;
  type: SharedContextType;
  source: IntakeSource;
  summary: string;
  facts?: string[];
  result?: unknown;
  goalId?: string;
  jobId?: string;
  attemptId?: string;
  evidenceIds?: string[];
  artifacts?: string[];
  supersedes?: string;
  status: SharedContextStatus;
  createdAt: string;
}

export interface SharedContextStore {
  put(record: SharedContextRecord): Promise<void>;
  list(input?: { goalId?: string; status?: SharedContextStatus; limit?: number }): Promise<SharedContextRecord[]>;
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 2));
}

function overlap(a: string, b: string): number {
  const left = terms(a);
  const right = terms(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const term of left) if (right.has(term)) common += 1;
  return common / Math.max(1, Math.min(left.size, right.size));
}

export function contextRecordFromIntake(
  intake: NormalizedIntake,
  intent: IntakeIntent,
  input: { summary?: string; result?: unknown; goalId?: string; jobId?: string; attemptId?: string } = {},
): SharedContextRecord {
  const seed = JSON.stringify({ key: intake.idempotencyKey, intent, summary: input.summary ?? intake.text });
  return {
    id: `ctx-${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`,
    type: intent,
    source: intake.source,
    summary: input.summary?.trim() || intake.text,
    result: input.result,
    goalId: input.goalId,
    jobId: input.jobId,
    attemptId: input.attemptId,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
  };
}

export class ContextResolver {
  private readonly store: SharedContextStore;
  constructor(store: SharedContextStore) { this.store = store; }

  async resolve(input: { intake: NormalizedIntake; goalId?: string; limit?: number }): Promise<SharedContextRecord[]> {
    const records = await this.store.list({ goalId: input.goalId, status: "ACTIVE", limit: Math.max(20, input.limit ?? 8) });
    return records
      .map((record) => ({
        record,
        score:
          (input.goalId && record.goalId === input.goalId ? 2 : 0)
          + overlap(input.intake.text, record.summary)
          + (record.type === "FAILURE" || record.type === "CORRECTION" || record.type === "EVIDENCE" ? 0.2 : 0),
      }))
      .filter(({ score }) => score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 8)
      .map(({ record }) => record);
  }
}
