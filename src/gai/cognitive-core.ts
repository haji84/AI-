import { randomUUID } from "node:crypto";
import { GoalDrivenLoop, type ContextSource, type ContextItem, type Goal, type Planner, type ProposedAction, type InferredIntent, type ActionResult, type StateStore, type WriteBackRecord, type CapabilityExecutor, type Verifier, type ApprovalPolicy, type GoalLoopOptions, type VerificationResult } from "../orchestrator/goal-loop.ts";
import { inferIntentFromSignals } from "../orchestrator/intent.ts";
import { WorkStateContextSource, WorkStateGuardedExecutor, WorkStateWriteBackStore } from "../orchestrator/work-state-integration.ts";
import type { WorkStateStore } from "../orchestrator/work-state.ts";
import { CognitiveStateStore, assertCognitiveSafe, cognitiveDigest, type CognitiveState, type CognitivePartition, type CognitiveSource } from "./cognitive-state.ts";
import { validateBrainDecision, type PrimaryBrainAdapter, type PrimaryBrainContext, type PrimaryBrainDecision, type ExternalExpertProvider } from "./primary-brain.ts";
import type { PersistentWorldModel } from "./world-model.ts";

export interface CognitiveCandidate {
  id: string; kind: "deterministic" | "skill" | "experiment" | "research";
  action: ProposedAction; expectedOutcome: string; evidenceRequired: string[];
  /** A host eligibility verdict, never read from model or imported experience. */
  verifiedSkill?: boolean;
  requiresExternalAI?: boolean;
}
export interface CognitiveRecall {
  memories: Array<{ id: string; content: string; confidence: number }>;
  /** Certified catalog bindings only; no learned text is executable authority. */
  skills?: Array<{ id: string; actionId: string; environment: string; confidence: number; evidenceRefs: string[]; maxRisk: "low" | "medium" | "high" }>;
  strategies: Array<{ id: string; actionId: string; score: number; evidenceRefs: string[] }>;
  avoidActionIds: string[];
  corrections: Array<{ originalActionId: string; replacementActionId: string; evidenceRefs: string[] }>;
}
export interface CognitiveExperience {
  id: string; partition: CognitivePartition; goalId: string; task: string; actionId: string; strategyId: string; environment: string;
  prediction: { expectedOutcome: string; confidence: number }; observation: { summary: string; success: boolean };
  verified: boolean; evidenceRefs: string[]; source: CognitiveSource; durationMs: number; externalCalls: number;
}
export interface CognitiveLearningBridge {
  recall(input: { partition: CognitivePartition; goalId: string; task: string; environment: string }): Promise<CognitiveRecall>;
  observe(experience: CognitiveExperience): Promise<void>;
  complete?(input: { partition: CognitivePartition; goalId: string; experienceId: string; evidenceRefs: string[] }): Promise<void>;
}
export interface CognitiveCoreOptions {
  goalId: string; partition: CognitivePartition; state: CognitiveStateStore; environment: string;
  candidates(input: { goal: Goal; context: ContextItem[]; previousResult?: ActionResult | null }): Promise<CognitiveCandidate[]>;
  completion?(state: CognitiveState, goal: Goal, context: ContextItem[]): Promise<boolean>;
  brain?: PrimaryBrainAdapter; learning?: CognitiveLearningBridge; world?: PersistentWorldModel;
  expert?: ExternalExpertProvider; allowExternal?: boolean; connectivity?: "online" | "offline" | "unknown";
  maxActions?: number;
}
export function cognitiveActionFingerprint(action: ProposedAction): string {
  const copy = { ...action } as ProposedAction & { workItemId?: unknown; completesWorkItem?: unknown };
  delete copy.workItemId; delete copy.completesWorkItem;
  return cognitiveDigest(copy);
}
const noRecall = (): CognitiveRecall => ({ memories: [], skills: [], strategies: [], avoidActionIds: [], corrections: [] });
function evidenceRefs(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const refs = (value as { refs?: unknown }).refs;
  return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= 1000).slice(0, 16) : [];
}
function candidateValid(c: CognitiveCandidate): boolean {
  return Boolean(c && typeof c.id === "string" && c.id.length > 0 && c.id.length <= 200 && c.action && c.action.capability?.trim() && ["low", "medium", "high"].includes(c.action.risk));
}

