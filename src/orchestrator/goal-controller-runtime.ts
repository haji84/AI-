import { createHash } from "node:crypto";
import type { Goal } from "./goal-loop.ts";
import type { WorkState, WorkStateStore } from "./work-state.ts";
import { assessCompletionPath, type CompletionInput, type CompletionCycle } from "./completion-path.ts";

export type IntakeIntent = "QUESTION" | "INSPECTION" | "COMMAND" | "DEVELOPMENT_TASK" | "GOAL";
export type IntakeSource = "chat" | "codex" | "jarvis" | "device" | "github" | "event" | "other";

export interface GoalContractSeed {
  successCriteria: string[];
  constraints?: string[];
}

export interface UnifiedIntakeRequest {
  id?: string;
  source: IntakeSource;
  text: string;
  sourceContext?: Record<string, unknown>;
  idempotencyKey?: string;
  goalHint?: string;
  goalContract?: GoalContractSeed;
}

export interface NormalizedIntake {
  id: string;
  source: IntakeSource;
  text: string;
  sourceContext: Record<string, unknown>;
  idempotencyKey: string;
  goalHint?: string;
  goalContract?: GoalContractSeed;
}

export interface ActiveGoal {
  goal: Goal;
  goalId: string;
  workState?: WorkState | null;
}

export type GoalResolutionKind =
  | "NO_GOAL"
  | "STANDALONE_ACTION"
  | "EXISTING_GOAL"
  | "GOAL_CHANGE_REQUEST"
  | "NEW_GOAL";

export interface GoalResolution {
  kind: GoalResolutionKind;
  intent: IntakeIntent;
  intake: NormalizedIntake;
  goal?: ActiveGoal;
  reason: string;
}

export interface GoalRegistry {
  listActive(): Promise<ActiveGoal[]>;
  create(input: { title: string; description: string; successCriteria: string[]; constraints: string[] }): Promise<ActiveGoal>;
}

export interface GoalDecisionStore {
  get(idempotencyKey: string): Promise<GoalControllerDecision | null>;
  put(idempotencyKey: string, decision: GoalControllerDecision): Promise<void>;
  /** A durable authority may bind Goal creation and its intake decision atomically. */
  createGoalAndPut?(
    registry: GoalRegistry,
    input: Parameters<GoalRegistry["create"]>[0],
    decisionForGoal: (goal: ActiveGoal) => GoalControllerDecision,
  ): Promise<GoalControllerDecision>;
}

export interface ClassifierCapability {
  classify(input: NormalizedIntake): Promise<IntakeIntent>;
}

