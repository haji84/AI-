import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ResearchEvidence } from "./research-ops-program.ts";

interface LedgerFile {
  schemaVersion: 1;
  updatedAt: string;
  evidence: ResearchEvidence[];
}

export class ResearchEvidenceLedger {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<ResearchEvidence[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as LedgerFile;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.evidence)) throw new Error("unsupported evidence ledger schema");
      return parsed.evidence;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async merge(incoming: readonly ResearchEvidence[]): Promise<ResearchEvidence[]> {
    const existing = await this.load();
    const byId = new Map(existing.map((item) => [item.id, item]));
    for (const item of incoming) {
      const previous = byId.get(item.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(item)) {
        throw new Error(`evidence id collision with different payload: ${item.id}`);
      }
      byId.set(item.id, item);
    }
    const merged = [...byId.values()].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt) || a.id.localeCompare(b.id));
    await this.save(merged);
    return merged;
  }

  async replaceAll(evidence: readonly ResearchEvidence[]): Promise<void> {
    const ids = new Set<string>();
    for (const item of evidence) {
      if (ids.has(item.id)) throw new Error(`duplicate evidence id: ${item.id}`);
      ids.add(item.id);
    }
    await this.save([...evidence]);
  }

  private async save(evidence: ResearchEvidence[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload: LedgerFile = { schemaVersion: 1, updatedAt: new Date().toISOString(), evidence };
    await writeFile(temporary, JSON.stringify(payload, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }
}
