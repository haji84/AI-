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

export interface ProductionRunRecord {
  runId: string;
  goal: Goal;
  state: ProductionRunState;
  cycles: number;
  lastReport?: CycleReport;
  completionEvidence: unknown[];
  updatedAt: string;
}

interface RunFile { version: 1; runs: ProductionRunRecord[] }

export interface ProductionAutonomyHooks {
  onVerifiedCycle?(report: CycleReport): Promise<void>;
  onVerifiedCompletion?(report: CycleReport): Promise<void>;
}

export class ProductionAutonomyRuntime {
  #runs: ProductionRunRecord[] = [];
  #loaded = false;
  private readonly filePath: string;
  private readonly loopFactory: (runId: string) => GoalDrivenLoop;
  private readonly hooks: ProductionAutonomyHooks;

  constructor(filePath: string, loopFactory: (runId: string) => GoalDrivenLoop, hooks: ProductionAutonomyHooks = {}) {
    this.filePath = filePath;
    this.loopFactory = loopFactory;
    this.hooks = hooks;
  }

  async run(input: { runId: string; goal: Goal; maxCycles?: number }): Promise<ProductionRunRecord> {
    await this.#ensureLoaded();
    const existing = this.#runs.find((item) => item.runId === input.runId);
    if (existing?.state === "completed") return existing;
    const record = existing ?? { runId: input.runId, goal: input.goal, state: "running" as const, cycles: 0, completionEvidence: [], updatedAt: new Date().toISOString() };
    this.#upsert(record);
    const loop = this.loopFactory(input.runId);
    const maxCycles = input.maxCycles ?? 25;

    while (record.cycles < maxCycles) {
      const report = await loop.runCycle({ goal: record.goal });
      record.cycles += 1;
      record.lastReport = report;
      record.updatedAt = new Date().toISOString();

      if (report.verification?.ok) {
        if (report.verification.evidence !== undefined) record.completionEvidence.push(report.verification.evidence);
        await this.hooks.onVerifiedCycle?.(report);
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
    return this.#runs.find((item) => item.runId === runId);
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

  #upsert(record: ProductionRunRecord): void {
    this.#runs = this.#runs.filter((item) => item.runId !== record.runId);
    this.#runs.push(record);
  }

  async #persistRecord(record: ProductionRunRecord): Promise<void> { this.#upsert(record); await this.#persist(); }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    try { const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as RunFile; this.#runs = parsed.runs ?? []; }
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
