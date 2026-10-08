import { validateCognitiveGoalProposalInput } from "../orchestrator/cognitive-goal-input.ts";
import { configuredPrimaryBrain, validateBrainDecision, type PrimaryBrainContext } from "./primary-brain.ts";
import { validateCognitiveGoalRefinement, prepareCognitiveGoalRefinement, findCognitiveGoalRefinementReplay } from "../orchestrator/cognitive-goal-refinement.ts";
import { lstat } from "node:fs/promises";
import { CognitiveMaterialIntake } from "./cognitive-material-intake.ts";
import { CognitiveHistoricalLearningStore } from "./cognitive-history.ts";
import { acquireCognitiveLease } from "./cognitive-lease.ts";
import { CompassWorkStateStoreAdapter } from "../orchestrator/compass-work-state-store.ts";
import { dirname, resolve } from "node:path";
import { CompassStore } from "../compass/store.ts";
import { compassGoalToLoopGoal } from "../orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../orchestrator/work-state-integration.ts";
import { CompassGoalExecutionAdapter, loadCognitiveRuntimeWork, type CognitiveRuntimeOptions } from "../orchestrator/compass-goal-execution-adapter.ts";
import { cognitiveDigest, CognitiveStateStore } from "./cognitive-state.ts";
import { CognitiveLearningEngine } from "./cognitive-learning.ts";


