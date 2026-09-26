import { CognitiveMaterialIntake } from "../gai/cognitive-material-intake.ts";
import { acquireCognitiveLease } from "../gai/cognitive-lease.ts";
import { CognitiveLearningEngine } from "../gai/cognitive-learning.ts";
import { PersistentWorldModel } from "../gai/world-model.ts";
import { loadCognitiveLocalOutcomes } from "../gai/cognitive-local-outcomes.ts";
import { loadCognitiveLocalWork } from "../gai/cognitive-local-work.ts";
import { resolve, dirname } from "node:path";
import { CompassStore } from "../compass/store.ts";
import { BaselinePlanner, createContextInspectCapability } from "./baseline-planner.ts";
import { RuntimeDevelopmentPlanner } from "./runtime-development-planner.ts";
import { createCodeBuilderCapability, createRuntimeBuilderRouter } from "./runtime-builder-capability.ts";
import { runBoundedGoalLoop, type BoundedRunReport } from "./bounded-runner.ts";
import { CapabilityRegistry } from "./capabilities.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "./compass-state-store.ts";
import { CompassWorkStateStoreAdapter } from "./compass-work-state-store.ts";
import { evaluateGoalFromWorkState } from "./goal-evaluator.ts";
import type { ContextItem, ContextSource, GoalLoopOptions, Goal } from "./goal-loop.ts";
import { createRuntimeDevelopmentVerifier } from "./runtime-development-verifier.ts";
import type { GoalExecutionAdapter } from "./goal-controller-execution-bridge.ts";
import { createWorkStateIntegratedGoalLoop, goalWorkStateId, type WorkStateAction } from "./work-state-integration.ts";
import { CognitiveCore, createCognitiveGoalLoop, type CognitiveLearningBridge } from "../gai/cognitive-core.ts";
import { CognitiveStateStore, cognitiveDigest, type CognitivePartition } from "../gai/cognitive-state.ts";
import { configuredPrimaryBrain, type PrimaryBrainAdapter } from "../gai/primary-brain.ts";

export interface CognitiveRuntimeOptions {
  /** Explicit host opt-in; absent preserves the existing development execution path. */
  useCore?: boolean;
  stateRoot?: string;
  partition?: CognitivePartition;
  environment?: string;
  brain?: PrimaryBrainAdapter;
  learning?: CognitiveLearningBridge;
  allowExternalAI?: boolean;
  localWork?: { manifestPath: string; dataRoot: string };
  localOutcomes?: { manifestPath: string; dataRoot: string };
  materialIntake?: { dataRoot: string };
  historyImport?: { manifestPath: string; dataRoot: string };
}

export interface DevelopmentGoalRuntime {
  matches(goal: Goal, context: unknown[]): boolean;
  run(input: { goalId: string; goal: Goal; context: ContextItem[] }): Promise<BoundedRunReport>;
}

export interface DevelopmentRuntimeOptions {
  /** Explicit host opt-in; absent preserves the existing Builder path. */
  runtime: DevelopmentGoalRuntime;
}

/** Host-selected catalog shared by execution and read-only status validation. */
export async function loadCognitiveRuntimeWork(options: CognitiveRuntimeOptions, goalId: string, goal: Goal) {
  if ([options.localWork, options.localOutcomes, options.materialIntake].filter(Boolean).length > 1) throw Error("Choose one local work contract");
  if (options.materialIntake) {
    if (!options.stateRoot || !options.partition) throw Error("Material intake state scope required");
    return (await new CognitiveMaterialIntake(options.stateRoot, options.materialIntake.dataRoot, options.partition).load(goalId, goal))?.catalog;
  }
  if (options.localOutcomes) return loadCognitiveLocalOutcomes(options.localOutcomes.manifestPath, options.localOutcomes.dataRoot, goalId, goal);
  if (options.localWork) return loadCognitiveLocalWork(options.localWork.manifestPath, options.localWork.dataRoot, goalId, goal);
  return undefined;
}

