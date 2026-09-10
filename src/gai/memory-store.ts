import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LearningRecord, MemoryKind, MemoryRecord } from "./types.ts";

export interface MemoryQuery {
  kinds?: MemoryKind[];
  text?: string;
  tags?: string[];
  minConfidence?: number;
  limit?: number;
}

export interface MemoryInput {
  id: string;
  kind: MemoryKind;
  content: string;
  source?: string;
  confidence: number;
  tags?: string[];
  createdAt?: string;
}

interface MemoryFile {
  version: 1;
  records: MemoryRecord[];
}

function normalize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
}

function relevance(record: MemoryRecord, query: MemoryQuery): number {
  const q = new Set(normalize(query.text ?? ""));
  const hay = new Set(normalize(`${record.content} ${record.tags.join(" ")} ${record.source ?? ""}`));
  let overlap = 0;
  for (const token of q) if (hay.has(token)) overlap += 1;
  const tagMatches = (query.tags ?? []).filter((tag) => record.tags.includes(tag)).length;
  return record.confidence + overlap * 2 + tagMatches * 3;
}

export class PersistentMemoryStore {
  #records = new Map<string, MemoryRecord>();
  #loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as MemoryFile;
      for (const record of parsed.records ?? []) this.#records.set(record.id, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async upsert(input: MemoryInput): Promise<MemoryRecord> {
    await this.#ensureLoaded();
    if (input.confidence < 0 || input.confidence > 1) throw new Error("memory confidence must be between 0 and 1");
    const record: MemoryRecord = {
      id: input.id,
      kind: input.kind,
      content: input.content.trim(),
      source: input.source,
      confidence: input.confidence,
      tags: [...new Set(input.tags ?? [])],
      createdAt: input.createdAt ?? new Date().toISOString(),
      lastUsedAt: this.#records.get(input.id)?.lastUsedAt,
    };
    if (!record.content) throw new Error("memory content is required");
    this.#records.set(record.id, record);
    await this.#persist();
    return record;
  }

  async get(id: string): Promise<MemoryRecord | null> {
    await this.#ensureLoaded();
    return this.#records.get(id) ?? null;
  }

  async remove(id: string): Promise<boolean> {
    await this.#ensureLoaded();
    const removed = this.#records.delete(id);
    if (removed) await this.#persist();
    return removed;
  }

  async query(query: MemoryQuery = {}): Promise<MemoryRecord[]> {
    await this.#ensureLoaded();
    const minConfidence = query.minConfidence ?? 0;
    const results = [...this.#records.values()]
      .filter((record) => !query.kinds || query.kinds.includes(record.kind))
      .filter((record) => record.confidence >= minConfidence)
      .filter((record) => !query.tags?.length || query.tags.some((tag) => record.tags.includes(tag)))
      .sort((a, b) => relevance(b, query) - relevance(a, query));
    const selected = results.slice(0, query.limit ?? 20);
    const now = new Date().toISOString();
    let touched = false;
    for (const record of selected) {
      record.lastUsedAt = now;
      touched = true;
    }
    if (touched) await this.#persist();
    return selected;
  }

  async promoteLearning(record: LearningRecord, baseId: string, source = "prediction-observation"): Promise<MemoryRecord[]> {
    await this.#ensureLoaded();
    if (!record.observation.success || record.observation.evidence.length === 0 || record.prediction.confidence < 0.5) return [];
    const created: MemoryRecord[] = [];
    created.push(await this.upsert({
      id: `${baseId}:episodic`,
      kind: "episodic",
      content: `${record.prediction.action} -> ${record.observation.actualOutcome}`,
      source,
      confidence: record.prediction.confidence,
      tags: ["experience", "verified"],
    }));
    if (record.transferableRule) {
      created.push(await this.upsert({
        id: `${baseId}:semantic`,
        kind: "semantic",
        content: record.transferableRule,
        source: `${source}:${baseId}:episodic`,
        confidence: Math.min(0.95, record.prediction.confidence),
        tags: ["generalized", "verified"],
      }));
      created.push(await this.upsert({
        id: `${baseId}:procedural`,
        kind: "procedural",
        content: record.prediction.action,
        source: `${source}:${baseId}:episodic`,
        confidence: Math.min(0.9, record.prediction.confidence),
        tags: ["procedure", "verified"],
      }));
    }
    return created;
  }

  async replaceWorkingSet(records: MemoryInput[]): Promise<MemoryRecord[]> {
    await this.#ensureLoaded();
    for (const [id, record] of this.#records) if (record.kind === "working") this.#records.delete(id);
    const next: MemoryRecord[] = [];
    for (const record of records) next.push(await this.upsert({ ...record, kind: "working" }));
    await this.#persist();
    return next;
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.load();
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: MemoryFile = { version: 1, records: [...this.#records.values()] };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
