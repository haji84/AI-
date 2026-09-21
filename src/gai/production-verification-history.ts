import { readFile } from "node:fs/promises";
import type { ProductionVerificationHistoryEntry } from "./production-autonomy-runtime.ts";

export interface ProductionVerificationHistoryRecord extends ProductionVerificationHistoryEntry {
  runId: string;
  goalTitle: string;
}

export interface ProductionVerificationHistoryOptions {
  limit?: number;
}

interface PersistedRunProjection {
  runId: string;
  goal: { title: string };
  verificationHistory?: ProductionVerificationHistoryEntry[];
}

interface PersistedProductionRunFile {
  version: 1;
  runs: PersistedRunProjection[];
}

const DEFAULT_VERIFICATION_HISTORY_LIMIT = 50;
const MAX_VERIFICATION_HISTORY_LIMIT = 200;

function historyLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_VERIFICATION_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_VERIFICATION_HISTORY_LIMIT) {
    throw new Error(`verification history limit must be an integer from 1 to ${MAX_VERIFICATION_HISTORY_LIMIT}`);
  }
  return limit;
}

function isHistoryEntry(value: unknown): value is ProductionVerificationHistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProductionVerificationHistoryEntry>;
  return Number.isInteger(candidate.cycle)
    && (candidate.cycle ?? 0) >= 1
    && typeof candidate.observedAt === "string"
    && Number.isFinite(Date.parse(candidate.observedAt))
    && typeof candidate.ok === "boolean"
    && typeof candidate.summary === "string"
    && candidate.summary.trim().length > 0
    && (candidate.actionId === null || (typeof candidate.actionId === "string" && candidate.actionId.trim().length > 0))
    && (candidate.actionDescription === null || (typeof candidate.actionDescription === "string" && candidate.actionDescription.trim().length > 0));
}

function isRun(value: unknown): value is PersistedRunProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PersistedRunProjection>;
  if (typeof candidate.runId !== "string" || candidate.runId.trim().length === 0) return false;
  if (!candidate.goal || typeof candidate.goal !== "object" || typeof candidate.goal.title !== "string" || candidate.goal.title.trim().length === 0) return false;
  if (candidate.verificationHistory === undefined) return true;
  return Array.isArray(candidate.verificationHistory) && candidate.verificationHistory.every(isHistoryEntry);
}

function parseRunFile(raw: string): PersistedProductionRunFile {
  const parsed = JSON.parse(raw) as { version?: unknown; runs?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.runs) || !parsed.runs.every(isRun)) {
    throw new Error("invalid production verification history file");
  }
  return { version: 1, runs: parsed.runs };
}

export async function readProductionVerificationHistory(
  filePath: string,
  options: ProductionVerificationHistoryOptions = {},
): Promise<ProductionVerificationHistoryRecord[]> {
  const limit = historyLimit(options.limit);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const { runs } = parseRunFile(raw);
  const history = runs.flatMap((run) => (run.verificationHistory ?? []).map((entry) => ({
    runId: run.runId,
    goalTitle: run.goal.title,
    cycle: entry.cycle,
    observedAt: entry.observedAt,
    ok: entry.ok,
    summary: entry.summary,
    actionId: entry.actionId,
    actionDescription: entry.actionDescription,
  })));

  return history
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt)
      || left.runId.localeCompare(right.runId)
      || right.cycle - left.cycle)
    .slice(0, limit)
    .map((entry) => ({ ...entry }));
}
