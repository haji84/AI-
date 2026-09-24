import { evaluateCognitiveResearch, researchSummary, sameResearchMeasurement } from "./cognitive-research.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireCognitiveLease } from "./cognitive-lease.ts";
import { validateCognitiveOperation, type CognitiveOperation } from "./cognitive-operation.ts";
import { PersistentMemoryStore } from "./memory-store.ts";
import { PersistentWorldModel } from "./world-model.ts";
import { PersistentSkillLibrary } from "./skill-library.ts";
import { PersistentBenchmarkHistory } from "./benchmark-history.ts";
import { ClosedLearningLoop } from "./closed-learning-loop.ts";
import { VerifiedWorkLearningEngine } from "./work-learning.ts";
import { ContinualLearningRuntime } from "./continual-learning-runtime.ts";
import { SelfImprovementRuntime, type ImprovementAdapters, type ImprovementCandidate } from "./self-improvement-runtime.ts";
import { clusterFailures, proposeResearchHypotheses, PersistentResearchHistory, decideExperiment } from "./research-loop.ts";

export interface CognitiveLearningPartition { tenantId: string; principalId: string }
export type CognitiveLearningSource = "deterministic" | "skill" | "memory" | "local-model" | "local-experiment" | "external-expert" | "degraded";
export interface CognitiveLearningExperience {
  id: string; partition: CognitiveLearningPartition; goalId: string; task: string; actionId: string; strategyId: string; environment: string;
  learningOperation?: CognitiveOperation;
  prediction: { expectedOutcome: string; confidence: number }; observation: { summary: string; success: boolean };
  verified: boolean; evidenceRefs: string[]; source: CognitiveLearningSource; durationMs: number; externalCalls: number;
  split?: "train" | "heldout"; goalCompleted?: boolean; unknownTask?: boolean; humanInterventions?: number; rollbackCount?: number;
  transferTask?: boolean; offline?: boolean; memoryAblation?: { pairId: string; condition: "with-memory" | "without-memory" };
  completionEvidenceRefs?: string[];
}
export interface CognitiveCorrection {
  id: string; partition: CognitiveLearningPartition; goalId: string; task: string; environment: string;
  originalActionId: string; replacementActionId: string; evidenceRefs: string[]; verified: boolean; scope: "preference" | "general";
}
export interface CognitiveSkillCandidate {
  operation?: CognitiveOperation;
  id: string; synthesisKey: string; status: "candidate" | "active" | "quarantined"; sourceExperiences: string[]; evidenceRefs: string[];
  purpose: string; applicability: string[]; prerequisites: string[]; inputSchema: { type: "object"; required: string[] };
  executionProcedure: string; expectedOutput: string; validation: string[]; commonFailures: string[]; recovery: string[];
  confidence: number; successCount: number; failureCount: number; version: number;
}
interface LearningFile { version: 1; experiences: CognitiveLearningExperience[]; corrections: CognitiveCorrection[]; candidates: CognitiveSkillCandidate[] }
const SOURCE = new Set<CognitiveLearningSource>(["deterministic", "skill", "memory", "local-model", "local-experiment", "external-expert", "degraded"]);
const pending = new Map<string, Promise<unknown>>();
const MAX_ITEMS = 2_000;
const MAX_BYTES = 8 * 1024 * 1024;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

