import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ModelTier } from "./types.ts";

export interface ModelUsageRecord {
  id: string;
  taskId: string;
  requestedTier: ModelTier;
  executedTier: ModelTier;
  provider: string;
  planIncluded: boolean;
  additionalApiCost: number;
  success: boolean;
  durationMs: number;
  createdAt: string;
  fallbackReason?: string;
}

interface UsageLedgerFile {
  version: 1;
  records: ModelUsageRecord[];
}

export class PersistentUsageLedger {
  #records: ModelUsageRecord[] = [];
  #loaded = false;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as UsageLedgerFile;
      this.#records = parsed.records ?? [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async append(record: Omit<ModelUsageRecord, "createdAt"> & { createdAt?: string }): Promise<ModelUsageRecord> {
    await this.#ensureLoaded();
    if (record.additionalApiCost !== 0) throw new Error("pay-as-you-go AI API cost is prohibited by GAI policy");
    if (!record.planIncluded && record.executedTier !== "local") {
      throw new Error("frontier execution must be plan-included; paid API fallback is prohibited");
    }
    const stored: ModelUsageRecord = { ...record, createdAt: record.createdAt ?? new Date().toISOString() };
    this.#records.push(stored);
    await this.#persist();
    return stored;
  }

  async list(taskId?: string): Promise<ModelUsageRecord[]> {
    await this.#ensureLoaded();
    return this.#records.filter((record) => !taskId || record.taskId === taskId);
  }

  async summary(): Promise<{ total: number; local: number; sol: number; astra: number; additionalApiCost: number; successRate: number }> {
    await this.#ensureLoaded();
    const total = this.#records.length;
    const successes = this.#records.filter((record) => record.success).length;
    return {
      total,
      local: this.#records.filter((record) => record.executedTier === "local").length,
      sol: this.#records.filter((record) => record.executedTier === "sol").length,
      astra: this.#records.filter((record) => record.executedTier === "astra").length,
      additionalApiCost: this.#records.reduce((sum, record) => sum + record.additionalApiCost, 0),
      successRate: total === 0 ? 0 : successes / total,
    };
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.load();
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: UsageLedgerFile = { version: 1, records: this.#records };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