class EntryContextSource implements ContextSource {
  readonly name = "unified-entry-context";
  private readonly items: ContextItem[];
  constructor(values: unknown[]) {
    this.items = values.map((value, index) => ({
      source: `unified-entry:${index + 1}`,
      summary: typeof value === "object" && value && "summary" in value ? String((value as { summary: unknown }).summary) : String(value),
      data: value,
    }));
  }
  async collect(): Promise<ContextItem[]> { return this.items; }
}

export class CompassGoalExecutionAdapter implements GoalExecutionAdapter {
  private readonly dbPath: string;
  private readonly goalLoopOptions: GoalLoopOptions;
  private readonly cognitiveOptions: CognitiveRuntimeOptions;
  private readonly developmentOptions?: DevelopmentRuntimeOptions;
  constructor(
    dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(process.cwd(), ".compass", "compass.db"),
    goalLoopOptions: GoalLoopOptions = {},
    cognitiveOptions: CognitiveRuntimeOptions = {},
    developmentOptions?: DevelopmentRuntimeOptions,
  ) {
    this.dbPath = dbPath;
    this.goalLoopOptions = goalLoopOptions;
    if (cognitiveOptions.useCore !== undefined && typeof cognitiveOptions.useCore !== "boolean") throw Error("Invalid Cognitive Core mode");
    if (cognitiveOptions.useCore !== true && Object.keys(cognitiveOptions).some(key => key !== "useCore")) throw Error("Cognitive options require explicit useCore opt-in");
    this.cognitiveOptions = cognitiveOptions;
    this.developmentOptions = developmentOptions;
  }