/** Fail closed before model output, history or user corrections become durable learning. */
export function cognitiveLearningText(value: unknown, field: string, limit = 2_048): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw Error(`Invalid bounded ${field}`);
  const text = value.trim();
  if (/(?:password|passwd|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization|cookie|credential)\s*[:=]\s*\S+|\bbearer\s+[\w.~+/-]{8,}|\bsk-[\w-]{8,}|-----BEGIN[^-]*PRIVATE KEY|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/i.test(text)) throw Error(`${field} contains private credential material`);
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\b(?:\d{3}[- ]?){2}\d{4}\b/.test(text)) throw Error(`${field} contains protected personal data`);
  return text;
}
function refs(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > 64) throw Error("Invalid evidence references");
  return [...new Set(values.map((v) => cognitiveLearningText(v, "evidence reference", 256)))];
}
function normalizedTask(task: string): string { return task.trim().toLowerCase().replace(/\s+/g, " "); }
function relevant(left: string, right: string): boolean {
  if (normalizedTask(left) === normalizedTask(right)) return true;
  const a = new Set(normalizedTask(left).split(/[^\p{L}\p{N}_-]+/u).filter(Boolean));
  const b = new Set(normalizedTask(right).split(/[^\p{L}\p{N}_-]+/u).filter(Boolean));
  return a.size > 0 && b.size > 0 && [...a].filter((token) => b.has(token)).length / Math.max(a.size, b.size) >= 0.5;
}
function boundedNumber(value: number, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value) || value < 0 || value > max) throw Error(`Invalid ${field}`);
  return value;
}
function ratio(numerator: number, denominator: number): number | null { return denominator ? numerator / denominator : null; }
/** Learning stores a symbolic host binding, never an executable learned procedure. */
type CatalogBinding = { environment: string } & (
  { catalogActionId: string; catalogOperation?: never } | { catalogOperation: CognitiveOperation; catalogActionId?: never }
);
function catalogBinding(procedure: string): CatalogBinding | null {
  try {
    const value: unknown = JSON.parse(procedure);
    shape(value, ["catalogActionId", "catalogOperation", "environment"], "catalog skill binding");
    const environment = cognitiveLearningText(value.environment, "catalog environment");
    if (Object.hasOwn(value, "catalogOperation")) {
      shape(value, ["catalogOperation", "environment"], "catalog operation binding");
      return { catalogOperation: validateCognitiveOperation(value.catalogOperation), environment };
    }
    return { catalogActionId: cognitiveLearningText(value.catalogActionId, "catalog action", 200), environment };
  } catch { return null; }
}
function bindingMatches(binding: CatalogBinding, experience: CognitiveLearningExperience): boolean {
  return binding.catalogOperation !== undefined ? experience.learningOperation === binding.catalogOperation :
    experience.learningOperation === undefined && experience.actionId === binding.catalogActionId;
}
function sameLearningStrategy(left: CognitiveLearningExperience, right: CognitiveLearningExperience): boolean {
  return right.learningOperation !== undefined ? left.learningOperation === right.learningOperation :
    left.learningOperation === undefined && left.actionId === right.actionId && left.strategyId === right.strategyId;
}
function shape(value: unknown, allowed: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw Error(`Invalid ${label} fields`);
}
function validateCorrection(input: CognitiveCorrection): CognitiveCorrection {
  shape(input, ["id", "partition", "goalId", "task", "environment", "originalActionId", "replacementActionId", "evidenceRefs", "verified", "scope"], "correction");
  if (input.verified !== true || !["preference", "general"].includes(input.scope)) throw Error("Correction requires explicit independently verified corrected outcome");
  const copy = structuredClone(input);
  for (const field of ["id", "goalId", "task", "environment", "originalActionId", "replacementActionId"] as const) copy[field] = cognitiveLearningText(input[field], field);
  copy.evidenceRefs = refs(input.evidenceRefs);
  if (!copy.evidenceRefs.length || copy.originalActionId === copy.replacementActionId) throw Error("Correction requires distinct actions and verified evidence");
  return copy;
}