/** Auth is enforced by Broker before this owner-local service. No tenant supplied by HTTP. */
export class CognitiveService {
  private readonly dbPath: string;
  private readonly options: CognitiveRuntimeOptions;
  private readonly learning: CognitiveLearningEngine;
  private busy = false;
  private readonly history: CognitiveHistoricalLearningStore;
  constructor(dbPath: string, options: CognitiveRuntimeOptions = {}) {
    this.dbPath = dbPath;
    this.options = { ...options, partition: options.partition ?? { tenantId: "local", principalId: "owner" },
      stateRoot: options.stateRoot ?? resolve(dirname(dbPath), "cognitive") };
    this.learning = new CognitiveLearningEngine(resolve(this.options.stateRoot!, "learning"));
    this.history = new CognitiveHistoricalLearningStore(resolve(this.options.stateRoot!, "history"));
  }
  private async validateStateRoot() {
    try { const info = await lstat(this.options.stateRoot!); if (info.isSymbolicLink() || !info.isDirectory()) throw Error("Unsafe cognitive state root"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  async status() {
    await this.validateStateRoot();
    const compass = new CompassStore(this.dbPath);
    try {
      const record = compass.getGoal();
      const goal = record ? compassGoalToLoopGoal(record) : null;
      const goalId = goal ? goalWorkStateId(goal) : null;
      const state = goalId ? await new CognitiveStateStore(this.options.stateRoot!, this.options.partition!).get(goalId) : null;
      const metrics = await this.learning.metrics(this.options.partition!);
      const localConfigured = Boolean(this.options.localWork || this.options.localOutcomes || this.options.materialIntake);
      let materials: ReturnType<CognitiveMaterialIntake["summary"]> | null = null;
      let configurationBlocker: string | null = null;
      if (state && goal && goalId) {
        if (state.goal_digest !== cognitiveDigest(goal)) configurationBlocker = "Goalの条件が変更されています。再計画が必要です。";
        else if (state.execution_contract_digest) {
          try {
            const current = await loadCognitiveRuntimeWork(this.options, goalId, goal);
            if (current?.contractDigest !== state.execution_contract_digest) configurationBlocker = "作業の対象または成果物が変更されています。再計画が必要です。";
          } catch { configurationBlocker = "保存した作業条件を確認できません。ホストの作業設定を確認してください。"; }
        }
      }
      if (goal && goalId && this.options.materialIntake) {
        try { const saved = await this.materialStore().load(goalId, goal); if (saved) materials = this.materialStore().summary(saved.receipt); }
        catch { configurationBlocker = "保存した材料のGoalまたは保存先を確認できません。再計画が必要です。"; }
      }
      return { goalId, goalDigest: goal ? cognitiveDigest(goal) : null,
        criteria: goal?.successCriteria.map((description, i) => ({ id: `criterion-${i + 1}`, description })) ?? [],
        materialIntakeEnabled: Boolean(this.options.materialIntake), materials,
        goalRefinementAvailable: Boolean(this.options.materialIntake && goal && goalId && !configurationBlocker && !goal.successCriteria.length && !state && !(await new CompassWorkStateStoreAdapter(compass).get(goalId)) && !(await this.learning.hasGoalHistory(this.options.partition!, goalId)) && !compass.getState().decisions.some(v => v && typeof v === "object" && (v as {kind?:unknown}).kind === "goriq-cognitive-goal-refinement" && (v as {goalId?:unknown}).goalId === goalId)),
        historyImportEnabled: Boolean(this.options.historyImport), history: await this.history.summary(this.options.partition!),
        goalTitle: goal?.title ?? null, busy: this.busy, goalComplete: !configurationBlocker && (!localConfigured || Boolean(state?.execution_contract_digest)) && compass.getState().status === "goal_complete",
        mode: configurationBlocker ? "DEGRADED" : state?.mode ?? "READY", attempts: state?.attempts.length ?? 0,
        nextAction: state?.next_action ?? null, blockers: [...(state?.blockers ?? []), ...(configurationBlocker ? [configurationBlocker] : [])],
        confidence: state?.confidence ?? null, updatedAt: state?.updated_at ?? null,
        externalAIEnabled: this.options.allowExternalAI === true,
        recentAttempts: state?.attempts.slice(-16).map(a => ({ id: a.id, actionId: a.actionId, verified: a.verified, success: a.success })) ?? [],
        localActionsConfigured: localConfigured, research: await this.learning.researchStatus(this.options.partition!), metrics };
    } finally { compass.close(); }
  }
  async continue(goalId: string) {
    await this.validateStateRoot();
    if (this.busy) throw Error("Cognitive cycle already running");
    if (typeof goalId !== "string" || !/^goal-[a-f0-9]{16}$/.test(goalId)) throw Error("Invalid Goal ID");
    this.busy = true;
    try {
      const report = await new CompassGoalExecutionAdapter(this.dbPath, {}, { ...this.options, useCore: true, learning: this.learning }).run(goalId, { maxCycles: 3 });
      return { stopReason: report.stopReason, cycles: report.cycles.length, goalEvaluation: report.goalEvaluation ?? null };
    } finally { this.busy = false; }
  }
  async correct(goalId: string, originalId: string, replacementId: string) {
    await this.validateStateRoot();
    if (this.busy) throw Error("Correction requires the current idle Goal");
    this.busy = true;
    const compass = new CompassStore(this.dbPath); let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireCognitiveLease(`${this.dbPath}.cognitive-run.lock`);
      const record = compass.getGoal(); if (!record) throw Error("Current Goal required");
      const goal = compassGoalToLoopGoal(record);
      if (goalWorkStateId(goal) !== goalId) throw Error("Current Goal changed");
      const state = await new CognitiveStateStore(this.options.stateRoot!, this.options.partition!).get(goalId);
      if (!state || state.goal_digest !== cognitiveDigest(goal)) throw Error("Goal changed; explicit review required");
      const contract = await loadCognitiveRuntimeWork(this.options, goalId, goal);
      if ((state.execution_contract_digest ?? null) !== (contract?.contractDigest ?? null)) throw Error("Cognitive execution contract changed");
      if (state.pending_action || state.learning_outbox) throw Error("Pending execution requires reconciliation before correction");
      const original = state.attempts.find(a => a.id === originalId), replacement = state.attempts.find(a => a.id === replacementId);
      if (!original || !replacement?.verified || !replacement.success || original.actionId === replacement.actionId || original.environment !== replacement.environment) throw Error("Correction needs distinct existing actions and a verified replacement");
      const id = "correction:" + cognitiveDigest({ goalId, originalId, replacementId }).slice(0, 32);
      await this.learning.recordCorrection({ id, partition: this.options.partition!, goalId, task: goal.title, environment: replacement.environment,
        originalActionId: original.actionId, replacementActionId: replacement.actionId, evidenceRefs: replacement.evidenceRefs, verified: true, scope: "preference" });
      return { accepted: true, id };
    } finally { compass.close(); if (release) await release(); this.busy = false; }
  }
  async refineGoal(value: unknown) {
    await this.validateStateRoot();
    if (!this.options.materialIntake) throw Error("Goal refinement requires host material intake configuration");
    const input = validateCognitiveGoalRefinement(value);
    if (this.busy) throw Error("Cognitive cycle already running");
    this.busy = true;
    const compass = new CompassStore(this.dbPath); let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireCognitiveLease(`${this.dbPath}.cognitive-run.lock`);
      const record = compass.getGoal(); if (!record) throw Error("Current Goal required");
      const snapshot = compass.getState();
      const replay = findCognitiveGoalRefinementReplay(record, snapshot.decisions, input);
      if (replay) return { adopted: true, replayed: true, goalId: replay.goalId, goalDigest: replay.targetGoalDigest };
      if (snapshot.decisions.some(v => v && typeof v === "object" && (v as {kind?:unknown}).kind === "goriq-cognitive-goal-refinement" && (v as {goalId?:unknown}).goalId === input.goalId)) throw Error("Existing Goal refinement requires explicit review");
      const prepared = prepareCognitiveGoalRefinement(record, input);
      const goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
      const checkpoint = await new CognitiveStateStore(this.options.stateRoot!, this.options.partition!).get(goalId);
      if (checkpoint || await new CompassWorkStateStoreAdapter(compass).get(goalId) || await this.learning.hasGoalHistory(this.options.partition!, goalId) || await loadCognitiveRuntimeWork(this.options, goalId, goal)) throw Error("Existing work requires explicit review; only pristine Goals may adopt criteria");
      compass.adoptPristineGoalCriteria(record, snapshot, input.successCriteria, prepared.receipt);
      return { adopted: true, replayed: false, goalId, goalDigest: prepared.receipt.targetGoalDigest };
    } finally { compass.close(); if (release) await release(); this.busy = false; }
  }
  /** Local draft only; explicit owner adoption remains the sole Goal mutation path. */
  async proposeGoalCriteria(value: unknown) {
    await this.validateStateRoot();
    const input = validateCognitiveGoalProposalInput(value);
    if (!this.options.materialIntake || this.busy) throw Error("Goal proposal requires configured idle local intake");
    const brain = this.options.brain ?? configuredPrimaryBrain();
    if (!brain) throw Error("Local Primary Brain unavailable; explicit criteria input remains available");
    this.busy = true;
    const compass = new CompassStore(this.dbPath); let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireCognitiveLease(`${this.dbPath}.cognitive-run.lock`);
      const record = compass.getGoal(); if (!record) throw Error("Current Goal required");
      const snapshot = compass.getState(), goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
      if (goalId !== input.goalId || cognitiveDigest(goal) !== input.goalDigest || goal.successCriteria.length) throw Error("Current Goal changed or already has criteria");
      const existing = async () => Boolean(await new CognitiveStateStore(this.options.stateRoot!, this.options.partition!).get(goalId) ||
        await new CompassWorkStateStoreAdapter(compass).get(goalId) || await this.learning.hasGoalHistory(this.options.partition!, goalId) ||
        await loadCognitiveRuntimeWork(this.options, goalId, goal) || compass.getState().decisions.some(v => v && typeof v === "object" && (v as {kind?:unknown}).kind === "goriq-cognitive-goal-refinement" && (v as {goalId?:unknown}).goalId === goalId));
      if (await existing()) throw Error("Existing work requires explicit review before a new Goal proposal");
      const context: PrimaryBrainContext = { purpose: "goal-draft", goal, currentState: "Propose missing Goal-level desired completion outcomes only. Known host capability: bounded local material intake, unchanged text-file creation, and verified output download are configured; material content has not been supplied yet. No action is authorized by this proposal.",
        candidates: [], memories: [], world: [], previousAttempts: [], environment: this.options.environment ?? "owner-local", connectivity: "unknown", budget: { remainingActions: 0 }, constraints: goal.constraints ?? [] };
      const decision = validateBrainDecision(await brain.plan(context), context);
      if (await existing() || JSON.stringify(compass.getGoal()) !== JSON.stringify(record) || JSON.stringify(compass.getState()) !== JSON.stringify(snapshot)) throw Error("Goal or work state changed during proposal");
      if (!decision.goalDraft) throw Error("Local model supplied no completion-condition draft; use explicit input");
      return { status: "PROPOSED" as const, verification: "UNVERIFIED" as const, source: "local-primary-brain" as const,
        goalId, goalDigest: input.goalDigest, draft: decision.goalDraft, confidence: decision.confidence };
    } finally { compass.close(); if (release) await release(); this.busy = false; }
  }
  private materialStore() {
    if (!this.options.materialIntake || this.options.localWork || this.options.localOutcomes) throw Error("Local material intake is not configured");
    return new CognitiveMaterialIntake(this.options.stateRoot!, this.options.materialIntake.dataRoot, this.options.partition!);
  }
  async prepareMaterials(input: unknown) {
    await this.validateStateRoot();
    if (this.busy) throw Error("Cognitive cycle already running");
    this.busy = true;
    const compass = new CompassStore(this.dbPath); let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireCognitiveLease(`${this.dbPath}.cognitive-run.lock`);
      const record = compass.getGoal(); if (!record) throw Error("Current Goal required");
      const goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
      return await this.materialStore().prepare(goalId, goal, input, async () => {
        const checkpoint = await new CognitiveStateStore(this.options.stateRoot!, this.options.partition!).get(goalId);
        if (checkpoint && checkpoint.goal_digest !== cognitiveDigest(goal)) throw Error("Goal changed; explicit review required");
        const prior = await new CompassWorkStateStoreAdapter(compass).get(goalId);
        if (checkpoint?.execution_contract_digest || checkpoint?.pending_action || checkpoint?.learning_outbox ||
          checkpoint?.attempts.some(a => a.actionId !== "local:inspect" && !(a.actionId === "cognitive:inspect" && a.source === "degraded")) || prior?.verificationResults.length || prior?.childWorkItems.length) throw Error("Existing work requires explicit review before material binding");
      });
    } finally { compass.close(); if (release) await release(); this.busy = false; }
  }
  async output(goalId: string, outputId: string) {
    await this.validateStateRoot();
    if (this.busy) throw Error("Cognitive cycle already running");
    const compass = new CompassStore(this.dbPath); let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireCognitiveLease(`${this.dbPath}.cognitive-run.lock`);
      const record = compass.getGoal(); if (!record) throw Error("Current Goal required");
      const goal = compassGoalToLoopGoal(record); if (goalWorkStateId(goal) !== goalId) throw Error("Current Goal changed");
      const state = await new CognitiveStateStore(this.options.stateRoot!, this.options.partition!).get(goalId);
      const contract = await loadCognitiveRuntimeWork(this.options, goalId, goal);
      if (!state || state.goal_digest !== cognitiveDigest(goal) || !contract || state.execution_contract_digest !== contract.contractDigest) throw Error("Output must be independently verified first");
      return await this.materialStore().output(goalId, goal, outputId, state.attempts.filter(a => a.verified).map(a => a.actionId));
    } finally { compass.close(); if (release) await release(); }
  }
  async importHistory() {
    await this.validateStateRoot();
    if (this.busy) throw Error("Cognitive cycle already running");
    if (!this.options.historyImport) throw Error("Historical import is not configured");
    this.busy = true;
    try { return await this.history.importManifest(this.options.historyImport.manifestPath, this.options.historyImport.dataRoot, this.options.partition!); }
    finally { this.busy = false; }
  }
  async trainingCandidate() { await this.validateStateRoot(); return this.history.trainingDataset(this.learning, this.options.partition!, { scope: "owner" }); }
}
