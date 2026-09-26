import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { assertDevelopmentChangeSet, type DevelopmentChangeSet } from "./development-change-set.ts";

interface Snapshot { version: 1; changeSets: DevelopmentChangeSet[]; savedAt: string; }

function clone<T>(value: T): T { return structuredClone(value); }

function migrate(value: DevelopmentChangeSet): DevelopmentChangeSet {
  const legacy = value as DevelopmentChangeSet & { candidateRevision?: string; artifactDigest?: string; artifactRef?: string };
  const candidateRevision = legacy.candidateRevision ?? createHash("sha256").update(`candidate\0${legacy.baseRevision}\0${legacy.patchDigest}`).digest("hex");
  const artifactDigest = legacy.artifactDigest ?? createHash("sha256").update(`artifact\0${legacy.patchDigest}`).digest("hex");
  return { ...legacy, candidateRevision, artifactDigest, artifactRef: legacy.artifactRef ?? `sha256:${artifactDigest}` };
}

function validate(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unsupported development Change Set snapshot");
  const snapshot = value as Partial<Snapshot>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.changeSets) || !Number.isFinite(Date.parse(snapshot.savedAt ?? ""))) throw new Error("unsupported development Change Set snapshot");
  const ids = new Set<string>();
  snapshot.changeSets = snapshot.changeSets.map((changeSet) => migrate(changeSet));
  for (const changeSet of snapshot.changeSets) {
    assertDevelopmentChangeSet(changeSet);
    if (ids.has(changeSet.changeSetId)) throw new Error(`duplicate development Change Set: ${changeSet.changeSetId}`);
    ids.add(changeSet.changeSetId);
  }
  return clone(snapshot as Snapshot);
}
export class JsonFileDevelopmentChangeSetStore {
  private readonly filePath: string;
  private loaded = false;
  private readonly values = new Map<string, DevelopmentChangeSet>();

  constructor(filePath: string) { this.filePath = filePath; }

  private async initialize(): Promise<void> {
    if (this.loaded) return;
    try {
      const snapshot = validate(JSON.parse(await readFile(this.filePath, "utf8")) as unknown);
      for (const value of snapshot.changeSets) this.values.set(value.changeSetId, clone(value));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  async get(changeSetId: string): Promise<DevelopmentChangeSet | null> {
    await this.initialize();
    const value = this.values.get(changeSetId);
    return value ? clone(value) : null;
  }

  async list(): Promise<DevelopmentChangeSet[]> {
    await this.initialize();
    return [...this.values.values()].map(clone);
  }

  async put(value: DevelopmentChangeSet, now = new Date()): Promise<void> {
    await this.initialize();
    assertDevelopmentChangeSet(value);
    await mkdir(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + 5_000;
    for (;;) {
      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(`${process.pid}\n`, "utf8");
          const latest = await (async () => { try { return validate(JSON.parse(await readFile(this.filePath, "utf8")) as unknown); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } })();
          this.values.clear();
          for (const current of latest?.changeSets ?? []) this.values.set(current.changeSetId, clone(current));
          const existing = this.values.get(value.changeSetId);
          if (existing && (existing.jobId !== value.jobId || existing.workItemId !== value.workItemId || existing.baseRevision !== value.baseRevision)) throw new Error(`development Change Set identity conflict: ${value.changeSetId}`);
          if (existing && existing.updatedAt > value.updatedAt) throw new Error(`stale development Change Set write: ${value.changeSetId}`);
          this.values.set(value.changeSetId, clone(value));
          const snapshot: Snapshot = { version: 1, changeSets: [...this.values.values()].map(clone), savedAt: now.toISOString() };
          const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
          await writeFile(temporary, `${JSON.stringify(validate(snapshot), null, 2)}\n`, "utf8");
          await rename(temporary, this.filePath);
          return;
        } finally { await handle.close(); await unlink(lockPath).catch(() => undefined); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const age = Date.now() - (await stat(lockPath)).mtimeMs;
        if (age > 30_000) { await unlink(lockPath).catch(() => undefined); continue; }
        if (Date.now() >= deadline) throw new Error(`development Change Set store lease timeout: ${this.filePath}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
}