export class CognitiveLearningEngine {
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; }

  partitionPath(partition: CognitiveLearningPartition, file: "experience.json" | "memory.json" | "world.json" | "skills.json" | "benchmarks.json" | "continual.json" | "research.json" | "improvement.json"): string {
    shape(partition, ["tenantId", "principalId"], "partition");
    for (const value of [partition?.tenantId, partition?.principalId]) if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(value)) throw Error("Invalid cognitive learning partition");
    return join(this.directory, hash(partition), file);
  }

  private async serial<T>(partition: CognitiveLearningPartition, run: () => Promise<T>): Promise<T> {
    const key = this.partitionPath(partition, "experience.json");
    const previous = pending.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await mkdir(join(key, ".."), { recursive: true });
      const release = await acquireCognitiveLease(key + ".lock", 2000);
      try { return await run(); } finally { await release(); }
    });
    pending.set(key, current);
    try { return await current; } finally { if (pending.get(key) === current) pending.delete(key); }
  }

  private async load(partition: CognitiveLearningPartition): Promise<LearningFile> {
    try {
      const raw = await readFile(this.partitionPath(partition, "experience.json"), "utf8");
      if (Buffer.byteLength(raw) > MAX_BYTES) throw Error("Cognitive learning storage bound exceeded");
      const value = JSON.parse(raw) as LearningFile;
      shape(value, ["version", "experiences", "corrections", "candidates"], "learning storage");
      if (value.version !== 1 || !Array.isArray(value.experiences) || !Array.isArray(value.corrections) || !Array.isArray(value.candidates) || value.experiences.length > MAX_ITEMS || value.corrections.length > MAX_ITEMS || value.candidates.length > MAX_ITEMS) throw Error("Invalid cognitive learning storage");
      for (const e of value.experiences) { this.validateExperience(e); if (hash(e.partition) !== hash(partition)) throw Error("Cognitive learning partition mismatch"); }
      for (const c of value.corrections) { validateCorrection(c); this.partitionPath(c.partition, "experience.json"); if (hash(c.partition) !== hash(partition)) throw Error("Cognitive correction partition mismatch"); }
      for (const c of value.candidates) {
        shape(c, ["operation", "id", "synthesisKey", "status", "sourceExperiences", "evidenceRefs", "purpose", "applicability", "prerequisites", "inputSchema", "executionProcedure", "expectedOutput", "validation", "commonFailures", "recovery", "confidence", "successCount", "failureCount", "version"], "skill candidate");
        for (const field of ["id", "synthesisKey", "purpose", "executionProcedure", "expectedOutput"] as const) cognitiveLearningText(c[field], field);
        for (const field of ["sourceExperiences", "evidenceRefs", "applicability", "prerequisites", "validation", "commonFailures", "recovery"] as const) {
          if (!Array.isArray(c[field]) || c[field].length > 64) throw Error(`Invalid candidate ${field}`);
          for (const entry of c[field]) cognitiveLearningText(entry, field);
        }
        shape(c.inputSchema, ["type", "required"], "candidate input schema");
        const binding = catalogBinding(c.executionProcedure);
        if (!binding || binding.catalogOperation !== c.operation) throw Error("Invalid candidate operation binding");
        if (c.operation !== undefined) validateCognitiveOperation(c.operation);
        const required = binding.catalogOperation ? ["catalogOperation", "environment"] : ["catalogActionId", "environment"];
        if (c.inputSchema.type !== "object" || JSON.stringify(c.inputSchema.required) !== JSON.stringify(required)) throw Error("Invalid candidate input schema");
        if (!["candidate", "active", "quarantined"].includes(c.status)) throw Error("Invalid candidate status");
        boundedNumber(c.confidence, "candidate confidence", 1);
        for (const field of ["successCount", "failureCount", "version"] as const) if (!Number.isInteger(c[field]) || c[field] < 0) throw Error(`Invalid candidate ${field}`);
        if (c.sourceExperiences.some((id) => !value.experiences.some((e) => e.id === id && e.verified && e.observation.success && e.split !== "heldout"))) throw Error("Invalid skill provenance");
        if (binding.catalogOperation) {
          const sources = c.sourceExperiences.map(id => value.experiences.find(e => e.id === id)!);
          if (sources.length < 2 || sources.some((e, index) => !bindingMatches(binding, e) || e.environment !== binding.environment ||
              normalizedTask(e.task) !== normalizedTask(c.purpose) || sources.slice(0, index).some(prior => prior.goalId === e.goalId || prior.evidenceRefs.some(ref => e.evidenceRefs.includes(ref))))) throw Error("Invalid operation skill provenance");
        }
      }
      for (const records of [value.experiences, value.corrections, value.candidates]) if (new Set(records.map((record) => record.id)).size !== records.length) throw Error("Duplicate learning record ID");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, experiences: [], corrections: [], candidates: [] };
    }
  }

  private async save(partition: CognitiveLearningPartition, data: LearningFile): Promise<void> {
    const target = this.partitionPath(partition, "experience.json");
    const raw = `${JSON.stringify(data, null, 2)}\n`;
    if (Buffer.byteLength(raw) > MAX_BYTES) throw Error("Cognitive learning storage bound exceeded");
    await mkdir(join(target, ".."), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, raw, "utf8");
    await rename(temporary, target);
  }

  private validateExperience(input: CognitiveLearningExperience): CognitiveLearningExperience {
    shape(input, ["id", "partition", "goalId", "task", "actionId", "strategyId", "environment", "learningOperation", "prediction", "observation", "verified", "evidenceRefs", "source", "durationMs", "externalCalls", "split", "goalCompleted", "unknownTask", "humanInterventions", "rollbackCount", "transferTask", "offline", "memoryAblation", "completionEvidenceRefs"], "experience");
    shape(input.prediction, ["expectedOutcome", "confidence"], "prediction");
    shape(input.observation, ["summary", "success"], "observation");
    this.partitionPath(input.partition, "experience.json");
    if (!SOURCE.has(input.source) || typeof input.verified !== "boolean" || typeof input.observation?.success !== "boolean") throw Error("Invalid cognitive experience contract");
    if (input.split !== undefined && !["train", "heldout"].includes(input.split)) throw Error("Invalid learning split");
    for (const field of ["goalCompleted", "unknownTask", "transferTask", "offline"] as const) if (input[field] !== undefined && typeof input[field] !== "boolean") throw Error(`Invalid ${field}`);
    const copy = structuredClone(input);
    if (input.learningOperation !== undefined) copy.learningOperation = validateCognitiveOperation(input.learningOperation);
    for (const field of ["id", "goalId", "task", "actionId", "strategyId", "environment"] as const) copy[field] = cognitiveLearningText(input[field], field);
    copy.prediction.expectedOutcome = cognitiveLearningText(input.prediction.expectedOutcome, "prediction");
    copy.observation.summary = cognitiveLearningText(input.observation.summary, "observation");
    boundedNumber(input.prediction.confidence, "confidence", 1);
    boundedNumber(input.durationMs, "duration", 86_400_000);
    if (!Number.isInteger(input.externalCalls)) throw Error("Invalid external call count");
    boundedNumber(input.externalCalls, "external call count", 1_000);
    for (const field of ["humanInterventions", "rollbackCount"] as const) if (input[field] !== undefined) boundedNumber(input[field]!, field, 1_000);
    copy.evidenceRefs = refs(input.evidenceRefs);
    if (input.completionEvidenceRefs !== undefined) copy.completionEvidenceRefs = refs(input.completionEvidenceRefs);
    if (input.verified && copy.evidenceRefs.length === 0) throw Error("Verified experience requires evidence");
    if (input.memoryAblation) {
      shape(input.memoryAblation, ["pairId", "condition"], "ablation");
      cognitiveLearningText(input.memoryAblation.pairId, "ablation pair");
      if (!["with-memory", "without-memory"].includes(input.memoryAblation.condition)) throw Error("Invalid ablation condition");
    }
    return copy;
  }

  async observe(input: CognitiveLearningExperience): Promise<void> {
    const experience = this.validateExperience(input);
    await this.serial(input.partition, async () => {
      const data = await this.load(input.partition);
      const previous = data.experiences.find((item) => item.id === experience.id);
      if (previous) {
        // Completion is a separately verified monotonic update, not another action execution.
        const comparable = { ...previous, ...(previous.goalCompleted && experience.goalCompleted === undefined ? { goalCompleted: undefined, completionEvidenceRefs: undefined } : {}) };
        if (hash(comparable) !== hash(experience)) throw Error("Cognitive experience replay conflict"); return;
      }
      if (data.experiences.length >= MAX_ITEMS) throw Error("Cognitive experience capacity reached");
      data.experiences.push(experience);
      const memory = new PersistentMemoryStore(this.partitionPath(input.partition, "memory.json"));
      const skills = new PersistentSkillLibrary(this.partitionPath(input.partition, "skills.json"));
      // No implicit single-observation promotion from the World Model into long-term knowledge.
      const world = new PersistentWorldModel(this.partitionPath(input.partition, "world.json"));
      const benchmark = new PersistentBenchmarkHistory(this.partitionPath(input.partition, "benchmarks.json"));
      const closed = new ClosedLearningLoop({ memory, skills, world, benchmark });
      await closed.process({ id: experience.id, taskId: experience.goalId, task: experience.task,
        attempt: data.experiences.filter((item) => item.goalId === experience.goalId).length,
        split: experience.split ?? "train", actionId: experience.actionId,
        prediction: { action: experience.actionId, ...experience.prediction }, actualOutcome: experience.observation.summary,
        success: experience.observation.success, evidence: experience.evidenceRefs, verificationPassed: experience.verified,
        humanInterventionCount: experience.humanInterventions ?? 0, durationMs: experience.durationMs, transferTask: experience.transferTask });
      // Verified regressions veto certification even in held-out observations. They never
      // become training knowledge, and a later success cannot silently reactivate a skill.
      if (experience.verified) {
        for (const candidate of data.candidates.filter(c => c.status !== "quarantined" && relevant(c.purpose, experience.task))) {
          const binding = catalogBinding(candidate.executionProcedure);
          if (!binding || !bindingMatches(binding, experience) || binding.environment !== experience.environment) continue;
          const current = await skills.get(candidate.id);
          if (!current || current.procedure !== candidate.executionProcedure) throw Error("Certified skill binding is unavailable");
          // Certification can reach the library before the final ledger save.
          // Protect that active skill, and retain a quarantine from an interrupted write.
          if (candidate.status !== "active" && current.status !== "active" && current.status !== "quarantined") continue;
          // Project unique ledger experiences, including this pending observation.
          // Incrementing the library before the ledger commit would count a replay twice.
          const outcomes = data.experiences.filter(e => e.verified && bindingMatches(binding, e) &&
            e.environment === experience.environment && relevant(candidate.purpose, e.task));
          const successes = outcomes.filter(e => e.observation.success).length;
          const failures = outcomes.length - successes;
          const quarantine = !experience.observation.success || current.status === "quarantined";
          await skills.upsert({ ...current, successes, failures,
            confidence: candidate.confidence * 0.4 + (successes / outcomes.length) * 0.6,
            status: quarantine ? "quarantined" : current.status,
            certificationEvidence: [...new Set([...(current.certificationEvidence ?? []),
              ...(!experience.observation.success ? [`verified-regression:${experience.id}`] : [])])] });
          candidate.successCount = successes; candidate.failureCount = failures;
          if (quarantine) candidate.status = "quarantined";
        }
      }
      if (experience.verified && experience.split !== "heldout") {
        const existingEpisode = await memory.get(`experience:${experience.id}`);
        const episode = await memory.upsert({ id: `experience:${experience.id}`, kind: "episodic", content: `${experience.task}: ${experience.observation.summary}`,
          source: `cognitive:${experience.id}`, confidence: experience.prediction.confidence,
          createdAt: existingEpisode?.createdAt,
          tags: ["cognitive", experience.observation.success ? "verified-success" : "verified-failure", `environment:${experience.environment}`] });
        await this.synthesize(data, experience, memory, skills, episode.createdAt);
      }
      // R16 receives verified benchmark failures, never unverified model assertions.
      const research = new PersistentResearchHistory(this.partitionPath(input.partition, "research.json"));
      const train = (await benchmark.list("train"));
      for (const hypothesis of proposeResearchHypotheses(clusterFailures(train))) await research.saveHypothesis(hypothesis);
      await this.save(input.partition, data);
    });
  }

  private async synthesize(data: LearningFile, experience: CognitiveLearningExperience, memory: PersistentMemoryStore, skills: PersistentSkillLibrary, recordedAt: string): Promise<void> {
    if (!experience.observation.success) return;
    const group = data.experiences.filter((item) => item.verified && item.observation.success && item.split !== "heldout" && sameLearningStrategy(item, experience) && item.environment === experience.environment && normalizedTask(item.task) === normalizedTask(experience.task));
    const independent = group.filter((item, index) => !group.slice(0, index).some((prior) => prior.goalId === item.goalId || prior.evidenceRefs.some((ref) => item.evidenceRefs.includes(ref))));
    if (independent.length < 2) return;
    const operation = experience.learningOperation;
    const key = hash(operation ? [normalizedTask(experience.task), "catalog-operation", operation, experience.environment] : [experience.task, experience.actionId, experience.strategyId, experience.environment]).slice(0, 24);
    if (data.candidates.some((candidate) => candidate.synthesisKey === key)) return;
    const evidence = [...new Set(independent.flatMap((item) => item.evidenceRefs))];
    const binding: CatalogBinding = operation ? { catalogOperation: operation, environment: experience.environment } : { catalogActionId: experience.actionId, environment: experience.environment };
    const failures = data.experiences.filter(item => item.verified && bindingMatches(binding, item) && item.environment === experience.environment && relevant(item.task, experience.task) && !item.observation.success);
    const learned = await new VerifiedWorkLearningEngine(memory, skills).learn({ goalId: experience.goalId,
      goalSummary: experience.task, capability: `cognitive.${operation ? "catalog-operation" : "catalog-action"}:${key}`, applicability: [normalizedTask(experience.task), experience.environment],
      plan: [operation ?? experience.actionId], attempts: [{ id: `consolidation:${key}`, strategyId: operation ?? experience.strategyId,
        procedure: JSON.stringify(binding), resultOk: true, verifierPassed: true, evidenceRefs: evidence.slice(0, 60) }],
      outcome: "COMPLETED", completedAt: recordedAt, constraints: { maxRisk: "low", connectivity: "either" } });
    if (!learned.skill) return;
    data.candidates.push({ ...(operation ? { operation } : {}), id: learned.skill.id, synthesisKey: key, status: "candidate", sourceExperiences: independent.map((item) => item.id), evidenceRefs: evidence,
      purpose: experience.task, applicability: [experience.environment, normalizedTask(experience.task)], prerequisites: [operation ? "host catalog supplies the same bounded operation on a currently authorized action" : "host catalog contains the same action ID", "existing risk and verification gates pass"],
      inputSchema: { type: "object", required: [operation ? "catalogOperation" : "catalogActionId", "environment"] }, executionProcedure: learned.skill.procedure,
      expectedOutput: experience.prediction.expectedOutcome, validation: ["independent benchmark and verifier evidence"],
      commonFailures: failures.map(item => item.observation.summary).slice(-8),
      recovery: ["return to Goal Controller recovery; do not execute arbitrary learned text"], confidence: learned.skill.confidence,
      successCount: independent.length, failureCount: failures.length, version: learned.skill.version ?? 1 });
  }

  async recall(input: { partition: CognitiveLearningPartition; goalId: string; task: string; environment: string }) {
    cognitiveLearningText(input.task, "task"); cognitiveLearningText(input.environment, "environment");
    return this.serial(input.partition, async () => {
      const data = await this.load(input.partition);
      const eligible = data.experiences.filter((e) => e.verified && e.split !== "heldout" && e.environment === input.environment && relevant(e.task, input.task));
      const ids = new Set(eligible.map((e) => `experience:${e.id}`));
      const memory = new PersistentMemoryStore(this.partitionPath(input.partition, "memory.json"));
      const memories = (await memory.query({ tags: ["cognitive"], text: input.task, limit: MAX_ITEMS })).filter((m) => ids.has(m.id)).slice(0, 12).map(({ id, content, confidence }) => ({ id, content, confidence }));
      const grouped = new Map<string, CognitiveLearningExperience[]>();
      for (const e of eligible) { const list = grouped.get(e.strategyId) ?? []; list.push(e); grouped.set(e.strategyId, list); }
      const strategies = [...grouped.entries()].map(([id, entries]) => ({ id, actionId: entries.at(-1)!.actionId,
        score: entries.filter((e) => e.observation.success).length / entries.length - entries.reduce((n, e) => n + e.externalCalls * 0.02 + (e.humanInterventions ?? 0) * 0.03 + (e.rollbackCount ?? 0) * 0.05, 0) / entries.length,
        evidenceRefs: [...new Set(entries.flatMap((e) => e.evidenceRefs))].slice(0, 24) })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
      const corrections = data.corrections.filter((c) => c.verified && c.environment === input.environment && relevant(c.task, input.task)).slice(-12).map(({ originalActionId, replacementActionId, evidenceRefs }) => ({ originalActionId, replacementActionId, evidenceRefs }));
      const latest = new Map<string, CognitiveLearningExperience>();
      for (const e of eligible) latest.set(e.actionId, e);
      const avoidActionIds = [...new Set([...latest.values()].filter((e) => !e.observation.success).map((e) => e.actionId).concat(corrections.map((c) => c.originalActionId)))];
      const library = new PersistentSkillLibrary(this.partitionPath(input.partition, "skills.json"));
      const skills: Array<{ id: string; actionId: string; operation?: CognitiveOperation; environment: string; confidence: number; evidenceRefs: string[]; maxRisk: "low" | "medium" | "high" }> = [];
      for (const candidate of data.candidates.filter(c => c.status === "active" && relevant(c.purpose, input.task))) {
        const binding = catalogBinding(candidate.executionProcedure);
        if (!binding || binding.environment !== input.environment || (binding.catalogActionId !== undefined && avoidActionIds.includes(binding.catalogActionId))) continue;
        const certified = await library.get(candidate.id);
        if (certified?.status !== "active" || certified.procedure !== candidate.executionProcedure || !Array.isArray(certified.certificationEvidence) || !certified.certificationEvidence.length || !candidate.validation.every(ref => certified.certificationEvidence!.includes(ref))) continue;
        const maxRisk = certified.constraints?.maxRisk ?? "low";
        if (!["low", "medium", "high"].includes(maxRisk)) continue;
        skills.push({ id: candidate.id, actionId: binding.catalogActionId ?? `operation:${binding.catalogOperation}`, ...(binding.catalogOperation ? { operation: binding.catalogOperation } : {}), environment: binding.environment, confidence: candidate.confidence, evidenceRefs: refs(certified.certificationEvidence), maxRisk });
      }
      const researchHistory = new PersistentResearchHistory(this.partitionPath(input.partition, "research.json"));
      const reports = evaluateCognitiveResearch(data.experiences, input);
      const recorded = await researchHistory.listExperiments();
      for (const report of reports) {
        if (!report.hypothesis || !report.experimentInput) continue;
        const previous = recorded.find(e => e.id === report.experimentInput!.id);
        if (previous) {
          if (!sameResearchMeasurement(previous, report.experimentInput)) throw Error("Research measurement replay conflict");
          continue;
        }
        await researchHistory.saveHypothesis(report.hypothesis);
        await researchHistory.recordExperiment(decideExperiment(report.experimentInput));
      }
      return { research: reports.map(researchSummary), memories, skills: skills.sort((a, b) => b.confidence - a.confidence).slice(0, 8), strategies, avoidActionIds, corrections };
    });
  }

  /** Owner-visible counts only; reading status never launches or promotes an experiment. */
  async researchStatus(partition: CognitiveLearningPartition) {
    return this.serial(partition, async () => {
      const history = new PersistentResearchHistory(this.partitionPath(partition, "research.json"));
      const comparisons = (await history.listExperiments()).filter(e => e.id.startsWith("calibration:"));
      return { comparisons: comparisons.length, accepted: comparisons.filter(e => e.decision === "accepted").length,
        rejected: comparisons.filter(e => e.decision === "rejected").length, scope: "prediction-calibration-only" as const };
    });
  }

  async recordCorrection(input: CognitiveCorrection): Promise<void> {
    const copy = validateCorrection(input);
    await this.serial(input.partition, async () => {
      const data = await this.load(input.partition);
      const existing = data.corrections.find((item) => item.id === copy.id);
      if (existing) { if (hash(existing) !== hash(copy)) throw Error("Correction replay conflict"); return; }
      if (data.corrections.length >= MAX_ITEMS) throw Error("Correction capacity reached");
      data.corrections.push(copy);
      const affected = data.candidates.filter((c) => c.applicability.includes(copy.environment) && c.executionProcedure.includes(JSON.stringify(copy.originalActionId)));
      const skills = new PersistentSkillLibrary(this.partitionPath(input.partition, "skills.json"));
      for (const candidate of affected) { await skills.quarantine(candidate.id, `correction:${copy.id}`); candidate.status = "quarantined"; }
      await this.save(input.partition, data);
    });
  }

  async candidates(partition: CognitiveLearningPartition): Promise<CognitiveSkillCandidate[]> { return this.serial(partition, async () => structuredClone((await this.load(partition)).candidates)); }

  /** Any prior runtime experience or correction makes the Goal non-pristine, regardless of verification. */
  async hasGoalHistory(partition: CognitiveLearningPartition, goalId: string): Promise<boolean> {
    const target = cognitiveLearningText(goalId, "Goal history identity");
    return this.serial(partition, async () => {
      const data = await this.load(partition);
      return data.experiences.some(item => item.goalId === target) || data.corrections.some(item => item.goalId === target);
    });
  }

  async exportVerifiedData(partition: CognitiveLearningPartition): Promise<{
    experiences: CognitiveLearningExperience[]; corrections: CognitiveCorrection[];
    heldoutFamilies: Array<Pick<CognitiveLearningExperience, "task" | "environment">>;
  }> {
    return this.serial(partition, async () => {
      const data = await this.load(partition);
      return structuredClone({ experiences: data.experiences.filter((item) => item.verified && item.observation.success), corrections: data.corrections,
        // Failed outcomes stay private in the ledger; only their split exclusion survives export.
        heldoutFamilies: data.experiences.filter(item => item.verified && item.split === "heldout").map(({ task, environment }) => ({ task, environment })) });
    });
  }

  async complete(input: { partition: CognitiveLearningPartition; goalId: string; experienceId: string; evidenceRefs: string[] }): Promise<void> {
    cognitiveLearningText(input.goalId, "completed Goal"); cognitiveLearningText(input.experienceId, "completion experience");
    const evidence = refs(input.evidenceRefs);
    if (!evidence.length) throw Error("Goal completion requires independent evidence");
    await this.serial(input.partition, async () => {
      const data = await this.load(input.partition);
      const experience = data.experiences.find((e) => e.id === input.experienceId && e.goalId === input.goalId);
      if (!experience?.verified || !experience.observation.success) throw Error("Goal completion requires an existing verified successful experience");
      if (experience.goalCompleted) return;
      experience.goalCompleted = true;
      experience.completionEvidenceRefs = evidence;
      await this.save(input.partition, data);
    });
  }

  async certify(input: { partition: CognitiveLearningPartition; skillId: string; evidenceRefs: string[]; baselinePassRate: number; candidatePassRate: number; safetyPassed: boolean; independent: boolean }) {
    boundedNumber(input.baselinePassRate, "baseline rate", 1); boundedNumber(input.candidatePassRate, "candidate rate", 1);
    const evidence = refs(input.evidenceRefs);
    return this.serial(input.partition, async () => {
      const data = await this.load(input.partition);
      const candidate = data.candidates.find((c) => c.id === input.skillId);
      if (!candidate || candidate.status !== "candidate") throw Error("Unknown or non-candidate skill");
      if (!input.independent || !evidence.length || evidence.some((e) => candidate.evidenceRefs.includes(e))) throw Error("Fresh independent benchmark evidence required");
      const library = new PersistentSkillLibrary(this.partitionPath(input.partition, "skills.json"));
      const current = await library.get(candidate.id);
      if (!current || current.procedure !== candidate.executionProcedure) throw Error("Certified skill binding is unavailable");
      if (current.status !== "candidate" && current.status !== "active") throw Error("Skill is quarantined or otherwise ineligible for certification");
      if (current.status === "active" && hash([...(current.certificationEvidence ?? [])].sort()) !== hash([...evidence].sort())) throw Error("Certification replay conflict");
      const record = await new ContinualLearningRuntime(this.partitionPath(input.partition, "continual.json")).evaluate({ id: candidate.id,
        sourceOutcomeIds: candidate.sourceExperiences, verified: true, split: "train", baselinePassRate: input.baselinePassRate,
        candidatePassRate: input.candidatePassRate, transferDelta: 0, forgettingDelta: 0, safetyRegression: !input.safetyPassed,
        humanInterventionDelta: 0, additionalApiCostUsd: 0 });
      if (record.decision !== "promote") return { accepted: false, reasons: record.reasons };
      const certified = current.status === "active" ? current : await library.certify(candidate.id, evidence);
      if (!certified || certified.status !== "active") throw Error("Skill certification was not applied");
      candidate.status = "active"; candidate.validation = evidence;
      await this.save(input.partition, data);
      return { accepted: true, reasons: record.reasons };
    });
  }

  async metrics(partition: CognitiveLearningPartition) {
    return this.serial(partition, async () => {
      const all = (await this.load(partition)).experiences;
      const groups = new Map<string, CognitiveLearningExperience[]>();
      for (const e of all) { const entries = groups.get(e.goalId) ?? []; entries.push(e); groups.set(e.goalId, entries); }
      const goals = [...groups.values()];
      const completed = (entries: CognitiveLearningExperience[]) => entries.some((e) => e.goalCompleted === true && e.verified && e.observation.success);
      const local = (entries: CognitiveLearningExperience[]) => entries.every((e) => e.externalCalls === 0 && e.source !== "external-expert");
      const unknown = goals.filter((entries) => entries.some((e) => e.unknownTask));
      const transfer = goals.filter((entries) => entries.some((e) => e.transferTask));
      const recoverable = goals.filter((entries) => !entries[0].observation.success);
      const memoryPairs = new Map<string, { with?: boolean; without?: boolean }>();
      for (const e of all.filter((e) => e.verified && e.memoryAblation)) { const pair = memoryPairs.get(e.memoryAblation!.pairId) ?? {}; pair[e.memoryAblation!.condition === "with-memory" ? "with" : "without"] = e.observation.success; memoryPairs.set(e.memoryAblation!.pairId, pair); }
      const pairs = [...memoryPairs.values()].filter((p) => p.with !== undefined && p.without !== undefined);
      return { goals: goals.length, completedGoals: goals.filter(completed).length,
        externalAiFreeCompletionRate: ratio(goals.filter((g) => local(g) && completed(g)).length, goals.length),
        localOnlyCompletionRate: ratio(goals.filter((g) => local(g) && completed(g)).length, goals.filter(local).length),
        unknownTaskLocalSuccessRate: ratio(unknown.filter((g) => local(g) && completed(g)).length, unknown.filter(local).length),
        externalExpertEscalationRate: ratio(goals.filter((g) => !local(g)).length, goals.length),
        externalAiCallsPerGoal: ratio(all.reduce((n, e) => n + e.externalCalls, 0), goals.length),
        externalAiDependencyRate: ratio(goals.filter((g) => completed(g) && !local(g)).length, goals.filter(completed).length),
        skillReuseRate: ratio(goals.filter((g) => g.some((e) => e.source === "skill")).length, goals.length),
        memoryAssistedImprovement: ratio(pairs.reduce((n, p) => n + Number(p.with) - Number(p.without), 0), pairs.length),
        secondAttemptImprovement: ratio(recoverable.filter((g) => g[1]?.verified && g[1]?.observation.success).length, recoverable.filter((g) => g.length > 1).length),
        selfRecoveryRate: ratio(recoverable.filter((g) => completed(g) && g.every((e) => !e.humanInterventions)).length, recoverable.length),
        humanInterventionRate: ratio(goals.filter((g) => g.some((e) => (e.humanInterventions ?? 0) > 0)).length, goals.length),
        transferSuccessRate: ratio(transfer.filter(completed).length, transfer.length) };
    });
  }

  /** Existing R17 gate path remains authoritative; failed rollback cannot be reported restored. */
  async improve(partition: CognitiveLearningPartition, candidate: ImprovementCandidate, adapters: ImprovementAdapters & {
    independentVerification?: ImprovementAdapters["test"]; security?: ImprovementAdapters["test"];
  }) {
    if (!adapters.independentVerification || !adapters.security) throw Error("Independent verification and security adapters required");
    const bounded = (adapter: ImprovementAdapters["test"]) => async (value: ImprovementCandidate) => {
      const result = await adapter(value);
      const evidence = refs(result.evidence);
      return { ...result, ok: result.ok && evidence.length > 0, evidence, ...(!evidence.length ? { reason: "stage_evidence_required" } : {}) };
    };
    const protectedAdapters: ImprovementAdapters = {
      sandbox: bounded(adapters.sandbox), regression: bounded(adapters.regression), deviceE2E: bounded(adapters.deviceE2E),
      canary: bounded(adapters.canary), promote: bounded(adapters.promote),
      test: async (value) => {
        const combined: string[] = [];
        for (const check of [adapters.test, adapters.independentVerification!, adapters.security!]) {
          const result = await bounded(check)(value); combined.push(...result.evidence);
          if (!result.ok) return { ...result, evidence: combined };
        }
        return { ok: true, evidence: combined };
      }, rollback: async (value) => {
        const result = await bounded(adapters.rollback)(value);
        if (!result.ok) throw Error("Cognitive improvement rollback unverified; recovery required");
        return result;
      },
    };
    return this.serial(partition, () => new SelfImprovementRuntime(this.partitionPath(partition, "improvement.json"), protectedAdapters).run(candidate));
  }
}
