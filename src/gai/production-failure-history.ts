import { readFile } from "node:fs/promises";
import type { ProductionFailureHistoryEntry } from "./production-autonomy-runtime.ts";

export interface ProductionFailureHistoryRecord extends ProductionFailureHistoryEntry {
  runId: string;
  goalTitle: string;
}

export interface ProductionFailureHistoryOptions {
  limit?: number;
}

interface PersistedRunProjection {
  runId: string;
  goal: { title: string };
  failureHistory?: ProductionFailureHistoryEntry[];
}

interface PersistedProductionRunFile {
  version: 1;
  runs: PersistedRunProjection[];
}

const DEFAULT_FAILURE_HISTORY_LIMIT = 50;
const MAX_FAILURE_HISTORY_LIMIT = 200;

function historyLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_FAILURE_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FAILURE_HISTORY_LIMIT) {
    throw new Error(`failure history limit must be an integer from 1 to ${MAX_FAILURE_HISTORY_LIMIT}`);
  }
  return limit;
}

function isFailureEntry(value: unknown): value is ProductionFailureHistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProductionFailureHistoryEntry>;
  return Number.isInteger(candidate.cycle)
    && (candidate.cycle ?? 0) >= 1
    && typeof candidate.observedAt === "string"
    && Number.isFinite(Date.parse(candidate.observedAt))
    && (candidate.kind === "execution" || candidate.kind === "verification" || candidate.kind === "terminal")
    && typeof candidate.summary === "string"
    && candidate.summary.trim().length > 0
    && (candidate.blocker === null || (typeof candidate.blocker === "string" && candidate.blocker.trim().length > 0))
    && (candidate.actionId === null || (typeof candidate.actionId === "string" && candidate.actionId.trim().length > 0))
    && (candidate.actionDescription === null || (typeof candidate.actionDescription === "string" && candidate.actionDescription.trim().length > 0));
}

function isRun(value: unknown): value is PersistedRunProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PersistedRunProjection>;
  if (typeof candidate.runId !== "string" || candidate.runId.trim().length === 0) return false;
  if (!candidate.goal || typeof candidate.goal !== "object" || typeof candidate.goal.title !== "string" || candidate.goal.title.trim().length === 0) return false;
  if (candidate.failureHistory === undefined) return true;
  return Array.isArray(candidate.failureHistory) && candidate.failureHistory.every(isFailureEntry);
}

function parseRunFile(raw: string): PersistedProductionRunFile {
  const parsed = JSON.parse(raw) as { version?: unknown; runs?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.runs) || !parsed.runs.every(isRun)) {
    throw new Error("invalid production failure history file");
  }
  return { version: 1, runs: parsed.runs };
}

export async function readProductionFailureHistory(
  filePath: string,
  options: ProductionFailureHistoryOptions = {},
): Promise<ProductionFailureHistoryRecord[]> {
  const limit = historyLimit(options.limit);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const { runs } = parseRunFile(raw);
  const history = runs.flatMap((run) => (run.failureHistory ?? []).map((entry) => ({
    runId: run.runId,
    goalTitle: run.goal.title,
    cycle: entry.cycle,
    observedAt: entry.observedAt,
    kind: entry.kind,
    summary: entry.summary,
    blocker: entry.blocker,
    actionId: entry.actionId,
    actionDescription: entry.actionDescription,
  })));

  return history
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt)
      || left.runId.localeCompare(right.runId)
      || right.cycle - left.cycle
      || left.kind.localeCompare(right.kind))
    .slice(0, limit)
    .map((entry) => ({ ...entry }));
}
