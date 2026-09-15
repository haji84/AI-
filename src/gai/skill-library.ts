import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SkillStatus = "candidate" | "active" | "demoted" | "quarantined";
export type SkillConnectivity = "offline-capable" | "online-required" | "either";

export interface SkillConstraints {
  capabilities?: string[];
  connectivity?: SkillConnectivity;
  executionModes?: string[];
  resources?: string[];
  maxRisk?: "low" | "medium" | "high";
}

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
  status: SkillStatus;
  updatedAt: string;
  version?: number;
  parentVersion?: number;
  constraints?: SkillConstraints;
  certificationEvidence?: string[];
}

export interface SkillEnvironment {
  capabilities?: string[];
  online?: boolean;
  executionMode?: string;
  resources?: string[];
  risk?: "low" | "medium" | "high";
}

export interface VerifiedSkillCandidate {
  id: string;
  name: string;
  description: string;
  procedure: string;
  applicability: string[];
  evidence: string[];
  verificationPassed: boolean;
  success: boolean;
  confidence: number;
  source: string;
  constraints?: SkillConstraints;
}

interface SkillFile {
  version: 2;
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

function riskRank(risk: "low" | "medium" | "high"): number {
  return { low: 0, medium: 1, high: 2 }[risk];
}

function matches(skill: SkillRecord, environment?: SkillEnvironment): boolean {
  if (!environment) return true;
  const constraints = skill.constraints;
  if (!constraints) return true;
  if (constraints.connectivity === "online-required" && environment.online === false) return false;
  if (constraints.capabilities?.some((capability) => !environment.capabilities?.includes(capability))) return false;
  if (constraints.resources?.some((resource) => !environment.resources?.includes(resource))) return false;
  if (constraints.executionModes?.length && (!environment.executionMode || !constraints.executionModes.includes(environment.executionMode))) return false;
  if (constraints.maxRisk && environment.risk && riskRank(environment.risk) > riskRank(constraints.maxRisk)) return false;
  return true;
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
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { skills?: SkillRecord[] };
      for (const skill of parsed.skills ?? []) this.#skills.set(skill.id, { version: 1, ...skill });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async upsert(input: Omit<SkillRecord, "updatedAt"> & { updatedAt?: string }): Promise<SkillRecord> {
    await this.#ensureLoaded();
    if (input.confidence < 0 || input.confidence > 1) throw new Error("skill confidence must be between 0 and 1");
    const skill: SkillRecord = { version: input.version ?? 1, ...input, updatedAt: input.updatedAt ?? new Date().toISOString() };
    this.#skills.set(skill.id, skill);
    await this.#persist();
    return skill;
  }

  async createCandidate(input: VerifiedSkillCandidate): Promise<SkillRecord | null> {
    await this.#ensureLoaded();
    if (!input.verificationPassed || !input.success || input.evidence.length === 0 || !input.procedure.trim()) return null;
    const previous = this.#skills.get(input.id);
    const nextVersion = (previous?.version ?? 0) + 1;
    return this.upsert({
      id: input.id,
      name: input.name,
      description: input.description,
      procedure: input.procedure.trim(),
      provenance: [...new Set([input.source, ...input.evidence])],
      applicability: [...new Set(input.applicability)],
      confidence: input.confidence,
      successes: 0,
      failures: 0,
      status: "candidate",
      version: nextVersion,
      parentVersion: previous?.version,
      constraints: input.constraints,
      certificationEvidence: [],
    });
  }

  async certify(id: string, evidence: string[]): Promise<SkillRecord | null> {
    await this.#ensureLoaded();
    const current = this.#skills.get(id);
    if (!current || current.status !== "candidate" || evidence.length === 0) return null;
    return this.upsert({ ...current, status: "active", certificationEvidence: [...new Set(evidence)] });
  }

  async quarantine(id: string, evidence: string): Promise<SkillRecord | null> {
    await this.#ensureLoaded();
    const current = this.#skills.get(id);
    if (!current) return null;
    return this.upsert({
      ...current,
      status: "quarantined",
      certificationEvidence: [...new Set([...(current.certificationEvidence ?? []), evidence])],
    });
  }

  async get(id: string): Promise<SkillRecord | null> {
    await this.#ensureLoaded();
    return this.#skills.get(id) ?? null;
  }

  async query(task: string, limit = 5, environment?: SkillEnvironment): Promise<SkillRecord[]> {
    await this.#ensureLoaded();
    return [...this.#skills.values()]
      .filter((skill) => skill.status === "active" && matches(skill, environment))
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
    const status: SkillStatus = total >= 3 && confidence < 0.45 ? "demoted" : current.status;
    return this.upsert({ ...current, successes, failures, confidence, status });
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.load();
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: SkillFile = { version: 2, skills: [...this.#skills.values()] };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
