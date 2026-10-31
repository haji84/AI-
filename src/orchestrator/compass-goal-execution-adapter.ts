import { CognitiveMaterialIntake } from "../gai/cognitive-material-intake.ts";
import { acquireCognitiveLease } from "../gai/cognitive-lease.ts";
import { CognitiveLearningEngine } from "../gai/cognitive-learning.ts";
import { PersistentWorldModel } from "../gai/world-model.ts";
import { evaluationPlanDigest, type CognitiveEvaluationPlan } from "../gai/cognitive-evaluation.ts";
import { loadCognitiveLocalOutcomes, CognitiveLocalOutcomeCatalog } from "../gai/cognitive-local-outcomes.ts";
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
import { CognitiveCore, createCognitiveGoalLoop, cognitiveActionFingerprint, type CognitiveLearningBridge } from "../gai/cognitive-core.ts";
import { CognitiveStateStore, cognitiveDigest, type CognitivePartition } from "../gai/cognitive-state.ts";
import { configuredPrimaryBrain, type PrimaryBrainAdapter } from "../gai/primary-brain.ts";
import type { ResidentDevelopmentProgress } from "./resident-development-goal-host.ts";
import { residentDevelopmentGoalDigest } from "./resident-development-sequence.ts";
import type { DefinitionOfDoneResult, WorkState } from "./work-state.ts";
import type { CompletionSource } from './completion-execution.ts';

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
  /** Direct host option; no HTTP/model/environment split control. */
  evaluation?: { id: string };
  historyImport?: { manifestPath: string; dataRoot: string };
}

