import { readFile } from "node:fs/promises";

import type { ProductionRecoveryAction, ProductionRunState } from "../gai/production-autonomy-runtime.ts";

export type JarvisRecoveryDashboardState = "idle" | "recovering" | "waiting" | "blocked" | "unknown";

export interface JarvisRecoveryDashboardReport {
  generatedAt: string;
  state: JarvisRecoveryDashboardState;
  runId: string | null;
  goalTitle: string | null;
  runState: ProductionRunState | null;
  cycle: number | null;
  recoveryAction: ProductionRecoveryAction | null;
  reason: string | null;
  blocker: string | null;
  nextAction: string | null;
  observedAt: string | null;
  detail: string;
}

interface PersistedRecoveryEntry {
  cycle: number;
  observedAt: string;
  action: ProductionRecoveryAction;
  reason: string;
  blocked: boolean;
  nextAction: string | null;
}

interface PersistedRun {
  runId: string;
  goal: { title: string };
  state: ProductionRunState;
  updatedAt: string;
  recoveryHistory?: PersistedRecoveryEntry[];
  recoveryBudget?: { blockedReason?: string };
  journal?: { nextAction?: string | null };
}

const RUN_STATES = new Set<ProductionRunState>(["running", "waiting", "approval-required", "blocked", "completed"]);
const RECOVERY_ACTIONS = new Set<ProductionRecoveryAction>(["retry_same", "repair", "strategy_pivot", "blocked"]);

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecoveryEntry(value: unknown): value is PersistedRecoveryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<PersistedRecoveryEntry>;
  return Number.isInteger(entry.cycle)
    && (entry.cycle ?? 0) >= 1
    && validIso(entry.observedAt)
    && typeof entry.action === "string"
    && RECOVERY_ACTIONS.has(entry.action as ProductionRecoveryAction)
    && typeof entry.reason === "string"
    && entry.reason.trim().length > 0
    && typeof entry.blocked === "boolean"
    && (entry.nextAction === null || entry.nextAction === undefined || (typeof entry.nextAction === "string" && entry.nextAction.trim().length > 0));
}

function isRun(value: unknown): value is PersistedRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Partial<PersistedRun>;
  if (typeof run.runId !== "string" || run.runId.trim().length === 0) return false;
  if (!run.goal || typeof run.goal !== "object" || typeof run.goal.title !== "string" || run.goal.title.trim().length === 0) return false;
  if (typeof run.state !== "string" || !RUN_STATES.has(run.state as ProductionRunState)) return false;
  if (!validIso(run.updatedAt)) return false;
  if (run.recoveryHistory !== undefined && (!Array.isArray(run.recoveryHistory) || !run.recoveryHistory.every(isRecoveryEntry))) return false;
  if (run.recoveryBudget !== undefined) {
    if (!run.recoveryBudget || typeof run.recoveryBudget !== "object" || Array.isArray(run.recoveryBudget)) return false;
    if (run.recoveryBudget.blockedReason !== undefined && (typeof run.recoveryBudget.blockedReason !== "string" || run.recoveryBudget.blockedReason.trim().length === 0)) return false;
  }
  if (run.journal !== undefined) {
    if (!run.journal || typeof run.journal !== "object" || Array.isArray(run.journal)) return false;
    if (run.journal.nextAction !== undefined && run.journal.nextAction !== null && (typeof run.journal.nextAction !== "string" || run.journal.nextAction.trim().length === 0)) return false;
  }
  return true;
}

function unknown(detail: string): JarvisRecoveryDashboardReport {
  return {
    generatedAt: new Date().toISOString(),
    state: "unknown",
    runId: null,
    goalTitle: null,
    runState: null,
    cycle: null,
    recoveryAction: null,
    reason: null,
    blocker: null,
    nextAction: null,
    observedAt: null,
    detail,
  };
}

export function unavailableRecoveryDashboard(detail = "Recovery persistence is not configured or observable."): JarvisRecoveryDashboardReport {
  return unknown(detail);
}

function latestRecovery(run: PersistedRun): PersistedRecoveryEntry | null {
  return [...(run.recoveryHistory ?? [])]
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.cycle - left.cycle)[0] ?? null;
}

function reportForRun(run: PersistedRun): JarvisRecoveryDashboardReport {
  const latest = latestRecovery(run);
  const budgetBlocker = run.recoveryBudget?.blockedReason?.trim() || null;
  const recoveryBlocker = latest?.blocked || latest?.action === "blocked" ? latest.reason.trim() : null;
  const approvalBlocker = run.state === "approval-required" ? "Human Gate pending" : null;
  const blocker = budgetBlocker ?? recoveryBlocker ?? approvalBlocker;
  const state: JarvisRecoveryDashboardState = blocker || run.state === "blocked"
    ? "blocked"
    : run.state === "waiting" || run.state === "approval-required"
      ? "waiting"
      : latest
        ? "recovering"
        : "unknown";

  return {
    generatedAt: new Date().toISOString(),
    state,
    runId: run.runId,
    goalTitle: run.goal.title,
    runState: run.state,
    cycle: latest?.cycle ?? null,
    recoveryAction: latest?.action ?? null,
    reason: latest?.reason.trim() ?? null,
    blocker,
    nextAction: latest?.nextAction?.trim() || run.journal?.nextAction?.trim() || null,
    observedAt: latest?.observedAt ?? run.updatedAt,
    detail: latest
      ? "Durable recovery state was observed."
      : "An active run exists, but no recovery decision has been persisted yet.",
  };
}

export async function readJarvisRecoveryDashboard(filePath: string): Promise<JarvisRecoveryDashboardReport> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return unknown("Recovery persistence has not been observed yet.");
    throw error;
  }

  const parsed = JSON.parse(raw) as { version?: unknown; runs?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.runs) || !parsed.runs.every(isRun)) {
    throw new Error("invalid production recovery dashboard file");
  }

  const active = parsed.runs
    .filter((run) => run.state !== "completed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.runId.localeCompare(right.runId));
  if (active.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      state: "idle",
      runId: null,
      goalTitle: null,
      runState: null,
      cycle: null,
      recoveryAction: null,
      reason: null,
      blocker: null,
      nextAction: null,
      observedAt: null,
      detail: "No active recovery run is persisted.",
    };
  }

  return reportForRun(active[0]!);
}
