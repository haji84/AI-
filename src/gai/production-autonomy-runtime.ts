import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CycleReport, Goal, GoalDrivenLoop } from "../orchestrator/goal-loop.ts";

export type ProductionRunState = "running" | "waiting" | "approval-required" | "blocked" | "completed";

export interface ProductionReadinessEvidence {
  multiDeviceE2E?: string[];
  iPhoneE2E?: string[];
  longDurationRun?: string[];
}

export interface ProductionReadiness {
  implementationComplete: boolean;
  realMultiDeviceE2E: boolean;
  realIPhoneE2E: boolean;
  longDurationRun: boolean;
  productionReady: boolean;
  missingEvidence: string[];
}

export interface DurableRecoveryBudget {
  fingerprint: string | null;
  consecutiveNonProgress: number;
  limit: number;
  lastProgressAt?: string;
  blockedReason?: string;
}

export interface DurableRunJournal {
  goal: string;
  definitionOfDone: string[];
  currentState: string;
  decisions: string[];
  deliverables: string[];
  nextAction: string | null;
}

export interface ProductionRunRecord {
  runId: string;
  goal: Goal;
  state: ProductionRunState;
  cycles: number;
  lastReport?: CycleReport;
  completionEvidence: unknown[];
  recoveryBudget?: DurableRecoveryBudget;
  journal?: DurableRunJournal;
  updatedAt: string;
}

interface RunFile { version: 1; runs: ProductionRunRecord[] }

export interface ProductionAutonomyHooks {
  onVerifiedCycle?(report: CycleReport): Promise<void>;
  onVerifiedCompletion?(report: CycleReport): Promise<void>;
}

export interface ProductionAutonomyOptions {
  maxConsecutiveNonProgressCycles?: number;
}

const DEFAULT_MAX_CONSECUTIVE_NON_PROGRESS_CYCLES = 9;
const MAX_JOURNAL_ENTRIES = 50;

function pushBounded(list: string[], value: string): void {
  const normalized = value.trim();
  if (!normalized) return;
  if (list[list.length - 1] === normalized) return;
  list.push(normalized);
  if (list.length > MAX_JOURNAL_ENTRIES) list.splice(0, list.length - MAX_JOURNAL_ENTRIES);
}

function normalizeJournalEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(-MAX_JOURNAL_ENTRIES);
}

function cycleCurrentState(report: CycleReport): string {
  if (report.verification) return report.verification.summary;
  if (report.result?.blocker) return report.result.blocker;
  if (report.result) return report.result.summary;
  if (report.action) return `${report.stopReason}: ${report.action.description}`;
  return report.stopReason;
}

function cycleDecision(report: CycleReport): string | null {
  if (report.stopReason === "approval_required") {
    return `Human Gate required: ${report.action?.description ?? "pending action"}`;
  }
  if (report.riskDecision?.executionBlocked) {
    return `Risk policy blocked: ${report.action?.description ?? report.nextAction ?? "action"}`;
  }
  if (report.recoveryDecision) {
    return `${report.recoveryDecision.action}: ${report.recoveryDecision.reason}`;
  }
  if (report.verification?.ok) {
    return `Verifier accepted: ${report.verification.summary}`;
  }
  return null;
}

function verifiedDeliverable(report: CycleReport): string | null {
  if (!report.verification?.ok) return null;
  const prefix = report.action?.description?.trim();
  return prefix ? `${prefix}: ${report.verification.summary}` : report.verification.summary;
}

function nonProgressFingerprint(report: CycleReport): string {
  return JSON.stringify({
    stopReason: report.stopReason,
    actionId: report.action?.id ?? null,
    nextAction: report.nextAction ?? null,
    result: report.result
      ? { ok: report.result.ok, summary: report.result.summary, blocker: report.result.blocker ?? null }
      : null,
    verification: report.verification
      ? { ok: report.verification.ok, summary: report.verification.summary }
      : null,
    recovery: report.recoveryDecision
      ? { action: report.recoveryDecision.action, reason: report.recoveryDecision.reason }
      : null,
  });
}

function assertRecoveryLimit(value: number): number {
  if (!Number.isInteger(value) || value < 2 || value > 100) {
    throw new Error("maxConsecutiveNonProgressCycles must be an integer from 2 to 100");
  }
  return value;
}

