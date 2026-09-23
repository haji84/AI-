import { acquireCognitiveLease } from "./cognitive-lease.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CognitiveExperience } from "./cognitive-core.ts";
import type { Goal } from "../orchestrator/goal-loop.ts";

export interface CognitivePartition { tenantId: string; principalId: string; }
export type CognitiveSource = "deterministic" | "skill" | "memory" | "local-model" | "local-experiment" | "external-expert" | "degraded";
export interface CognitiveAttempt {
  id: string; actionId: string; strategyId: string; environment: string; source: CognitiveSource;
  expectedOutcome: string; confidence: number; observed: string; success: boolean; verified: boolean;
  evidenceRefs: string[]; predictionError: number; at: string;
}
export interface CognitiveState {
  version: 1; revision: number; partition: CognitivePartition; goal_id: string;
  goal_digest: string; current_hypothesis: string; active_plan: string[]; current_step: number;
  known_facts: string[]; uncertain_facts: string[]; assumptions: string[]; relevant_memories: string[];
  selected_strategy: string | null; alternatives: string[]; prediction: string | null; observation: string | null;
  prediction_error: number | null; confidence: number; blockers: string[]; next_action: string | null;
  research_needed: boolean; external_expert_needed: boolean; learning_candidates: string[];
  mode: "LOCAL" | "DEGRADED" | "EXPERT"; attempts: CognitiveAttempt[]; external_ai_calls: number;
  pending_action: { actionId: string; fingerprint: string; startedAt: string } | null;
  learning_outbox: CognitiveExperience | null;
  updated_at: string;
}

const MAX_BYTES = 512_000;
const MAX_ATTEMPTS = 256;
const secretPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|credential|secret)\s*[:=]\s*\S+|\b(?:sk|ghp|github_pat)[-_][a-z0-9_]{12,}/i;
const sensitiveKey = /^(?:password|api_?key|access_?token|refresh_?token|token|authorization|cookie|cookies|credential|credentials|secret|private_?key|raw_?personal_?data|ssn|passport|credit_?card)$/i;
export function assertCognitiveSafe(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded) > MAX_BYTES) throw new Error("cognitive state exceeds bound");
  if (secretPattern.test(encoded)) throw new Error("sensitive value must not enter cognitive persistence");
  const visit = (v: unknown, depth = 0): void => {
    if (depth > 24) throw new Error("cognitive value nesting exceeds bound");
    if (v && typeof v === "object") for (const [key, child] of Object.entries(v)) {
      if (sensitiveKey.test(key)) throw new Error("sensitive field must use an opaque reference outside cognitive persistence");
      visit(child, depth + 1);
    }
  };
  visit(value);
}
export function cognitiveDigest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function partitionValid(p: CognitivePartition) {
  if (!p || Object.keys(p).some(k => !["tenantId", "principalId"].includes(k)) || ![p.tenantId, p.principalId].every(x => typeof x === "string" && x.trim().length > 0 && x.length <= 200)) throw new Error("invalid cognitive partition");
}
function validate(state: CognitiveState, partition: CognitivePartition, goalId: string): void {
  assertCognitiveSafe(state);
  const fields = ["version", "revision", "partition", "goal_id", "goal_digest", "current_hypothesis", "active_plan", "current_step", "known_facts", "uncertain_facts", "assumptions", "relevant_memories", "selected_strategy", "alternatives", "prediction", "observation", "prediction_error", "confidence", "blockers", "next_action", "research_needed", "external_expert_needed", "learning_candidates", "mode", "attempts", "external_ai_calls", "pending_action", "learning_outbox", "updated_at"];
  if (!state || Object.keys(state).some(k => !fields.includes(k))) throw new Error("unknown cognitive fields");
  partitionValid(state.partition);
  if (state.version !== 1 || state.goal_id !== goalId || cognitiveDigest(state.partition) !== cognitiveDigest(partition)) throw new Error("cognitive identity mismatch");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.attempts) || state.attempts.length > MAX_ATTEMPTS) throw new Error("invalid cognitive revision/history");
  if (!Number.isFinite(state.confidence) || state.confidence < 0 || state.confidence > 1 || !Number.isFinite(Date.parse(state.updated_at))) throw new Error("invalid cognitive confidence/time");
  const arrays = [state.active_plan, state.known_facts, state.uncertain_facts, state.assumptions, state.relevant_memories, state.alternatives, state.blockers, state.learning_candidates];
  if (!arrays.every(xs => Array.isArray(xs) && xs.length <= 256 && xs.every(x => typeof x === "string" && x.length <= 4096))) throw new Error("invalid cognitive fields");
  const boundedText = (x: unknown, limit = 4096) => typeof x === "string" && x.length <= limit;
  const probability = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
  if (![state.current_hypothesis, state.goal_digest].every(x => boundedText(x)) || ![state.selected_strategy, state.next_action, state.prediction, state.observation].every(x => x === null || boundedText(x))) throw new Error("invalid cognitive text");
  if (!Number.isSafeInteger(state.current_step) || state.current_step < 0 || !Number.isSafeInteger(state.external_ai_calls) || state.external_ai_calls < 0 || !["LOCAL", "DEGRADED", "EXPERT"].includes(state.mode)) throw new Error("invalid cognitive mode/counter");
  if (![state.research_needed, state.external_expert_needed].every(x => typeof x === "boolean") || !(state.prediction_error === null || probability(state.prediction_error))) throw new Error("invalid cognitive flags");
  if (state.pending_action !== null && (!state.pending_action || !boundedText(state.pending_action.actionId, 200) || !/^[a-f0-9]{64}$/.test(state.pending_action.fingerprint) || !Number.isFinite(Date.parse(state.pending_action.startedAt)))) throw new Error("invalid cognitive pending action");
  if (state.learning_outbox !== null) {
    const e = state.learning_outbox;
    if (!e || e.goalId !== goalId || cognitiveDigest(e.partition) !== cognitiveDigest(partition) ||
        !state.attempts.some(a => a.id === e.id && a.actionId === e.actionId) || !boundedText(e.task, 4096) ||
        !Number.isFinite(e.durationMs) || e.durationMs < 0 || !Number.isSafeInteger(e.externalCalls) || e.externalCalls < 0 ||
        typeof e.verified !== "boolean" || !Array.isArray(e.evidenceRefs)) throw Error("invalid cognitive learning outbox");
  }
  for (const a of state.attempts) {
    if (!a || ![a.id, a.actionId, a.strategyId, a.environment].every(x => boundedText(x, 200) && x.length > 0) || ![a.expectedOutcome, a.observed].every(x => boundedText(x)) || ![a.success, a.verified].every(x => typeof x === "boolean") || !probability(a.confidence) || !probability(a.predictionError) || !Number.isFinite(Date.parse(a.at))) throw new Error("invalid cognitive attempt");
    if (!["deterministic", "skill", "memory", "local-model", "local-experiment", "external-expert", "degraded"].includes(a.source) || !Array.isArray(a.evidenceRefs) || a.evidenceRefs.length > 16 || !a.evidenceRefs.every(x => boundedText(x, 1000) && x.length > 0) || (a.verified && (!a.success || !a.evidenceRefs.length))) throw new Error("invalid cognitive attempt evidence");
  }
}

