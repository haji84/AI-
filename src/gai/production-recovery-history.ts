import { readFile } from "node:fs/promises";
import type { ProductionRecoveryHistoryEntry } from "./production-autonomy-runtime.ts";

export interface ProductionRecoveryHistoryRecord extends ProductionRecoveryHistoryEntry {
  runId: string;
  goalTitle: string;
}

export interface ProductionRecoveryHistoryOptions {
  limit?: number;
}

interface PersistedRunProjection {
  runId: string;
  goal: { title: string };
  recoveryHistory?: ProductionRecoveryHistoryEntry[];
}

interface PersistedProductionRunFile {
  version: 1;
  runs: PersistedRunProjection[];
}

const DEFAULT_RECOVERY_HISTORY_LIMIT = 50;
const MAX_RECOVERY_HISTORY_LIMIT = 200;

function historyLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_RECOVERY_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOVERY_HISTORY_LIMIT) {
    throw new Error(`recovery history limit must be an integer from 1 to ${MAX_RECOVERY_HISTORY_LIMIT}`);
  }
  return limit;
}

function isRecoveryEntry(value: unknown): value is ProductionRecoveryHistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProductionRecoveryHistoryEntry>;
  return Number.isInteger(candidate.cycle)
    && (candidate.cycle ?? 0) >= 1
    && typeof candidate.observedAt === "string"
    && Number.isFinite(Date.parse(candidate.observedAt))
    && (candidate.action === "retry_same" || candidate.action === "repair" || candidate.action === "strategy_pivot" || candidate.action === "blocked")
    && typeof candidate.reason === "string"
    && candidate.reason.trim().length > 0
    && typeof candidate.blocked === "boolean"
    && Number.isInteger(candidate.nextStrategyPivot)
    && (candidate.nextStrategyPivot ?? -1) >= 0
    && (candidate.actionId === null || (typeof candidate.actionId === "string" && candidate.actionId.trim().length > 0))
    && (candidate.actionDescription === null || (typeof candidate.actionDescription === "string" && candidate.actionDescription.trim().length > 0))
    && (candidate.nextAction === null || (typeof candidate.nextAction === "string" && candidate.nextAction.trim().length > 0));
}

function isRun(value: unknown): value is PersistedRunProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PersistedRunProjection>;
  if (typeof candidate.runId !== "string" || candidate.runId.trim().length === 0) return false;
  if (!candidate.goal || typeof candidate.goal !== "object" || typeof candidate.goal.title !== "string" || candidate.goal.title.trim().length === 0) return false;
  if (candidate.recoveryHistory === undefined) return true;
  return Array.isArray(candidate.recoveryHistory) && candidate.recoveryHistory.every(isRecoveryEntry);
}

function parseRunFile(raw: string): PersistedProductionRunFile {
  const parsed = JSON.parse(raw) as { version?: unknown; runs?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.runs) || !parsed.runs.every(isRun)) {
    throw new Error("invalid production recovery history file");
  }
  return { version: 1, runs: parsed.runs };
}

export async function readProductionRecoveryHistory(
  filePath: string,
  options: ProductionRecoveryHistoryOptions = {},
): Promise<ProductionRecoveryHistoryRecord[]> {
  const limit = historyLimit(options.limit);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const { runs } = parseRunFile(raw);
  const history = runs.flatMap((run) => (run.recoveryHistory ?? []).map((entry) => ({
    runId: run.runId,
    goalTitle: run.goal.title,
    cycle: entry.cycle,
    observedAt: entry.observedAt,
    action: entry.action,
    reason: entry.reason,
    blocked: entry.blocked,
    nextStrategyPivot: entry.nextStrategyPivot,
    actionId: entry.actionId,
    actionDescription: entry.actionDescription,
    nextAction: entry.nextAction,
  })));

  return history
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt)
      || left.runId.localeCompare(right.runId)
      || right.cycle - left.cycle
      || left.action.localeCompare(right.action))
    .slice(0, limit)
    .map((entry) => ({ ...entry }));
}
