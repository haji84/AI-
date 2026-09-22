import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
  #loading?: Promise<void>;
  #mutations: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) { this.filePath = filePath; }

  async load(): Promise<void> { this.#skills=await this.#readCommitted(); this.#loaded=true; }

  async #readCommitted(): Promise<Map<string,SkillRecord>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { skills?: SkillRecord[] };
      return new Map((parsed.skills ?? []).map(skill=>[skill.id,{version:1,...skill}]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return new Map();
    }
  }

  async upsert(input: Omit<SkillRecord, "updatedAt"> & { updatedAt?: string }): Promise<SkillRecord> {
    return this.#mutate(()=>this.#set(input));
  }

  async createCandidate(input: VerifiedSkillCandidate): Promise<SkillRecord | null> {
    return this.#mutate(()=>{
      if (!input.verificationPassed || !input.success || input.evidence.length === 0 || !input.procedure.trim()) return null;
      const previous = this.#skills.get(input.id);
      return this.#set({
        id: input.id, name: input.name, description: input.description, procedure: input.procedure.trim(),
        provenance: [...new Set([input.source, ...input.evidence])], applicability: [...new Set(input.applicability)],
        confidence: input.confidence, successes: 0, failures: 0, status: "candidate",
        version: (previous?.version ?? 0) + 1, parentVersion: previous?.version,
        constraints: input.constraints, certificationEvidence: [],
      });
    });
  }

  async certify(id: string, evidence: string[]): Promise<SkillRecord | null> {
    return this.#mutate(()=>{
      const current = this.#skills.get(id);
      if (!current || current.status !== "candidate" || evidence.length === 0) return null;
      return this.#set({ ...current, status: "active", certificationEvidence: [...new Set(evidence)] });
    });
  }

  async quarantine(id: string, evidence: string): Promise<SkillRecord | null> {
    return this.#mutate(()=>{
      const current = this.#skills.get(id);
      if (!current) return null;
      return this.#set({ ...current, status: "quarantined", certificationEvidence: [...new Set([...(current.certificationEvidence ?? []), evidence])] });
    });
  }

  async get(id: string): Promise<SkillRecord | null> {
    await this.#ensureLoaded(); await this.#mutations;
    const committed=await this.#readCommitted();
    return structuredClone(committed.get(id) ?? null);
  }

  async query(task: string, limit = 5, environment?: SkillEnvironment): Promise<SkillRecord[]> {
    await this.#ensureLoaded(); await this.#mutations;
    const committed=await this.#readCommitted();
    return structuredClone([...committed.values()]
      .filter((skill) => skill.status === "active" && matches(skill, environment))
      .map((skill) => ({ skill, score: similarity(task, `${skill.name} ${skill.description} ${skill.applicability.join(" ")}`) + skill.confidence }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
      .slice(0, limit).map((item) => item.skill));
  }

  async recordOutcome(id: string, success: boolean): Promise<SkillRecord | null> {
    return this.#mutate(()=>{
      const current = this.#skills.get(id);
      if (!current) return null;
      const successes = current.successes + (success ? 1 : 0), failures = current.failures + (success ? 0 : 1);
      const total = successes + failures, empirical = total === 0 ? current.confidence : successes / total;
      const confidence = Math.max(0, Math.min(1, current.confidence * 0.4 + empirical * 0.6));
      const status: SkillStatus = total >= 3 && confidence < 0.45 ? "demoted" : current.status;
      return this.#set({ ...current, successes, failures, confidence, status });
    });
  }

  #set(input: Omit<SkillRecord, "updatedAt"> & { updatedAt?: string }): SkillRecord {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error("skill confidence must be between 0 and 1");
    const skill: SkillRecord = structuredClone({ ...input, version: input.version ?? 1, updatedAt: input.updatedAt ?? new Date().toISOString() });
    this.#skills.set(skill.id, skill);
    return skill;
  }

  async #mutate<T>(operation:()=>T): Promise<T> {
    await this.#ensureLoaded();
    const write=this.#mutations.then(async()=>{
      await mkdir(dirname(this.filePath), { recursive: true });
      const lockPath=this.filePath+'.lock';
      const deadline=Date.now()+5000;
      let lock;
      while(!lock) {
        try {lock=await open(lockPath,'wx',0o600);}
        catch(error) {
          if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
          if(Date.now()>=deadline)throw Error('Skill storage busy; no action retry');
          await new Promise(resolve=>setTimeout(resolve,25));
        }
      }
      try {
        // Other Goal/teaching processes may have committed since this instance loaded.
        await this.load();
        const before=structuredClone(this.#skills);
        try {
          const result=operation();
          const payload: SkillFile = { version: 2, skills: [...this.#skills.values()] };
          await writeFile(this.filePath + ".tmp", JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
          await rename(this.filePath + ".tmp", this.filePath);
          return structuredClone(result);
        } catch(error) { this.#skills=before; throw error; }
      } finally { await lock.close(); await unlink(lockPath); }
    });
    this.#mutations=write.then(()=>undefined,()=>undefined);
    return write;
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) { this.#loading ??= this.load().catch(error=>{this.#loading=undefined;throw error;}); await this.#loading; }
  }
}