/** Separate additive state; never mutates Compass Goal, device identities or enrollment. */
export class CognitiveStateStore {
  private readonly directory: string;
  readonly partition: CognitivePartition;
  constructor(root: string, partition: CognitivePartition) {
    partitionValid(partition);
    this.partition = { tenantId: partition.tenantId, principalId: partition.principalId };
    this.directory = join(resolve(root), cognitiveDigest(this.partition));
  }
  private path(goalId: string): string {
    if (typeof goalId !== "string" || !goalId.trim() || goalId.length > 200) throw new Error("invalid cognitive goal id");
    return join(this.directory, `${cognitiveDigest(goalId)}.json`);
  }
  async get(goalId: string): Promise<CognitiveState | null> {
    try {
      const file = this.path(goalId);
      if ((await stat(file)).size > MAX_BYTES) throw new Error("cognitive state exceeds bound");
      const state = JSON.parse(await readFile(file, "utf8")) as CognitiveState;
      validate(state, this.partition, goalId);
      return state;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }
  async initialize(goalId: string, goal: Goal): Promise<CognitiveState> {
    const existing = await this.get(goalId);
    const goalDigest = cognitiveDigest(goal);
    if (existing) {
      if (existing.goal_digest !== goalDigest) throw new Error("cognitive goal contract changed; explicit migration required");
      return existing;
    }
    const state: CognitiveState = {
      version: 1, revision: 0, partition: this.partition, goal_id: goalId, goal_digest: goalDigest,
      current_hypothesis: "", active_plan: [], current_step: 0, known_facts: [], uncertain_facts: [], assumptions: [],
      relevant_memories: [], selected_strategy: null, alternatives: [], prediction: null, observation: null,
      prediction_error: null, confidence: 0, blockers: [], next_action: null, research_needed: false,
      external_expert_needed: false, learning_candidates: [], mode: "DEGRADED", attempts: [], external_ai_calls: 0,
      pending_action: null, learning_outbox: null, updated_at: new Date().toISOString(),
    };
    return this.save(state, null);
  }
  /** Expected revision + exclusive writer lock: conflict is visible, never last-write-wins. */
  async save(state: CognitiveState, expectedRevision: number | null): Promise<CognitiveState> {
    validate(state, this.partition, state.goal_id);
    await mkdir(this.directory, { recursive: true });
    const file = this.path(state.goal_id);
    const lock = `${file}.lock`;
    const release = await acquireCognitiveLease(lock);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const current = await this.get(state.goal_id);
      if ((current?.revision ?? null) !== expectedRevision) throw new Error("cognitive revision conflict");
      const next: CognitiveState = { ...state, revision: expectedRevision === null ? 0 : expectedRevision + 1, updated_at: new Date().toISOString() };
      const output = await open(temp, "wx");
      try { await output.writeFile(`${JSON.stringify(next)}\n`, "utf8"); await output.sync(); } finally { await output.close(); }
      await rename(temp, file);
      return next;
    } finally {
      await unlink(temp).catch(() => undefined);
      await release();
    }
  }
}
