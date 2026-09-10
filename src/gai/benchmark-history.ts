import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { summarizeBenchmark, type BenchmarkCaseResult, type BenchmarkSummary } from "./benchmark.ts";

export type BenchmarkSplit = "train" | "heldout";

export interface BenchmarkOutcomeRecord extends BenchmarkCaseResult {
  taskId: string;
  attempt: number;
  split: BenchmarkSplit;
  verified: true;
  actionId: string;
  selectedSkillId?: string;
  createdAt: string;
}

interface BenchmarkHistoryFile {
  version: 1;
  records: BenchmarkOutcomeRecord[];
}

export interface AttemptImprovement {
  taskId: string;
  firstAttemptPassed: boolean | null;
  latestAttemptPassed: boolean | null;
  improved: boolean;
  firstDurationMs: number | null;
  latestDurationMs: number | null;
}

export class PersistentBenchmarkHistory {
  #records: BenchmarkOutcomeRecord[] = [];
  #loaded = false;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as BenchmarkHistoryFile;
      this.#records = parsed.records ?? [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async record(input: Omit<BenchmarkOutcomeRecord, "createdAt"> & { createdAt?: string }): Promise<BenchmarkOutcomeRecord> {
    await this.#ensureLoaded();
    if (input.attempt < 1 || !Number.isInteger(input.attempt)) throw new Error("benchmark attempt must be a positive integer");
    const record: BenchmarkOutcomeRecord = {
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.#records = this.#records.filter((item) => !(item.taskId === record.taskId && item.attempt === record.attempt && item.split === record.split));
    this.#records.push(record);
    await this.#persist();
    return record;
  }

  async list(split?: BenchmarkSplit): Promise<BenchmarkOutcomeRecord[]> {
    await this.#ensureLoaded();
    return this.#records
      .filter((record) => !split || record.split === split)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async summary(split?: BenchmarkSplit): Promise<BenchmarkSummary> {
    const records = await this.list(split);
    return summarizeBenchmark(records);
  }

  async attemptImprovement(taskId: string, split: BenchmarkSplit = "train"): Promise<AttemptImprovement> {
    await this.#ensureLoaded();
    const records = this.#records
      .filter((record) => record.taskId === taskId && record.split === split)
      .sort((a, b) => a.attempt - b.attempt);
    const first = records[0];
    const latest = records.at(-1);
    return {
      taskId,
      firstAttemptPassed: first?.passed ?? null,
      latestAttemptPassed: latest?.passed ?? null,
      improved: Boolean(first && latest && latest.attempt > first.attempt && !first.passed && latest.passed),
      firstDurationMs: first?.durationMs ?? null,
      latestDurationMs: latest?.durationMs ?? null,
    };
  }

  async secondAttemptImprovementRate(split: BenchmarkSplit = "train"): Promise<number | null> {
    await this.#ensureLoaded();
    const byTask = new Map<string, BenchmarkOutcomeRecord[]>();
    for (const record of this.#records.filter((item) => item.split === split)) {
      const list = byTask.get(record.taskId) ?? [];
      list.push(record);
      byTask.set(record.taskId, list);
    }
    let eligible = 0;
    let improved = 0;
    for (const records of byTask.values()) {
      const first = records.find((record) => record.attempt === 1);
      const second = records.find((record) => record.attempt === 2);
      if (!first || !second || first.passed) continue;
      eligible += 1;
      if (second.passed) improved += 1;
    }
    return eligible ? improved / eligible : null;
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.load();
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: BenchmarkHistoryFile = { version: 1, records: this.#records };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
