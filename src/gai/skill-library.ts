import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  procedure: string;
  provenance: string[];
  applicability: string[];
  confidence: number;
  successes: number;
  failures: number;
  status: "active" | "demoted";
  updatedAt: string;
}

interface SkillFile {
  version: 1;
  skills: SkillRecord[];
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean));
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

export class PersistentSkillLibrary {
  #skills = new Map<string, SkillRecord>();
  #loaded = false;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as SkillFile;
      for (const skill of parsed.skills ?? []) this.#skills.set(skill.id, skill);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async upsert(input: Omit<SkillRecord, "updatedAt"> & { updatedAt?: string }): Promise<SkillRecord> {
    await this.#ensureLoaded();
    if (input.confidence < 0 || input.confidence > 1) throw new Error("skill confidence must be between 0 and 1");
    const skill: SkillRecord = { ...input, updatedAt: input.updatedAt ?? new Date().toISOString() };
    this.#skills.set(skill.id, skill);
    await this.#persist();
    return skill;
  }

  async get(id: string): Promise<SkillRecord | null> {
    await this.#ensureLoaded();
    return this.#skills.get(id) ?? null;
  }

  async query(task: string, limit = 5): Promise<SkillRecord[]> {
    await this.#ensureLoaded();
    return [...this.#skills.values()]
      .filter((skill) => skill.status === "active")
      .map((skill) => ({ skill, score: similarity(task, `${skill.name} ${skill.description} ${skill.applicability.join(" ")}`) + skill.confidence }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.skill);
  }

  async recordOutcome(id: string, success: boolean): Promise<SkillRecord | null> {
    await this.#ensureLoaded();
    const current = this.#skills.get(id);
    if (!current) return null;
    const successes = current.successes + (success ? 1 : 0);
    const failures = current.failures + (success ? 0 : 1);
    const total = successes + failures;
    const empirical = total === 0 ? current.confidence : successes / total;
    const confidence = Math.max(0, Math.min(1, current.confidence * 0.4 + empirical * 0.6));
    const status = total >= 3 && confidence < 0.45 ? "demoted" : current.status;
    return this.upsert({ ...current, successes, failures, confidence, status });
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.load();
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: SkillFile = { version: 1, skills: [...this.#skills.values()] };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