export class ProductionAutonomyRuntime {
  #runs: ProductionRunRecord[] = [];
  #loaded = false;
  private readonly filePath: string;
  private readonly loopFactory: (runId: string) => GoalDrivenLoop;
  private readonly hooks: ProductionAutonomyHooks;
  private readonly maxConsecutiveNonProgressCycles: number;

  constructor(
    filePath: string,
    loopFactory: (runId: string) => GoalDrivenLoop,
    hooks: ProductionAutonomyHooks = {},
    options: ProductionAutonomyOptions = {},
  ) {
    this.filePath = filePath;
    this.loopFactory = loopFactory;
    this.hooks = hooks;
    this.maxConsecutiveNonProgressCycles = assertRecoveryLimit(
      options.maxConsecutiveNonProgressCycles ?? DEFAULT_MAX_CONSECUTIVE_NON_PROGRESS_CYCLES,
    );
  }

  async run(input: { runId: string; goal: Goal; maxCycles?: number }): Promise<ProductionRunRecord> {
    await this.#ensureLoaded();
    const existing = this.#runs.find((item) => item.runId === input.runId);
    if (existing?.state === "completed" || existing?.state === "blocked") return existing;
    const record = existing ?? {
      runId: input.runId,
      goal: input.goal,
      state: "running" as const,
      cycles: 0,
      completionEvidence: [],
      updatedAt: new Date().toISOString(),
    };
    this.#ensureRecoveryBudget(record);
    this.#ensureJournal(record);
    this.#upsert(record);
    const loop = this.loopFactory(input.runId);
    const maxCycles = input.maxCycles ?? 25;

    while (record.cycles < maxCycles) {
      const report = await loop.runCycle({ goal: record.goal });
      record.cycles += 1;
      record.lastReport = report;
      record.updatedAt = new Date().toISOString();
      this.#recordJournal(record, report);

      if (report.verification?.ok) {
        if (report.verification.evidence !== undefined) record.completionEvidence.push(report.verification.evidence);
        this.#recordVerifiedProgress(record);
        await this.hooks.onVerifiedCycle?.(report);
      } else if (report.stopReason === "continue" && this.#recordNonProgress(record, report)) {
        record.state = "blocked";
        await this.#persistRecord(record);
        return record;
      }

      if (report.stopReason === "goal_complete") {
        if (!report.verification?.ok && report.action !== null) {
          record.state = "blocked";
        } else {
          record.state = "completed";
          if (report.verification?.ok) await this.hooks.onVerifiedCompletion?.(report);
        }
        await this.#persistRecord(record);
        return record;
      }
      if (report.stopReason === "approval_required") record.state = "approval-required";
      else if (report.stopReason === "blocked" || report.stopReason === "retry_exhausted") record.state = "blocked";
      else if (report.stopReason === "paused") record.state = "waiting";
      else record.state = "running";

      await this.#persistRecord(record);
      if (record.state !== "running") return record;
    }

    record.state = "waiting";
    await this.#persistRecord(record);
    return record;
  }

  async get(runId: string): Promise<ProductionRunRecord | undefined> {
    await this.#ensureLoaded();
    const record = this.#runs.find((item) => item.runId === runId);
    if (record) {
      this.#ensureRecoveryBudget(record);
      this.#ensureJournal(record);
    }
    return record;
  }

  readiness(evidence: ProductionReadinessEvidence = {}): ProductionReadiness {
    const realMultiDeviceE2E = (evidence.multiDeviceE2E?.length ?? 0) > 0;
    const realIPhoneE2E = (evidence.iPhoneE2E?.length ?? 0) > 0;
    const longDurationRun = (evidence.longDurationRun?.length ?? 0) > 0;
    const missingEvidence = [
      !realMultiDeviceE2E && "real multi-device E2E",
      !realIPhoneE2E && "real iPhone E2E",
      !longDurationRun && "long-duration run",
    ].filter((value): value is string => Boolean(value));
    return { implementationComplete: true, realMultiDeviceE2E, realIPhoneE2E, longDurationRun, productionReady: missingEvidence.length === 0, missingEvidence };
  }