  async run(goalId: string, input: { maxCycles?: number; context?: unknown[] } = {}): Promise<BoundedRunReport> {
    if (this.cognitiveOptions.localWork && this.cognitiveOptions.localOutcomes) throw Error("Choose one local work contract");
    const compass = new CompassStore(this.dbPath);
    let releaseLease: (() => Promise<void>) | undefined;
    const leasePath = `${this.dbPath}.cognitive-run.lock`;
    try {
      if (this.cognitiveOptions.useCore === true) releaseLease = await acquireCognitiveLease(leasePath);
      const record = compass.getGoal();
      if (!record) throw new Error("Compass goal is not set");
      const goal = compassGoalToLoopGoal(record);
      const authoritativeGoalId = goalWorkStateId(goal);
      if (goalId !== authoritativeGoalId) {
        throw new Error(`Goal Controller goal mismatch: requested=${goalId} authoritative=${authoritativeGoalId}`);
      }

      const contextSource: ContextSource = {
        name: "compass-state",
        async collect() {
          const state = compass.getState();
          return [
            { source: "state.status", summary: state.status ?? "unknown" },
            { source: "state.next_action", summary: state.nextAction ?? "none" },
            { source: "state.blockers", summary: JSON.stringify(state.blockers) },
          ];
        },
      };
      if (this.developmentOptions?.runtime.matches(goal, input.context ?? [])) {
        const context = await Promise.all([
          contextSource.collect({ goal }),
          new EntryContextSource(input.context ?? []).collect({ goal }),
        ]);
        return this.developmentOptions.runtime.run({ goalId: authoritativeGoalId, goal, context: context.flat() });
      }
      const registry = new CapabilityRegistry()
        .register(createContextInspectCapability())
        .register(createCodeBuilderCapability(createRuntimeBuilderRouter()));
      // Preserve the pre-Cognitive runtime contract for existing callers, including
      // the Builder recovery smoke. Only the owner Cognitive service opts in below.
      if (this.cognitiveOptions.useCore !== true) {
        const workStateStore = new CompassWorkStateStoreAdapter(compass);
        const loop = createWorkStateIntegratedGoalLoop({
          goal,
          planner: new RuntimeDevelopmentPlanner(new BaselinePlanner()),
          contextSources: [contextSource, new EntryContextSource(input.context ?? [])],
          executor: registry,
          verifier: createRuntimeDevelopmentVerifier(),
          stateStore: new CompassStateStoreAdapter(compass),
          workStateStore,
          options: this.goalLoopOptions,
        });
        const report = await runBoundedGoalLoop(loop, goal, { maxCycles: input.maxCycles ?? 3 });
        const workState = await workStateStore.get(authoritativeGoalId);
        return workState ? { ...report, goalEvaluation: evaluateGoalFromWorkState(workState) } : report;
      }
      const localWork = await loadCognitiveRuntimeWork({ ...this.cognitiveOptions, stateRoot: this.cognitiveOptions.stateRoot ?? resolve(dirname(this.dbPath), "cognitive"), partition: this.cognitiveOptions.partition ?? { tenantId: "local", principalId: "owner" } }, authoritativeGoalId, goal);
      localWork?.register(registry);
      const verifier = localWork?.verifier(createRuntimeDevelopmentVerifier()) ?? createRuntimeDevelopmentVerifier();
      const workStateStore = new CompassWorkStateStoreAdapter(compass);
      const fallback = new RuntimeDevelopmentPlanner(new BaselinePlanner());
      const partition = this.cognitiveOptions.partition ?? { tenantId: "local", principalId: "owner" };
      const stateRoot = this.cognitiveOptions.stateRoot ?? resolve(dirname(this.dbPath), "cognitive");
      const state = new CognitiveStateStore(stateRoot, partition);
      // Bind before reconciliation, completion or any authoritative write. Old PASS cannot
      // certify a new source, target, root or host contract under an unchanged Goal ID.
      const checkpoint = await state.initialize(authoritativeGoalId, goal);
      const contract = localWork?.contractDigest ?? null;
      if (checkpoint.execution_contract_digest && checkpoint.execution_contract_digest !== contract) throw Error("Cognitive execution contract changed; explicit replanning required");
      if (contract && !checkpoint.execution_contract_digest) {
        const prior = await workStateStore.get(authoritativeGoalId);
        const observationsOnly = checkpoint.attempts.every(a => a.actionId === "local:inspect" || (a.actionId === "cognitive:inspect" && a.source === "degraded"));
        if (!observationsOnly || checkpoint.pending_action || checkpoint.learning_outbox || prior?.verificationResults.length || prior?.childWorkItems.length) throw Error("Cognitive unbound execution history requires explicit review");
        await state.save({ ...checkpoint, execution_contract_digest: contract }, checkpoint.revision);
      }
      const learning = this.cognitiveOptions.learning ?? new CognitiveLearningEngine(resolve(stateRoot, "learning"));
      const core = new CognitiveCore({
        goalId: authoritativeGoalId, partition,
        state,
        environment: this.cognitiveOptions.environment ?? `${process.platform}:local`,
        brain: this.cognitiveOptions.brain ?? configuredPrimaryBrain(),
        learning,
        world: learning instanceof CognitiveLearningEngine ? new PersistentWorldModel(learning.partitionPath(partition, "world.json")) : undefined,
        allowExternal: this.cognitiveOptions.allowExternalAI === true,
        connectivity: this.cognitiveOptions.allowExternalAI === true ? "online" : "unknown",
        expert: this.cognitiveOptions.allowExternalAI === true ? {
          id: "registered-code-builder",
          async eligible(c) { return c.candidates.some(a => a.id.startsWith("builder:")); },
          async suggest(c) { return { candidateId: c.candidates.find(a => a.id.startsWith("builder:"))?.id ?? null, assessment: "Use already configured coding capability as optional expert", hypotheses: [], expectedOutcome: "Builder creates output for independent verification", confidence: 0.5, requiredEvidence: ["development-verifier"], recoveryOptions: ["local-inspection"], escalation: "none" }; },
        } : undefined,
        async candidates(input) {
          const current = await state.get(authoritativeGoalId);
          const localCandidates = await localWork?.candidates(current?.attempts.filter(a => a.verified).map(a => a.actionId) ?? []);
          if (localWork) return localCandidates ?? [];
          const intent = await fallback.inferIntent(input);
          const proposal = await fallback.proposeNextAction({ ...input, intent });
          const inspection = { id: "local:inspect", kind: "research" as const, action: { id: "cognitive-local-inspect", capability: "context.inspect", description: `Inspect local evidence for ${goal.title}`, risk: "low" as const }, expectedOutcome: "Identify available local evidence and missing capabilities", evidenceRequired: ["local-context"] };
          if (!proposal || proposal.capability !== "code.builder") return [inspection];
          // Attempt timestamps must not become strategy identity or evade failure recall.
          const builder = proposal.input as { objective?: string; files?: string[] };
          return [inspection, { id: `builder:${cognitiveDigest({ capability: proposal.capability, objective: builder.objective, files: builder.files }).slice(0, 24)}`, kind: "experiment" as const, action: proposal, requiresExternalAI: true, expectedOutcome: "Requested implementation satisfies independent verifier", evidenceRequired: ["development-verifier"] }];
        },
        async completion(currentState, currentGoal) {
          if (localWork && !localWork.completionSatisfied(currentState.attempts.filter(a => a.verified).map(a => a.actionId))) return false;
          const work = await workStateStore.get(authoritativeGoalId);
          return currentGoal.successCriteria.length > 0 && Boolean(work && work.childWorkItems.every(item => item.status === "COMPLETED") && evaluateGoalFromWorkState(work).achieved);
        },
      });
      const loop = createCognitiveGoalLoop({
        core,
        goal,
        contextSources: [contextSource, new EntryContextSource(input.context ?? [])],
        executor: registry,
        verifier,
        stateStore: new CompassStateStoreAdapter(compass),
        workStateStore,
        options: this.goalLoopOptions,
      });
      const pending = await state.get(authoritativeGoalId);
      if (pending?.pending_action && localWork) {
        const registered = await localWork.candidates(pending.attempts.filter(a => a.verified).map(a => a.actionId));
        const candidate = registered.find(c => c.id === pending.pending_action!.actionId);
        if (candidate) {
          const result = { actionId: candidate.action.id, ok: true, summary: "Local artifact outcome recovered by independent readback" };
          const verification = await verifier.verify({ goal, action: candidate.action, result, context: [] });
          if (verification.ok) {
            const bound = candidate.action as WorkStateAction;
            const work = await workStateStore.get(authoritativeGoalId);
            const child = work?.childWorkItems.find(item => item.id === "action-" + bound.id);
            if (!bound.materialMutation || (child?.objective === bound.description && child.affectedScope.length === 1 && child.affectedScope[0] === bound.capability)) {
              const recovered = bound.materialMutation ? { ...candidate, action: { ...bound, workItemId: child!.id, completesWorkItem: true } } : candidate;
              await core.reconcileVerifiedAction(recovered, goal, result, verification);
            }
          }
        }
      }
      const report = await runBoundedGoalLoop(loop, goal, { maxCycles: input.maxCycles ?? 3 });
      const workState = await workStateStore.get(authoritativeGoalId);
      if (!workState) return report;
      const evaluation = evaluateGoalFromWorkState(workState);
      const cognitive = await state.get(authoritativeGoalId);
      const completionGaps = await new CompassStateStoreAdapter(compass).completionBlockers(goal);
      if (localWork && !localWork.completionSatisfied(cognitive?.attempts.filter(a => a.verified).map(a => a.actionId) ?? [])) completionGaps.push("local_contract_outputs_incomplete");
      if (workState.childWorkItems.some(item => item.status !== "COMPLETED")) completionGaps.push("child_work_incomplete");
      if (!goal.successCriteria.length) completionGaps.push("definition_of_done_required");
      if (cognitive?.learning_outbox) completionGaps.push("learning_write_pending");
      if (cognitive?.pending_action) completionGaps.push("action_outcome_unknown_reconciliation_required");
      return { ...report,
        stopReason: completionGaps.length && report.stopReason === "goal_complete" ? "blocked" : report.stopReason,
        goalEvaluation: { ...evaluation, achieved: evaluation.achieved && completionGaps.length === 0,
          blockers: [...evaluation.blockers, ...completionGaps], remainingGaps: [...evaluation.remainingGaps, ...completionGaps] } };
    } finally {
      compass.close();
      if (releaseLease) await releaseLease();
    }
  }
}