export interface DevelopmentGoalRuntime {
  matches(goal: Goal, context: unknown[]): boolean;
  run(input: { goalId: string; goal: Goal; context: ContextItem[] }): Promise<BoundedRunReport>;
  /** Explicit trusted host contract; generic runtime reports alone cannot certify criteria. */
  getVerifiedProgress?(input: { goalId: string; goal: Goal }): Promise<ResidentDevelopmentProgress | null>;
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

async function projectResidentProgress(compass: CompassStore, goalId: string, goal: Goal,
  report: BoundedRunReport, progress: ResidentDevelopmentProgress): Promise<BoundedRunReport> {
  const definitionOfDone = goal.successCriteria.map((description, index) => ({ id: `criterion-${index + 1}`, description, required: true }));
  const validIds = new Set(definitionOfDone.map(item => item.id));
  const completedIds = progress.completedJobs.flatMap(job => job.criterionIds);
  const reported = report.goalEvaluation?.verifiedRequired ?? [];
  if (progress.goalDigest !== residentDevelopmentGoalDigest(goal) || !/^[a-f0-9]{64}$/.test(progress.sequenceDigest)
    || new Set(completedIds).size !== completedIds.length || completedIds.some(id => !validIds.has(id))
    || JSON.stringify([...completedIds].sort()) !== JSON.stringify([...reported].sort())) throw Error("RESIDENT_PROGRESS_BINDING_MISMATCH");
  const store = new CompassWorkStateStoreAdapter(compass), prior = await store.get(goalId);
  if (prior && JSON.stringify(prior.definitionOfDone) !== JSON.stringify(definitionOfDone)) throw Error("RESIDENT_PROGRESS_GOAL_MISMATCH");
  const incoming: DefinitionOfDoneResult[] = progress.completedJobs.flatMap(job => job.criterionIds.map(id => {
    const acceptance = job.evidence.filter(item => item.criterionId === id && item.verified && item.sourceRevision && item.artifactDigest && item.issuer && item.recordedAt);
    if (!acceptance.length) throw Error("RESIDENT_PROGRESS_ACCEPTANCE_MISSING");
    return { itemId: id, passed: true, evidence: { kind: "resident-development-completed-job", sequenceDigest: progress.sequenceDigest,
      goalDigest: progress.goalDigest, jobId: job.jobId, acceptance } };
  }));
  for (const result of prior?.verificationResults ?? []) {
    const evidence = result.evidence as { kind?: string; sequenceDigest?: string; goalDigest?: string } | undefined;
    if (!incoming.some(item => item.itemId === result.itemId) || evidence?.kind !== "resident-development-completed-job"
      || evidence.sequenceDigest !== progress.sequenceDigest || evidence.goalDigest !== progress.goalDigest) throw Error("RESIDENT_PROGRESS_PRIOR_EVIDENCE_MISMATCH");
  }
  const canonicalBlockers = await new CompassStateStoreAdapter(compass).completionBlockers(goal);
  const blockers = [...new Set([...(prior?.blockers ?? []), ...canonicalBlockers, ...(report.goalEvaluation?.blockers ?? [])])];
  const incompleteChildren = prior?.childWorkItems.some(item => item.status !== "COMPLETED") ?? false;
  if (incompleteChildren) blockers.push("child_work_incomplete");
  const achieved = report.goalEvaluation?.achieved === true && completedIds.length === definitionOfDone.length && !blockers.length;
  const next: WorkState = { ...(prior ?? { goalId, objective: goal.description?.trim() || goal.title, definitionOfDone,
    riskClass: progress.maxRisk === "low" ? "R1" : progress.maxRisk === "medium" ? "R2" : progress.maxRisk === "high" ? "R3" : "R4",
    constraints: [...goal.constraints], decisions: [], artifacts: [], childWorkItems: [] }),
    currentState: achieved ? "All approved development Job criteria verified" : "Approved development Job progress persisted",
    status: blockers.length ? "BLOCKED" : achieved ? "COMPLETED" : "VERIFYING", verificationResults: incoming, blockers,
    nextAction: achieved ? null : report.goalEvaluation?.remainingGaps[0] ?? "Continue the next approved development Job",
    updatedAt: new Date().toISOString() };
  await store.put(next);
  const evaluation = evaluateGoalFromWorkState(next);
  return { ...report, stopReason: blockers.length && report.stopReason !== "approval_required" ? "blocked" : report.stopReason,
    goalEvaluation: { ...evaluation, achieved, remainingGaps: [...new Set([...(report.goalEvaluation?.remainingGaps ?? []), ...evaluation.remainingGaps])] } };
}

export class CompassGoalExecutionAdapter implements GoalExecutionAdapter {
  private readonly dbPath: string;
  private readonly goalLoopOptions: GoalLoopOptions;
  private readonly cognitiveOptions: CognitiveRuntimeOptions;
  private readonly developmentOptions?: DevelopmentRuntimeOptions;
  private readonly completionSource?: CompletionSource;
  constructor(
    dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(process.cwd(), ".compass", "compass.db"),
    goalLoopOptions: GoalLoopOptions = {},
    cognitiveOptions: CognitiveRuntimeOptions = {},
    developmentOptions?: DevelopmentRuntimeOptions,
    completionSource?: CompletionSource,
  ) {
    this.dbPath = dbPath;
    this.goalLoopOptions = goalLoopOptions;
    if (cognitiveOptions.useCore !== undefined && typeof cognitiveOptions.useCore !== "boolean") throw Error("Invalid Cognitive Core mode");
    if (cognitiveOptions.useCore !== true && Object.keys(cognitiveOptions).some(key => key !== "useCore")) throw Error("Cognitive options require explicit useCore opt-in");
    this.cognitiveOptions = cognitiveOptions;
    this.developmentOptions = developmentOptions;
    if (completionSource && (cognitiveOptions.useCore === true || developmentOptions)) throw Error('Completion integration requires a single selected execution controller');
    this.completionSource = completionSource;
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
        const runtime = this.developmentOptions.runtime;
        // Only the explicitly bound sequence participates in this preflight.
        // Read persisted completed progress without executing any candidate work.
        const before = await runtime.getVerifiedProgress?.({ goalId: authoritativeGoalId, goal });
        if (!before && compass.getState().status === "PAUSED") return { cycles: [], stopReason: "paused" };
        if (before) {
          const current = compass.getState();
          const prior = await new CompassWorkStateStoreAdapter(compass).get(authoritativeGoalId);
          const canonical = await new CompassStateStoreAdapter(compass).completionBlockers(goal);
          const blockers = [...new Set([...(prior?.blockers ?? []), ...canonical,
            ...current.blockers.filter((item): item is string => typeof item === "string")])];
          const paused = current.status === "PAUSED";
          if (paused || blockers.length) {
            const ids = goal.successCriteria.map((_, index) => `criterion-${index + 1}`);
            const completed = new Set(before.completedJobs.flatMap(job => job.criterionIds));
            if (before.goalDigest !== residentDevelopmentGoalDigest(goal) || [...completed].some(id => !ids.includes(id))) throw Error("RESIDENT_PROGRESS_BINDING_MISMATCH");
            return { cycles: [], stopReason: paused ? "paused" : "blocked", goalEvaluation: { achieved: false,
              verifiedRequired: ids.filter(id => completed.has(id)), failedRequired: [], unverifiedRequired: ids.filter(id => !completed.has(id)),
              blockers, remainingGaps: paused ? ["project_paused", ...blockers] : blockers } };
          }
        }
        const context = await Promise.all([
          contextSource.collect({ goal }),
          new EntryContextSource(input.context ?? []).collect(),
        ]);
        const report = await runtime.run({ goalId: authoritativeGoalId, goal, context: context.flat() });
        const progress = await runtime.getVerifiedProgress?.({ goalId: authoritativeGoalId, goal });
        return progress ? await projectResidentProgress(compass, authoritativeGoalId, goal, report, progress) : report;
      }
      if (compass.getState().status === "PAUSED") return { cycles: [], stopReason: "paused" };
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
          ...(this.completionSource ? { completion: { source: this.completionSource } } : {}),
          options: this.goalLoopOptions,
        });
        const report = await runBoundedGoalLoop(loop, goal, { maxCycles: input.maxCycles ?? 3 });
        const workState = await workStateStore.get(authoritativeGoalId);
        return workState ? { ...report, goalEvaluation: evaluateGoalFromWorkState(workState) } : report;
      }
      const localWork = await loadCognitiveRuntimeWork({ ...this.cognitiveOptions, stateRoot: this.cognitiveOptions.stateRoot ?? resolve(dirname(this.dbPath), "cognitive"), partition: this.cognitiveOptions.partition ?? { tenantId: "local", principalId: "owner" } }, authoritativeGoalId, goal);
      localWork?.register(registry);
      const verifier = localWork instanceof CognitiveLocalOutcomeCatalog ? localWork.verifier(createRuntimeDevelopmentVerifier(), Boolean(this.cognitiveOptions.evaluation)) : localWork?.verifier(createRuntimeDevelopmentVerifier()) ?? createRuntimeDevelopmentVerifier();
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
      const descriptor = localWork instanceof CognitiveLocalOutcomeCatalog ? localWork.evaluationDescriptor() : undefined;
      let evaluationPlan: CognitiveEvaluationPlan | undefined;
      const current = await state.get(authoritativeGoalId);
      const reserved = learning instanceof CognitiveLearningEngine ? await learning.evaluationReservation(partition, authoritativeGoalId, this.cognitiveOptions.evaluation?.id) : null;
      if ((current?.evaluation_plan_digest || reserved) && !this.cognitiveOptions.evaluation) throw Error("Evaluation allocation changed; original host plan required");
      if (this.cognitiveOptions.evaluation) {
        if (!descriptor || !(learning instanceof CognitiveLearningEngine) || Object.keys(this.cognitiveOptions.evaluation).some(k => k !== "id")) throw Error("Evaluation requires existing local outcome catalog and private learning ledger");
        const prior = await workStateStore.get(authoritativeGoalId);
        if (!current?.evaluation_plan_digest && (current?.attempts.length || current?.pending_action || current?.learning_outbox || prior?.verificationResults.length || prior?.childWorkItems.length)) throw Error("Evaluation allocation requires pristine history");
        const pairedDescriptor = reserved?.comparison && localWork instanceof CognitiveLocalOutcomeCatalog ? await localWork.skillEvaluationDescriptor() : undefined;
        const proposedPlan: CognitiveEvaluationPlan = { version: 1, id: this.cognitiveOptions.evaluation.id, partition,
          goalId: authoritativeGoalId, goalDigest: cognitiveDigest(goal), environment: this.cognitiveOptions.environment ?? `${process.platform}:local`,
          contractDigest: contract!, materialSha256: descriptor.materialSha256,
          actions: descriptor.candidates.map(c => ({ actionId: c.id, fingerprint: cognitiveActionFingerprint({ ...c.action, completesBoundedCommand: false }), ...(pairedDescriptor ? { artifacts: pairedDescriptor.artifacts[c.id] } : {}) })), oracle: "local-source-derived-exact-v1",
          ...(reserved?.comparison ? { comparison: reserved.comparison } : {}) };
        if (reserved?.comparison) {
          const subject = await learning.localSkillSubject(partition, reserved.comparison.skillId);
          if (subject.skillDigest !== reserved.comparison.skillDigest || evaluationPlanDigest(proposedPlan) !== evaluationPlanDigest(reserved)) throw Error("Matched evaluation subject or plan changed");
          evaluationPlan = reserved;
        } else evaluationPlan = await learning.allocateEvaluation(proposedPlan);
        const digest = evaluationPlanDigest(evaluationPlan);
        if (current?.evaluation_plan_digest && current.evaluation_plan_digest !== digest) throw Error("Evaluation plan changed");
        if (current && !current.evaluation_plan_digest) await state.save({ ...current, evaluation_plan_digest: digest }, current.revision);
      }
      const core = new CognitiveCore({
        goalId: authoritativeGoalId, partition,
        state,
        environment: this.cognitiveOptions.environment ?? `${process.platform}:local`,
        brain: this.cognitiveOptions.brain ?? configuredPrimaryBrain(),
        learning,
        evaluationPlan,
        evaluationVerifier: evaluationPlan ? verifier : undefined,
        materialSha256: descriptor?.materialSha256,
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
