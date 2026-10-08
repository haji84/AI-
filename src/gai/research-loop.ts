import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BenchmarkOutcomeRecord } from "./benchmark-history.ts";

export type Bottleneck = "memory" | "planner" | "world-model" | "skill" | "tooling" | "model-reasoning";

export interface FailureSignal {
  taskId: string;
  actionId: string;
  bottleneck: Bottleneck;
  severity: number;
  evidence: string[];
}

export interface ResearchHypothesis {
  id: string;
  bottleneck: Bottleneck;
  statement: string;
  expectedGain: number;
  evidenceCount: number;
  status: "proposed" | "testing" | "accepted" | "rejected";
}

export interface ResearchExperiment {
  id: string;
  hypothesisId: string;
  benchmarkBefore: number;
  benchmarkAfter: number;
  /** Fractions in [0, 1], preserving the existing intervention-rate contract. */
  humanInterventionBefore: number;
  humanInterventionAfter: number;
  additionalApiCost: number;
  safetyRegression: boolean;
  /** Absent in legacy records, whose decision threshold was 0.01. */
  minimumGain?: number;
  createdAt: string;
  decision: "accepted" | "rejected";
  reason: string;
}

interface ResearchFile {
  version: 1;
  hypotheses: ResearchHypothesis[];
  experiments: ResearchExperiment[];
}