export interface GoalControllerDecision {
  resolution: GoalResolution;
  action: "ANSWER" | "INSPECT" | "EXECUTE_BOUNDED" | "CONTINUE_GOAL";
  goalId?: string;
  nextAction?: string | null;
  remainingCriteria?: string[];
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

export function normalizeIntake(input: UnifiedIntakeRequest): NormalizedIntake {
  const text = input.text.trim();
  if (!text) throw new Error("intake text must not be empty");
  const sourceContext = input.sourceContext ?? {};
  let goalContract: GoalContractSeed | undefined;
  if (input.goalContract !== undefined) {
    const criteria = input.goalContract.successCriteria;
    const constraints = input.goalContract.constraints ?? [];
    const bounded = (values: string[]) => Array.isArray(values)
      && values.length <= 16
      && values.every((value) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 500)
      && new Set(values.map((value) => value.trim())).size === values.length;
    if (!bounded(criteria) || criteria.length < 1 || !bounded(constraints)) throw new Error("goal contract is invalid or unbounded");
    goalContract = { successCriteria: criteria.map((value) => value.trim()), constraints: constraints.map((value) => value.trim()) };
  }
  const idempotencyKey = input.idempotencyKey?.trim()
    || digest(JSON.stringify({ source: input.source, text, sourceContext, goalHint: input.goalHint ?? null, goalContract: goalContract ?? null }));
  return {
    id: input.id?.trim() || `intake-${digest(idempotencyKey)}`,
    source: input.source,
    text,
    sourceContext,
    idempotencyKey,
    goalHint: input.goalHint?.trim() || undefined,
    goalContract,
  };
}

/** Entry-point changes may replay a request; changed work must use a new key. */
export function assertIntakeReplayMatches(decision: GoalControllerDecision, intake: NormalizedIntake): void {
  const accepted = decision.resolution.intake;
  const sameTarget = !intake.goalHint || intake.goalHint === accepted.goalHint
    || intake.goalHint === decision.goalId || intake.goalHint === decision.resolution.goal?.goal.title;
  if (intake.text !== accepted.text || !sameTarget
    || JSON.stringify(intake.goalContract ?? null) !== JSON.stringify(accepted.goalContract ?? null)) {
    throw new Error("INTAKE_IDEMPOTENCY_CONFLICT");
  }
}

const questionPattern = /[?？]$|^(what|why|how|when|where|who|is|are|can|could|would|should)\b|^(何|なぜ|どう|いつ|どこ|誰|教えて|意味)/i;
const inspectPattern = /(確認|調べ|見て|inspect|check|investigate|analy[sz]e|review)/i;
const goalPattern = /(完成|最後まで|実現|作り切|自律|finish|complete|deliver|make .* work|build .* end.?to.?end)/i;
const developmentPattern = /(実装|修正|直して|追加|変更|開発|implement|fix|refactor|add |change |develop)/i;
const commandPattern = /(実行|削除|起動|停止|送信|run |delete|start|stop|send)/i;

export function deterministicIntent(input: NormalizedIntake): IntakeIntent | null {
  if (input.goalContract) return "GOAL";
  const text = input.text;
  if (questionPattern.test(text) && !developmentPattern.test(text) && !goalPattern.test(text)) return "QUESTION";
  if (goalPattern.test(text)) return "GOAL";
  if (developmentPattern.test(text)) return "DEVELOPMENT_TASK";
  if (inspectPattern.test(text)) return "INSPECTION";
  if (commandPattern.test(text)) return "COMMAND";
  return null;
}

export async function classifyIntent(input: NormalizedIntake, capability?: ClassifierCapability): Promise<IntakeIntent> {
  const deterministic = deterministicIntent(input);
  if (deterministic) return deterministic;
  if (capability) return capability.classify(input);
  return "COMMAND";
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 2));
}

function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.max(left.size, right.size);
}

function goalText(active: ActiveGoal): string {
  return [active.goal.title, active.goal.description ?? "", ...active.goal.successCriteria].join(" ");
}

export class GoalResolver {
  private readonly registry: GoalRegistry;
  constructor(registry: GoalRegistry) { this.registry = registry; }

  async resolve(intake: NormalizedIntake, intent: IntakeIntent): Promise<GoalResolution> {
    if (intent === "QUESTION" || intent === "INSPECTION") {
      return { kind: "NO_GOAL", intent, intake, reason: "informational_intent" };
    }
    const active = await this.registry.listActive();
    const hinted = intake.goalHint
      ? active.find((entry) => entry.goalId === intake.goalHint || entry.goal.title === intake.goalHint)
      : undefined;
    const ranked = active
      .map((entry) => ({ entry, score: similarity(intake.text, goalText(entry)) }))
      .sort((a, b) => b.score - a.score);
    const match = hinted ?? (ranked[0]?.score >= 0.25 ? ranked[0].entry : undefined);

    if (match) {
      if (intake.goalContract && (
        JSON.stringify(intake.goalContract.successCriteria) !== JSON.stringify(match.goal.successCriteria)
        || JSON.stringify(intake.goalContract.constraints ?? []) !== JSON.stringify(match.goal.constraints)
      )) throw new Error("GOAL_CONTRACT_CONFLICT: explicitly change the accepted Goal before supplying different obligations");
      const goalChange = /(goal|ゴール|目的).*(変更|変え|change|replace)/i.test(intake.text);
      return {
        kind: goalChange ? "GOAL_CHANGE_REQUEST" : "EXISTING_GOAL",
        intent,
        intake,
        goal: match,
        reason: hinted ? "explicit_goal_hint" : "active_goal_similarity",
      };
    }
    if (intent === "GOAL") {
      // Resolution is read-only: the controller commits creation with its
      // durable intake decision when the authority supports that transaction.
      return { kind: "NEW_GOAL", intent, intake, reason: "new_goal_intent" };
    }
    return { kind: "STANDALONE_ACTION", intent, intake, reason: "no_related_active_goal" };
  }
}

