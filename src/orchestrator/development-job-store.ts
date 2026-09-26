import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertDevelopmentJob, type DevelopmentJob } from "./development-job.ts";

export interface DevelopmentJobSnapshot {
  version: 1;
  jobs: DevelopmentJob[];
  savedAt: string;
}
export interface DevelopmentJobStore {
  get(jobId: string): Promise<DevelopmentJob | null>;
  getByGoal(goalId: string): Promise<DevelopmentJob[]>;
  list(): Promise<DevelopmentJob[]>;
  put(job: DevelopmentJob, now?: Date): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateSnapshot(value: unknown): DevelopmentJobSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unsupported development job snapshot");
  const snapshot = value as Partial<DevelopmentJobSnapshot>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.jobs)) throw new Error("unsupported development job snapshot");
  const ids = new Set<string>();
  for (const job of snapshot.jobs) {
    assertDevelopmentJob(job);
    if (ids.has(job.jobId)) throw new Error(`duplicate development job: ${job.jobId}`);
    ids.add(job.jobId);
  }
  if (typeof snapshot.savedAt !== "string" || !Number.isFinite(Date.parse(snapshot.savedAt))) {
    throw new Error("unsupported development job snapshot timestamp");
  }
  return clone(snapshot as DevelopmentJobSnapshot);
}

abstract class BaseDevelopmentJobStore implements DevelopmentJobStore {
  protected jobs = new Map<string, DevelopmentJob>();
  protected loaded = false;

  protected abstract loadSnapshot(): Promise<DevelopmentJobSnapshot | null>;
  protected abstract saveSnapshot(snapshot: DevelopmentJobSnapshot): Promise<void>;
  protected async withWriteLease<T>(operation: () => Promise<T>): Promise<T> { return operation(); }

  protected async initialize(): Promise<void> {
    if (this.loaded) return;
    const snapshot = await this.loadSnapshot();
    this.jobs.clear();
    for (const job of snapshot?.jobs ?? []) this.jobs.set(job.jobId, clone(job));
    this.loaded = true;
  }

  async get(jobId: string): Promise<DevelopmentJob | null> {
    await this.initialize();
    const job = this.jobs.get(jobId);
    return job ? clone(job) : null;
  }

  async getByGoal(goalId: string): Promise<DevelopmentJob[]> {
    await this.initialize();
    return [...this.jobs.values()].filter((job) => job.goalId === goalId).map(clone);
  }

  async list(): Promise<DevelopmentJob[]> {
    await this.initialize();
    return [...this.jobs.values()].map(clone);
  }

  async put(job: DevelopmentJob, now = new Date()): Promise<void> {
    await this.initialize();
    assertDevelopmentJob(job);
    await this.withWriteLease(async () => {
      const latest = await this.loadSnapshot();
      this.jobs.clear();
      for (const current of latest?.jobs ?? []) this.jobs.set(current.jobId, clone(current));
      const existing = this.jobs.get(job.jobId);
      if (existing && existing.goalId !== job.goalId) throw new Error(`development job identity conflict: ${job.jobId}`);
      if (existing && existing.updatedAt > job.updatedAt) throw new Error(`stale development job write: ${job.jobId}`);
      this.jobs.set(job.jobId, clone(job));
      await this.saveSnapshot({
        version: 1,
        jobs: [...this.jobs.values()].map(clone),
        savedAt: now.toISOString(),
      });
    });
  }
}

export class MemoryDevelopmentJobStore extends BaseDevelopmentJobStore {
  private snapshot: DevelopmentJobSnapshot | null = null;

  protected async loadSnapshot(): Promise<DevelopmentJobSnapshot | null> {
    return this.snapshot ? validateSnapshot(this.snapshot) : null;
  }

  protected async saveSnapshot(snapshot: DevelopmentJobSnapshot): Promise<void> {
    this.snapshot = validateSnapshot(snapshot);
  }
}

export class JsonFileDevelopmentJobStore extends BaseDevelopmentJobStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  protected async withWriteLease<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + 5_000;
    for (;;) {
      try {
        const handle = await open(lockPath, "wx");
        try { await handle.writeFile(`${process.pid}\n`, "utf8"); return await operation(); }
        finally { await handle.close(); await unlink(lockPath).catch(() => undefined); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const age = Date.now() - (await stat(lockPath)).mtimeMs;
        if (age > 30_000) { await unlink(lockPath).catch(() => undefined); continue; }
        if (Date.now() >= deadline) throw new Error(`development job store lease timeout: ${this.filePath}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  protected async loadSnapshot(): Promise<DevelopmentJobSnapshot | null> {
    try {
      return validateSnapshot(JSON.parse(await readFile(this.filePath, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  protected async saveSnapshot(snapshot: DevelopmentJobSnapshot): Promise<void> {
    const value = validateSnapshot(snapshot);
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
}