const DEFAULT_MINIMUM_GAIN = 0.01;
const MAX_RECORDS = 10_000;
const MAX_BYTES = 16 * 1024 * 1024;
const bottlenecks: Bottleneck[] = ["memory", "planner", "world-model", "skill", "tooling", "model-reasoning"];
const experimentKeys = ["id", "hypothesisId", "benchmarkBefore", "benchmarkAfter", "humanInterventionBefore", "humanInterventionAfter", "additionalApiCost", "safetyRegression", "minimumGain", "createdAt", "decision", "reason"];
function shape(value: unknown, allowed: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !allowed.includes(key))) throw Error(`Invalid research ${label} schema`);
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(value)) throw Error("Invalid research ID");
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw Error(`Invalid research ${label}`);
  return value;
}
function fraction(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw Error(`Invalid research ${label}`);
  return value;
}
function threshold(value: unknown): number {
  const result = fraction(value, "minimum gain");
  if (result <= 0) throw Error("Invalid research minimum gain");
  return result;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw Error("Invalid research timestamp");
  return value;
}
function normalizeHypothesis(value: unknown): ResearchHypothesis {
  shape(value, ["id", "bottleneck", "statement", "expectedGain", "evidenceCount", "status"], "hypothesis");
  if (!bottlenecks.includes(value.bottleneck as Bottleneck) || !["proposed", "testing", "accepted", "rejected"].includes(value.status as string)) throw Error("Invalid research hypothesis state");
  if (!Number.isSafeInteger(value.evidenceCount) || (value.evidenceCount as number) < 0) throw Error("Invalid research evidence count");
  return { id: identifier(value.id), bottleneck: value.bottleneck as Bottleneck, statement: text(value.statement, "statement"), expectedGain: fraction(value.expectedGain, "expected gain"), evidenceCount: value.evidenceCount as number, status: value.status as ResearchHypothesis["status"] };
}
function experimentInput(value: unknown) {
  shape(value, experimentKeys, "experiment");
  if (typeof value.additionalApiCost !== "number" || !Number.isFinite(value.additionalApiCost) || value.additionalApiCost < 0 || value.additionalApiCost > Number.MAX_SAFE_INTEGER) throw Error("Invalid research additional cost");
  if (typeof value.safetyRegression !== "boolean") throw Error("Invalid research safety regression");
  if (value.minimumGain !== undefined) threshold(value.minimumGain);
  // Rescoring an existing record is supported, but its previous verdict is never authority.
  if (value.createdAt !== undefined) timestamp(value.createdAt);
  if (value.reason !== undefined) text(value.reason, "reason");
  if (value.decision !== undefined && !["accepted", "rejected"].includes(value.decision as string)) throw Error("Invalid research decision");
  return { id: identifier(value.id), hypothesisId: identifier(value.hypothesisId), benchmarkBefore: fraction(value.benchmarkBefore, "benchmark before"), benchmarkAfter: fraction(value.benchmarkAfter, "benchmark after"), humanInterventionBefore: fraction(value.humanInterventionBefore, "intervention before rate"), humanInterventionAfter: fraction(value.humanInterventionAfter, "intervention after rate"), additionalApiCost: value.additionalApiCost, safetyRegression: value.safetyRegression };
}
function policyDecision(input: ReturnType<typeof experimentInput>, minimumGain: number): Pick<ResearchExperiment, "decision" | "reason"> {
  const gain = input.benchmarkAfter - input.benchmarkBefore;
  if (input.additionalApiCost !== 0) return { decision: "rejected", reason: "Rejected because additional pay-as-you-go AI API cost was non-zero." };
  if (input.safetyRegression) return { decision: "rejected", reason: "Rejected because the candidate regressed safety." };
  if (input.humanInterventionAfter > input.humanInterventionBefore) return { decision: "rejected", reason: "Rejected because human-intervention rate regressed." };
  if (gain < minimumGain) return { decision: "rejected", reason: `Rejected because held-out gain ${gain.toFixed(4)} is below ${minimumGain.toFixed(4)}.` };
  return { decision: "accepted", reason: `Held-out benchmark improved by ${gain.toFixed(4)} without safety, cost, or intervention regression.` };
}
function normalizeExperiment(value: unknown): ResearchExperiment {
  const fields = experimentInput(value);
  const raw = value as Record<string, unknown>;
  const minimumGain = raw.minimumGain === undefined ? DEFAULT_MINIMUM_GAIN : threshold(raw.minimumGain);
  const computed = policyDecision(fields, minimumGain);
  if (raw.decision !== computed.decision || raw.reason !== computed.reason) throw Error("Research decision/reason policy mismatch");
  return { ...fields, ...(raw.minimumGain === undefined ? {} : { minimumGain }), createdAt: timestamp(raw.createdAt), ...computed };
}
function normalizeFile(value: unknown): ResearchFile {
  shape(value, ["version", "hypotheses", "experiments"], "history");
  if (value.version !== 1 || !Array.isArray(value.hypotheses) || !Array.isArray(value.experiments) || value.hypotheses.length > MAX_RECORDS || value.experiments.length > MAX_RECORDS) throw Error("Invalid research history bounds/version");
  const hypotheses = value.hypotheses.map(normalizeHypothesis), experiments = value.experiments.map(normalizeExperiment);
  if (new Set(hypotheses.map(h => h.id)).size !== hypotheses.length || new Set(experiments.map(e => e.id)).size !== experiments.length) throw Error("Duplicate research record ID");
  const ids = new Set(hypotheses.map(h => h.id));
  if (experiments.some(e => !ids.has(e.hypothesisId))) throw Error("Research experiment hypothesis is missing");
  for (const h of hypotheses) {
    const latest = experiments.findLast(e => e.hypothesisId === h.id);
    if ((latest && h.status !== latest.decision) || (!latest && ["accepted", "rejected"].includes(h.status))) throw Error("Research hypothesis/experiment status mismatch");
  }
  return { version: 1, hypotheses, experiments };
}
function terminal(hypothesis: ResearchHypothesis): boolean { return hypothesis.status === "accepted" || hypothesis.status === "rejected"; }

function inferBottleneck(record: BenchmarkOutcomeRecord): Bottleneck {
  const text = `${record.taskId} ${record.actionId}`.toLowerCase();
  if (text.includes("memory") || text.includes("retrieve")) return "memory";
  if (text.includes("plan") || text.includes("route")) return "planner";
  if (text.includes("world") || text.includes("predict")) return "world-model";
  if (text.includes("skill")) return "skill";
  if (text.includes("tool") || text.includes("capability")) return "tooling";
  return "model-reasoning";
}

export function clusterFailures(records: BenchmarkOutcomeRecord[]): FailureSignal[] {
  return records
    .filter((record) => !record.passed)
    .map((record) => ({
      taskId: record.taskId,
      actionId: record.actionId,
      bottleneck: inferBottleneck(record),
      severity: Math.min(1, 0.5 + record.humanInterventionCount * 0.1),
      evidence: [`failed attempt ${record.attempt}`, `durationMs=${record.durationMs}`],
    }));
}

