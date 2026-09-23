import { dirname, resolve } from "node:path";
import { CompassStore } from "../compass/store.ts";
import { compassGoalToLoopGoal } from "../orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../orchestrator/work-state-integration.ts";
import { CompassGoalExecutionAdapter, loadCognitiveRuntimeWork, type CognitiveRuntimeOptions } from "../orchestrator/compass-goal-execution-adapter.ts";
import { cognitiveDigest, CognitiveStateStore } from "./cognitive-state.ts";
import { CognitiveLearningEngine } from "./cognitive-learning.ts";
import { prepareCognitiveTrainingDataset } from "./cognitive-learning-data.ts";

/** Auth is enforced by Broker before this owner-local service. No tenant supplied by HTTP. */
export class CognitiveService {
  private readonly dbPath: string;
  private readonly options: CognitiveRuntimeOptions;
  private readonly learning: CognitiveLearningEngine;
  private busy = false;
  constructor(dbPath: string, options: CognitiveRuntimeOptions = {}) {
    this.dbPath = dbPath;
    this.options = { ...options, partition: options.partition ?? { tenantId: "local", principalId: "owner" },
      stateRoot: options.stateRoot ?? resolve(dirname(dbPath), "cognitive") };
    this.learning = new CognitiveLearningEngine(resolve(this.options.stateRoot!, "learning"));
  }
  async status() {
    const compass = new CompassStore(this.dbPath);
    try {
      const record = compass.getGoal();
      const goal = record ? compassGoalToLoopGoal(record) : null;
      const goalId = goal ? goalWorkStateId(goal) : null;
      const state = goalId ? await new CognitiveStateStore(this.options.stateRoot!, this.options.partition!).get(goalId) : null;
      const metrics = await this.learning.metrics(this.options.partition!);
      const localConfigured = Boolean(this.options.localWork || this.options.localOutcomes);
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
      return { goalId, goalTitle: goal?.title ?? null, busy: this.busy, goalComplete: !configurationBlocker && (!localConfigured || Boolean(state?.execution_contract_digest)) && compass.getState().status === "goal_complete",
        mode: configurationBlocker ? "DEGRADED" : state?.mode ?? "READY", attempts: state?.attempts.length ?? 0,
        nextAction: state?.next_action ?? null, blockers: [...(state?.blockers ?? []), ...(configurationBlocker ? [configurationBlocker] : [])],
        confidence: state?.confidence ?? null, updatedAt: state?.updated_at ?? null,
        externalAIEnabled: this.options.allowExternalAI === true,
        recentAttempts: state?.attempts.slice(-16).map(a => ({ id: a.id, actionId: a.actionId, verified: a.verified, success: a.success })) ?? [],
        localActionsConfigured: localConfigured, metrics };
    } finally { compass.close(); }
  }
  async continue(goalId: string) {
    if (this.busy) throw Error("Cognitive cycle already running");
    if (typeof goalId !== "string" || !/^goal-[a-f0-9]{16}$/.test(goalId)) throw Error("Invalid Goal ID");
    this.busy = true;
    try {
      const report = await new CompassGoalExecutionAdapter(this.dbPath, {}, { ...this.options, learning: this.learning }).run(goalId, { maxCycles: 3 });
      return { stopReason: report.stopReason, cycles: report.cycles.length, goalEvaluation: report.goalEvaluation ?? null };
    } finally { this.busy = false; }
  }
  async correct(goalId: string, originalId: string, replacementId: string) {
    const snapshot = await this.status();
    if (snapshot.goalId !== goalId || this.busy) throw Error("Correction requires the current idle Goal");
    const state = await new CognitiveStateStore(this.options.stateRoot!, this.options.partition!).get(goalId);
    const original = state?.attempts.find(a => a.id === originalId);
    const replacement = state?.attempts.find(a => a.id === replacementId);
    if (!original || !replacement?.verified || !replacement.success || original.actionId === replacement.actionId || original.environment !== replacement.environment) throw Error("Correction needs distinct existing actions and a verified replacement");
    const id = "correction:" + cognitiveDigest({ goalId, originalId, replacementId }).slice(0, 32);
    await this.learning.recordCorrection({ id, partition: this.options.partition!, goalId, task: snapshot.goalTitle!, environment: replacement.environment,
      originalActionId: original.actionId, replacementActionId: replacement.actionId, evidenceRefs: replacement.evidenceRefs, verified: true, scope: "preference" });
    return { accepted: true, id };
  }
  async trainingCandidate() { return prepareCognitiveTrainingDataset(this.learning, this.options.partition!, { scope: "owner" }); }
}