  #ensureRecoveryBudget(record: ProductionRunRecord): DurableRecoveryBudget {
    const current = record.recoveryBudget;
    const persistedLimit = current?.limit;
    const limit = Number.isInteger(persistedLimit) && (persistedLimit as number) >= 2 && (persistedLimit as number) <= 100
      ? Math.min(persistedLimit as number, this.maxConsecutiveNonProgressCycles)
      : this.maxConsecutiveNonProgressCycles;
    const consecutiveNonProgress = Number.isInteger(current?.consecutiveNonProgress) && (current?.consecutiveNonProgress ?? -1) >= 0
      ? Math.min(current?.consecutiveNonProgress ?? 0, limit)
      : 0;
    const normalized: DurableRecoveryBudget = {
      fingerprint: typeof current?.fingerprint === "string" ? current.fingerprint : null,
      consecutiveNonProgress,
      limit,
      ...(typeof current?.lastProgressAt === "string" ? { lastProgressAt: current.lastProgressAt } : {}),
      ...(typeof current?.blockedReason === "string" ? { blockedReason: current.blockedReason } : {}),
    };
    record.recoveryBudget = normalized;
    return normalized;
  }

  #ensureJournal(record: ProductionRunRecord): DurableRunJournal {
    const current = record.journal;
    const nextAction = current?.nextAction === null || typeof current?.nextAction === "string"
      ? current.nextAction
      : record.lastReport?.nextAction ?? null;
    const normalized: DurableRunJournal = {
      goal: typeof current?.goal === "string" && current.goal.trim() ? current.goal.trim() : record.goal.title,
      definitionOfDone: Array.isArray(current?.definitionOfDone)
        ? current.definitionOfDone.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
        : [...record.goal.successCriteria],
      currentState: typeof current?.currentState === "string" && current.currentState.trim()
        ? current.currentState.trim()
        : record.lastReport ? cycleCurrentState(record.lastReport) : record.state,
      decisions: normalizeJournalEntries(current?.decisions),
      deliverables: normalizeJournalEntries(current?.deliverables),
      nextAction,
    };
    record.journal = normalized;
    return normalized;
  }

  #recordJournal(record: ProductionRunRecord, report: CycleReport): void {
    const journal = this.#ensureJournal(record);
    journal.goal = record.goal.title;
    journal.definitionOfDone = [...record.goal.successCriteria];
    journal.currentState = cycleCurrentState(report);
    journal.nextAction = report.nextAction ?? null;
    const decision = cycleDecision(report);
    if (decision) pushBounded(journal.decisions, decision);
    const deliverable = verifiedDeliverable(report);
    if (deliverable) pushBounded(journal.deliverables, deliverable);
  }

  #recordVerifiedProgress(record: ProductionRunRecord): void {
    const budget = this.#ensureRecoveryBudget(record);
    budget.fingerprint = null;
    budget.consecutiveNonProgress = 0;
    budget.lastProgressAt = new Date().toISOString();
    delete budget.blockedReason;
  }

  #recordNonProgress(record: ProductionRunRecord, report: CycleReport): boolean {
    const budget = this.#ensureRecoveryBudget(record);
    const fingerprint = nonProgressFingerprint(report);
    if (budget.fingerprint === fingerprint) budget.consecutiveNonProgress += 1;
    else {
      budget.fingerprint = fingerprint;
      budget.consecutiveNonProgress = 1;
    }
    if (budget.consecutiveNonProgress < budget.limit) return false;
    budget.blockedReason = `Durable non-progress budget exhausted (${budget.consecutiveNonProgress}/${budget.limit}); persisted outcome did not change across retries/restarts.`;
    const journal = this.#ensureJournal(record);
    journal.currentState = budget.blockedReason;
    pushBounded(journal.decisions, budget.blockedReason);
    return true;
  }

  #upsert(record: ProductionRunRecord): void {
    this.#runs = this.#runs.filter((item) => item.runId !== record.runId);
    this.#runs.push(record);
  }

  async #persistRecord(record: ProductionRunRecord): Promise<void> { this.#upsert(record); await this.#persist(); }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as RunFile;
      this.#runs = (parsed.runs ?? []).map((record) => {
        this.#ensureRecoveryBudget(record);
        this.#ensureJournal(record);
        return record;
      });
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, runs: this.#runs }, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