function decisionFromResolution(resolution: GoalResolution, state?: WorkState | null): GoalControllerDecision {
  if (resolution.kind === "NO_GOAL") {
    return { resolution, action: resolution.intent === "INSPECTION" ? "INSPECT" : "ANSWER" };
  }
  if (resolution.kind === "STANDALONE_ACTION") return { resolution, action: "EXECUTE_BOUNDED" };
  const remainingCriteria = state
    ? state.definitionOfDone.filter((item) => !state.verificationResults.some((r) => r.itemId === item.id && (r.passed || r.waived))).map((item) => item.id)
    : resolution.goal?.goal.successCriteria.map((_, index) => `criterion-${index + 1}`) ?? [];
  return { resolution, action: "CONTINUE_GOAL", goalId: resolution.goal?.goalId,
    nextAction: state?.nextAction ?? null, remainingCriteria };
}

export class GoalControllerRuntime {
  private readonly resolver: GoalResolver;
  private readonly registry: GoalRegistry;
  private readonly classifier?: ClassifierCapability;
  private readonly workStateStore?: WorkStateStore;
  private readonly decisionStore?: GoalDecisionStore;
  private readonly seen = new Map<string, GoalControllerDecision>();

  /** Explicit inspection only; does not dispatch, mutate Goal or commit nextAction. */
  async inspectCompletionPath(input: CompletionInput, history: CompletionCycle[] = []): Promise<CompletionCycle> {
    const state = await this.workStateStore?.get(input.goalId);
    if (!state) throw Error("completion inspection requires existing WorkState");
    return assessCompletionPath(state, input, history);
  }

  constructor(input: { registry: GoalRegistry; classifier?: ClassifierCapability; workStateStore?: WorkStateStore; decisionStore?: GoalDecisionStore }) {
    this.registry = input.registry;
    this.resolver = new GoalResolver(input.registry);
    this.classifier = input.classifier;
    this.workStateStore = input.workStateStore;
    this.decisionStore = input.decisionStore;
  }

  async handle(request: UnifiedIntakeRequest): Promise<GoalControllerDecision> {
    const intake = normalizeIntake(request);
    const existing = this.seen.get(intake.idempotencyKey) ?? await this.decisionStore?.get(intake.idempotencyKey) ?? undefined;
    if (existing) {
      assertIntakeReplayMatches(existing, intake);
      this.seen.set(intake.idempotencyKey, existing);
      return existing;
    }
    const intent = await classifyIntent(intake, this.classifier);
    const resolution = await this.resolver.resolve(intake, intent);

    if (resolution.kind === "NEW_GOAL") {
      const input = {
        title: intake.text.slice(0, 120),
        description: intake.text,
        successCriteria: intake.goalContract?.successCriteria ?? (developmentPattern.test(intake.text) ? [intake.text] : []),
        constraints: intake.goalContract?.constraints ?? [],
      };
      if (this.decisionStore?.createGoalAndPut) {
        const decision = await this.decisionStore.createGoalAndPut(this.registry, input,
          goal => decisionFromResolution({ ...resolution, goal }, goal.workState));
        this.seen.set(intake.idempotencyKey, decision);
        return decision;
      }
      resolution.goal = await this.registry.create(input);
    }
    const goalId = resolution.goal?.goalId;
    const state = goalId && this.workStateStore ? await this.workStateStore.get(goalId) : resolution.goal?.workState;
    const decision = decisionFromResolution(resolution, state);
    await this.decisionStore?.put(intake.idempotencyKey, decision);
    this.seen.set(intake.idempotencyKey, decision);
    return decision;
  }
}
