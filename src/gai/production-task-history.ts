import { readFile } from "node:fs/promises";
import type { ProductionRunRecord, ProductionRunState } from "./production-autonomy-runtime.ts";

export interface ProductionTaskHistoryOptions {
  limit?: number;
}

interface PersistedProductionRunFile {
  version: 1;
  runs: ProductionRunRecord[];
}

const DEFAULT_TASK_HISTORY_LIMIT = 50;
const MAX_TASK_HISTORY_LIMIT = 200;
const PRODUCTION_RUN_STATES = new Set<ProductionRunState>([
  "running",
  "waiting",
  "approval-required",
  "blocked",
  "completed",
]);

function assertHistoryLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_TASK_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TASK_HISTORY_LIMIT) {
    throw new Error(`task history limit must be an integer from 1 to ${MAX_TASK_HISTORY_LIMIT}`);
  }
  return limit;
}

function isProductionRunRecord(value: unknown): value is ProductionRunRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProductionRunRecord>;
  return typeof candidate.runId === "string"
    && candidate.runId.trim().length > 0
    && Boolean(candidate.goal)
    && typeof candidate.goal?.title === "string"
    && Array.isArray(candidate.goal?.successCriteria)
    && Array.isArray(candidate.goal?.constraints)
    && typeof candidate.state === "string"
    && PRODUCTION_RUN_STATES.has(candidate.state as ProductionRunState)
    && Number.isInteger(candidate.cycles)
    && (candidate.cycles ?? -1) >= 0
    && Array.isArray(candidate.completionEvidence)
    && typeof candidate.updatedAt === "string"
    && Number.isFinite(Date.parse(candidate.updatedAt));
}

function parseRunFile(raw: string): PersistedProductionRunFile {
  const parsed = JSON.parse(raw) as { version?: unknown; runs?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.runs) || !parsed.runs.every(isProductionRunRecord)) {
    throw new Error("invalid production task history file");
  }
  return { version: 1, runs: parsed.runs };
}

export async function readProductionTaskHistory(
  filePath: string,
  options: ProductionTaskHistoryOptions = {},
): Promise<ProductionRunRecord[]> {
  const limit = assertHistoryLimit(options.limit);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const { runs } = parseRunFile(raw);
  return runs
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.runId.localeCompare(right.runId))
    .slice(0, limit)
    .map((record) => JSON.parse(JSON.stringify(record)) as ProductionRunRecord);
}
