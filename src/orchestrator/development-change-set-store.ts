import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertDevelopmentChangeSet, type DevelopmentChangeSet } from "./development-change-set.ts";

interface Snapshot { version: 1; changeSets: DevelopmentChangeSet[]; savedAt: string; }

function clone<T>(value: T): T { return structuredClone(value); }

function validate(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unsupported development Change Set snapshot");
  const snapshot = value as Partial<Snapshot>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.changeSets) || !Number.isFinite(Date.parse(snapshot.savedAt ?? ""))) throw new Error("unsupported development Change Set snapshot");
  const ids = new Set<string>();
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
    const existing = this.values.get(value.changeSetId);
    if (existing && (existing.jobId !== value.jobId || existing.workItemId !== value.workItemId || existing.baseRevision !== value.baseRevision)) {
      throw new Error(`development Change Set identity conflict: ${value.changeSetId}`);
    }
    this.values.set(value.changeSetId, clone(value));
    const snapshot: Snapshot = { version: 1, changeSets: [...this.values.values()].map(clone), savedAt: now.toISOString() };
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(validate(snapshot), null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
}