export function proposeResearchHypotheses(signals: FailureSignal[]): ResearchHypothesis[] {
  const grouped = new Map<Bottleneck, FailureSignal[]>();
  for (const signal of signals) {
    const list = grouped.get(signal.bottleneck) ?? [];
    list.push(signal);
    grouped.set(signal.bottleneck, list);
  }
  return [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([bottleneck, items]) => ({
      id: `hypothesis:${bottleneck}`,
      bottleneck,
      statement: `Improve ${bottleneck} behavior to reduce recurring verified task failures.`,
      expectedGain: Math.min(0.25, 0.02 * items.length),
      evidenceCount: items.length,
      status: "proposed" as const,
    }));
}

/** Numeric policy decision only. A runner must independently establish measured evidence and held-out provenance. */
export function decideExperiment(input: Omit<ResearchExperiment, "createdAt" | "decision" | "reason">, minimumGain?: number): ResearchExperiment {
  const fields = experimentInput(input);
  const requiredGain = threshold(minimumGain === undefined ? input.minimumGain ?? DEFAULT_MINIMUM_GAIN : minimumGain);
  return { ...fields, minimumGain: requiredGain, createdAt: new Date().toISOString(), ...policyDecision(fields, requiredGain) };
}

/** Host callers coordinate writes with their existing partition lease. Records do not grant execution authority. */
export class PersistentResearchHistory {
  #hypotheses = new Map<string, ResearchHypothesis>();
  #experiments: ResearchExperiment[] = [];
  #loaded = false;
  private readonly filePath: string;
  constructor(filePath: string) { this.filePath = filePath; }
  async load(): Promise<void> {
    this.#loaded = false;
    let parsed: ResearchFile = { version: 1, hypotheses: [], experiments: [] };
    try {
      const raw = await readFile(this.filePath, "utf8");
      if (Buffer.byteLength(raw) > MAX_BYTES) throw Error("Invalid research history size");
      parsed = normalizeFile(JSON.parse(raw));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.#hypotheses = new Map(parsed.hypotheses.map(h => [h.id, h]));
    this.#experiments = parsed.experiments;
    this.#loaded = true;
  }
  async saveHypothesis(hypothesis: ResearchHypothesis): Promise<void> {
    const incoming = normalizeHypothesis(hypothesis);
    await this.#ensureLoaded();
    const existing = this.#hypotheses.get(incoming.id);
    if (existing && (existing.bottleneck !== incoming.bottleneck || existing.statement !== incoming.statement)) throw Error("Research hypothesis identity conflict");
    if (existing && terminal(existing)) {
      if (terminal(incoming) && incoming.status !== existing.status) throw Error("Research terminal hypothesis conflict");
      return;
    }
    if (terminal(incoming)) throw Error("Terminal research hypothesis requires a recorded experiment");
    const hypotheses = new Map(this.#hypotheses);
    hypotheses.set(incoming.id, existing?.status === "testing" ? { ...incoming, status: "testing" } : incoming);
    await this.#commit({ version: 1, hypotheses: [...hypotheses.values()], experiments: this.#experiments });
  }
  async recordExperiment(experiment: ResearchExperiment): Promise<void> {
    const incoming = normalizeExperiment(experiment);
    await this.#ensureLoaded();
    const hypothesis = this.#hypotheses.get(incoming.hypothesisId);
    if (!hypothesis) throw Error("Research experiment requires an existing hypothesis");
    const existing = this.#experiments.find(e => e.id === incoming.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(incoming)) throw Error("Research experiment replay conflict");
      return;
    }
    const hypotheses = new Map(this.#hypotheses); hypotheses.set(hypothesis.id, { ...hypothesis, status: incoming.decision });
    await this.#commit({ version: 1, hypotheses: [...hypotheses.values()], experiments: [...this.#experiments, incoming] });
  }
  async listExperiments(): Promise<ResearchExperiment[]> { await this.#ensureLoaded(); return structuredClone(this.#experiments); }
  async listHypotheses(): Promise<ResearchHypothesis[]> { await this.#ensureLoaded(); return structuredClone([...this.#hypotheses.values()]); }
  async #ensureLoaded(): Promise<void> { if (!this.#loaded) await this.load(); }
  async #commit(value: ResearchFile): Promise<void> {
    const checked = normalizeFile(value);
    const payload = `${JSON.stringify(checked, null, 2)}\n`;
    if (Buffer.byteLength(payload) > MAX_BYTES) throw Error("Invalid research history size");
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temp, this.filePath);
      this.#hypotheses = new Map(checked.hypotheses.map(h => [h.id, h]));
      this.#experiments = checked.experiments;
    } finally { await unlink(temp).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }
}