/** Planner and learning decorators around GoalDrivenLoop, not a second execution authority. */
export class CognitiveCore implements Planner, ContextSource {
  readonly name = "goriq-cognitive-state";
  private readonly options: CognitiveCoreOptions;
  private authorityStore?: StateStore;
  private selection: { id: string; source: CognitiveSource; started: number; externalCalls: number } | null = null;
  constructor(options: CognitiveCoreOptions) {
    if (options.partition.tenantId !== options.state.partition.tenantId || options.partition.principalId !== options.state.partition.principalId) throw new Error("cognitive partition mismatch");
    const max = options.maxActions ?? 32;
    if (!Number.isInteger(max) || max < 1 || max > 128) throw new Error("invalid cognitive action budget");
    this.options = { ...options, maxActions: max };
  }
  async collect(input: { goal: Goal }): Promise<ContextItem[]> {
    const s = await this.options.state.initialize(this.options.goalId, input.goal);
    return [{ source: this.name, summary: `mode=${s.mode}; attempts=${s.attempts.length}; next=${s.next_action ?? "observe"}`, data: { goalId: s.goal_id, confidence: s.confidence, blockers: s.blockers, hypothesis: s.current_hypothesis, previousAttempts: s.attempts.slice(-8) } }];
  }
  async inferIntent(input: { goal: Goal; context: ContextItem[]; preferences?: string[]; recentDecisions?: string[] }): Promise<InferredIntent> {
    return inferIntentFromSignals(input);
  }
  async proposeNextAction(input: { goal: Goal; context: ContextItem[]; intent: InferredIntent; previousResult?: ActionResult | null }): Promise<ProposedAction | null> {
    let state = await this.options.state.initialize(this.options.goalId, input.goal);
    state = await this.flushLearning(state);
    // Only host verifier/WorkState completion may terminate a Goal. Model null means no proposal.
    if (!state.pending_action && this.options.completion && await this.options.completion(state, input.goal, input.context)) return null;
    const raw = await this.options.candidates(input);
    if (!Array.isArray(raw) || raw.length > 64 || !raw.every(candidateValid) || new Set(raw.map(c => c.id)).size !== raw.length) throw new Error("invalid host cognitive candidate catalog");
    const recall = this.options.learning ? await this.options.learning.recall({ partition: this.options.partition, goalId: this.options.goalId, task: input.goal.title, environment: this.options.environment }) : noRecall();
    assertCognitiveSafe(recall);
    const avoided = new Set([...recall.avoidActionIds, ...state.attempts.filter(a => !a.verified && a.environment === this.options.environment).map(a => a.actionId)]);
    for (const correction of recall.corrections) if (correction.evidenceRefs.length) avoided.add(correction.originalActionId);
    const done = new Set(state.attempts.filter(a => a.verified).map(a => a.actionId));
    const eligible = raw.filter(c => !avoided.has(c.id) && !done.has(c.id) && (c.kind !== "skill" || c.verifiedSkill === true));
    const candidates = state.pending_action ? [] : eligible.filter(c => c.requiresExternalAI !== true);
    const remaining = state.pending_action ? 0 : Math.max(0, this.options.maxActions! - state.attempts.length);
    if (this.options.world) await this.options.world.load();
    const context: PrimaryBrainContext = {
      goal: input.goal, currentState: state.observation ?? input.context.map(c => c.summary).join("\n").slice(0, 4000),
      candidates: candidates.map(c => ({ id: c.id, description: c.action.description, risk: c.action.risk })),
      memories: recall.memories.slice(0, 8), world: this.options.world ? (await this.options.world.retrieve(input.goal.title, 4)).map(e => ({ action: e.prediction.action, actual: e.observation.actualOutcome, success: e.observation.success, error: e.predictionError })) : [],
      previousAttempts: state.attempts.slice(-8), environment: this.options.environment,
      connectivity: this.options.connectivity ?? "unknown", budget: { remainingActions: remaining }, constraints: input.goal.constraints,
    };
    let selected: CognitiveCandidate | undefined;
    let source: CognitiveSource = "degraded";
    let decision: PrimaryBrainDecision | undefined;
    let unavailable = !this.options.brain;
    let externalCalls = 0;
    if (remaining > 0) {
      selected = candidates.find(c => c.kind === "deterministic");
      if (selected) source = "deterministic";
      if (!selected) { selected = candidates.find(c => c.kind === "skill"); if (selected) source = "skill"; }
      if (!selected) {
        const riskRank = { low: 0, medium: 1, high: 2 };
        const certified = (recall.skills ?? []).filter(s => s.environment === this.options.environment && s.evidenceRefs.length > 0 && Number.isFinite(s.confidence) && s.confidence >= 0 && s.confidence <= 1)
          .sort((a, b) => b.confidence - a.confidence);
        for (const skill of certified) {
          selected = candidates.find(c => c.id === skill.actionId && riskRank[c.action.risk] <= riskRank[skill.maxRisk]);
          if (selected) { source = "skill"; break; }
        }
      }
      if (!selected) {
        const corrected = recall.corrections.find(c => c.evidenceRefs.length && candidates.some(a => a.id === c.replacementActionId));
        const strategies = [...recall.strategies].filter(s => s.evidenceRefs.length && Number.isFinite(s.score)).sort((a, b) => b.score - a.score);
        const recalled = corrected?.replacementActionId ?? strategies.find(s => candidates.some(c => c.id === s.actionId))?.actionId;
        selected = candidates.find(c => c.id === recalled); if (selected) source = "memory";
      }
      if (!selected && candidates.length && this.options.brain) {
        try { decision = validateBrainDecision(await this.options.brain.plan(context), context); selected = candidates.find(c => c.id === decision!.candidateId); if (selected) source = "local-model"; }
        catch { unavailable = true; }
      }
      // Local experiments/research still run when model/external expertise is absent.
      if (!selected) { selected = candidates.find(c => c.kind === "experiment" || c.kind === "research"); if (selected) source = "local-experiment"; }
      if (!selected && this.options.allowExternal === true && this.options.connectivity === "online") {
        const expertContext = { ...context, candidates: eligible.map(c => ({ id: c.id, description: c.action.description, risk: c.action.risk })) };
        if (this.options.expert && await this.options.expert.eligible(expertContext)) {
          externalCalls++;
          try { decision = validateBrainDecision(await this.options.expert.suggest(expertContext), expertContext); selected = eligible.find(c => c.id === decision!.candidateId); if (selected) source = "external-expert"; }
          catch { unavailable = true; }
        }
      }
    }
    const id = selected?.id ?? "cognitive:inspect";
    const modelSelected = Boolean(decision && selected && decision.candidateId === selected.id);
    const confidence = modelSelected ? decision!.confidence : 0.5;
    state = await this.options.state.save({
      ...state, current_hypothesis: decision?.assessment ?? (selected ? `Test registered strategy ${id}` : "Additional local capability or evidence is required"),
      active_plan: decision?.plan?.length ? decision.plan.map(step => `${step.candidateId}: ${step.objective}`).slice(0, 16) : candidates.map(c => c.id), current_step: state.attempts.length, alternatives: candidates.filter(c => c.id !== id).map(c => c.id),
      uncertain_facts: decision?.hypotheses ?? [], relevant_memories: recall.memories.map(m => m.id).slice(0, 64),
      selected_strategy: id, prediction: modelSelected ? decision!.expectedOutcome : selected?.expectedOutcome ?? "Collect missing local context",
      confidence, next_action: id, research_needed: !selected || decision?.escalation === "research", external_expert_needed: decision?.escalation === "expert",
      mode: source === "external-expert" ? "EXPERT" : unavailable || !selected ? "DEGRADED" : "LOCAL",
      blockers: state.pending_action ? ["action_outcome_unknown_reconciliation_required"] : !remaining ? ["cognitive_action_budget_exhausted"] : !selected ? ["no_untried_authorized_candidate"] : [],
      external_ai_calls: state.external_ai_calls + externalCalls,
    }, state.revision);
    this.selection = { id, source, started: Date.now(), externalCalls };
    if (!selected) return { id, capability: "context.inspect", description: `Observe local context for ${input.goal.title}; ${state.blockers.join(", ")}`, risk: "low", irreversible: false, externalSideEffect: false };
    // Preserve host risk/scope/approval metadata; never trust model's proposed permissions or completion.
    return { ...selected.action, completesBoundedCommand: false };
  }
  private async flushLearning(state: CognitiveState): Promise<CognitiveState> {
    if (!state.learning_outbox) return state;
    if (!this.options.learning) throw Error("Pending verified learning requires the same learning adapter");
    await this.options.learning.observe(state.learning_outbox);
    return this.options.state.save({ ...state, learning_outbox: null, blockers: state.blockers.filter(b => b !== "learning_write_pending") }, state.revision);
  }
  async observe(record: WriteBackRecord): Promise<void> {
    if (record.stopReason === "goal_complete") {
      const state = await this.options.state.get(this.options.goalId);
      const last = state?.attempts.findLast(a => a.verified);
      if (last && !state?.pending_action) await this.options.learning?.complete?.({ partition: this.options.partition, goalId: this.options.goalId, experienceId: last.id, evidenceRefs: last.evidenceRefs });
    }
    if (!this.selection || !record.result || !record.action) return;
    const selection = this.selection; this.selection = null;
    let state = await this.options.state.initialize(this.options.goalId, record.goal);
    const refs = evidenceRefs(record.verification?.evidence);
    const success = record.result.ok && record.verification?.ok === true;
    const verified = success && refs.length > 0 && selection.source !== "degraded";
    const observationVerified = record.verification !== undefined && record.verification !== null && refs.length > 0 && selection.source !== "degraded";
    const summary = (record.verification?.ok === false ? record.verification.summary : record.result.summary).slice(0, 4000);
    const experience: CognitiveExperience = {
      id: randomUUID(), partition: this.options.partition, goalId: this.options.goalId, task: record.goal.title,
      actionId: selection.id, strategyId: state.selected_strategy ?? selection.id, environment: this.options.environment,
      prediction: { expectedOutcome: state.prediction ?? "", confidence: state.confidence }, observation: { summary, success },
      verified: observationVerified, evidenceRefs: refs, source: selection.source, durationMs: Date.now() - selection.started, externalCalls: selection.externalCalls,
    };
    assertCognitiveSafe(experience);
    const predictionError = Math.abs(state.confidence - (success ? 1 : 0));
    state = await this.options.state.save({ ...state, observation: summary, prediction_error: predictionError,
      known_facts: verified ? [...state.known_facts, summary].slice(-64) : state.known_facts,
      attempts: [...state.attempts, { id: experience.id, actionId: selection.id, strategyId: experience.strategyId, environment: this.options.environment, source: selection.source, expectedOutcome: experience.prediction.expectedOutcome, confidence: state.confidence, observed: summary, success, verified, evidenceRefs: refs, predictionError, at: new Date().toISOString() }].slice(-256),
      next_action: record.nextAction ?? null, learning_candidates: verified ? [...state.learning_candidates, experience.id].slice(-64) : state.learning_candidates,
      learning_outbox: this.options.learning ? experience : null,
      pending_action: state.pending_action?.actionId === selection.id ? null : state.pending_action,
    }, state.revision);
    if (this.options.learning) {
      try { await this.flushLearning(state); }
      catch {
        // Authority has committed; keep the durable outbox visible for learning recovery.
        // Next planning cycle must flush it before completion or another action.
        await this.options.state.save({ ...state, blockers: [...state.blockers, "learning_write_pending"], next_action: "retry_verified_learning_outbox" }, state.revision);
      }
    }
    else if (this.options.world) await this.options.world.record({ id: experience.id, context: record.goal.title, prediction: { action: selection.id, expectedOutcome: experience.prediction.expectedOutcome, confidence: experience.prediction.confidence }, observation: { actualOutcome: summary, success: verified, evidence: refs } });
  }
  decorateStore(inner: StateStore): StateStore {
    const decorated: StateStore = { getState: () => inner.getState(), completionBlockers: goal => inner.completionBlockers?.(goal) ?? Promise.resolve([]), writeBack: async record => {
      await inner.writeBack(record);
      const blockers = record.stopReason === "goal_complete" ? await inner.completionBlockers?.(record.goal) ?? [] : [];
      await this.observe(blockers.length ? { ...record, stopReason: "blocked" } : record);
    } };
    this.authorityStore = decorated;
    return decorated;
  }
  /** Reconcile an already persisted outcome; this never executes a tool again. */
  async reconcileVerifiedAction(candidate: CognitiveCandidate, goal: Goal, result: ActionResult, verification: VerificationResult): Promise<void> {
    const state = await this.options.state.get(this.options.goalId);
    const pending = state?.pending_action;
    const action = { ...candidate.action, completesBoundedCommand: false };
    if (!this.authorityStore || !pending || pending.actionId !== candidate.id || pending.fingerprint !== cognitiveActionFingerprint(action) ||
        candidate.requiresExternalAI || action.risk !== "low" || !result.ok || result.actionId !== action.id || !verification.ok || !evidenceRefs(verification.evidence).length) throw Error("Pending action reconciliation contract mismatch");
    this.selection = { id: candidate.id, source: "local-experiment", started: Date.now(), externalCalls: 0 };
    await this.authorityStore.writeBack({ goal, intent: { summary: "Reconcile independently verified local outcome", confidence: 1, evidence: [] }, action, result, verification, stopReason: "continue", nextAction: "re-evaluate-goal-after-recovery" });
  }
  decorateExecutor(inner: CapabilityExecutor): CapabilityExecutor {
    return { execute: async (action, context) => {
      if (!this.selection) throw new Error("cognitive selection required before execution");
      const state = await this.options.state.get(this.options.goalId);
      if (!state) throw new Error("cognitive state missing before execution");
      if (this.selection.source !== "degraded") {
        if (state.pending_action) return { actionId: action.id, ok: false, summary: "Prior action outcome requires reconciliation", blocker: "cognitive_pending_action" };
        await this.options.state.save({ ...state, pending_action: { actionId: this.selection.id, fingerprint: cognitiveActionFingerprint(action), startedAt: new Date().toISOString() } }, state.revision);
      }
      // If executor crashes, pending state remains and subsequent cycles cannot replay effects.
      return inner.execute(action, context);
    } };
  }
}

export function createCognitiveGoalLoop(input: {
  core: CognitiveCore; goal?: Goal; contextSources: ContextSource[]; executor: CapabilityExecutor; verifier: Verifier;
  stateStore: StateStore; workStateStore?: WorkStateStore; approvalPolicy?: ApprovalPolicy; options?: GoalLoopOptions;
}): GoalDrivenLoop {
  const contexts: ContextSource[] = [input.core, ...input.contextSources];
  let executor = input.core.decorateExecutor(input.executor);
  let authorityStore = input.stateStore;
  if (input.workStateStore && input.goal) {
    contexts.unshift(new WorkStateContextSource(input.workStateStore));
    executor = new WorkStateGuardedExecutor(executor, input.workStateStore, input.goal);
    authorityStore = new WorkStateWriteBackStore(authorityStore, input.workStateStore);
  }
  // Authority commits first. An interrupted authority commit retains pending_action.
  return new GoalDrivenLoop(input.core, contexts, executor, input.verifier, input.core.decorateStore(authorityStore), input.approvalPolicy, input.options);
}
