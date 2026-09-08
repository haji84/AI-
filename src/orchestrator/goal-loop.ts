import { createApprovalKey } from "./approval-key.ts";
import {
  evaluateRecovery,
  type FailureClass,
  type RecoveryDecision,
} from "./recovery-policy.ts";
import {
  evaluateRiskPolicy,
  type MediumRiskChecks,
  type RiskDecision,
  type RiskSignals,
} from "./risk-policy.ts";

export type RiskLevel = "low" | "medium" | "high";
export type StopReason = "goal_complete" | "blocked" | "approval_required" | "paused" | "retry_exhausted" | "continue";

export interface Goal {
  title: string;
  description?: string;
  successCriteria: string[];
  constraints: string[];
}

export interface IntentEvidence {
  source: "goal" | "constraint" | "preference" | "recent_decision" | "context";
  text: string;
}

export interface InferredIntent {
  summary: string;
  confidence: number;
  evidence: IntentEvidence[];
}

export interface ContextItem {
  source: string;
  summary: string;
  data?: unknown;
}

export interface ContextSource {
  name: string;
  collect(input: { goal: Goal; nextAction?: string | null }): Promise<ContextItem[]>;
}

export interface ProposedAction {
  id: string;
  description: string;
  capability: string;
  risk: RiskLevel;
  irreversible?: boolean;
  externalSideEffect?: boolean;
  requiresHumanApproval?: boolean;
  completesBoundedCommand?: boolean;
  riskSignals?: RiskSignals;
  mediumRiskChecks?: MediumRiskChecks;
  input?: unknown;
}

export interface ActionResult {
  actionId: string;
  ok: boolean;
  summary: string;
  evidence?: unknown;
  blocker?: string;
}

export interface VerificationResult {
  ok: boolean;
  summary: string;
  evidence?: unknown;
}

export interface CapabilityExecutor {
  execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult>;
}

export interface Planner {
  readonly supersedesPriorExecutionState?: boolean;
  inferIntent(input: {
    goal: Goal;
    context: ContextItem[];
    preferences?: string[];
    recentDecisions?: string[];
  }): Promise<InferredIntent>;
  proposeNextAction(input: {
    goal: Goal;
    context: ContextItem[];
    intent: InferredIntent;
    previousResult?: ActionResult | null;
  }): Promise<ProposedAction | null>;
}

export interface Verifier {
  verify(input: {
    goal: Goal;
    action: ProposedAction;
    result: ActionResult;
    context: ContextItem[];
  }): Promise<VerificationResult>;
}

export interface LoopState {
  paused?: boolean;
  retriesForCurrentAction?: number;
  completed: string[];
  blockers: string[];
  nextAction?: string | null;
}

export interface WriteBackRecord {
  goal: Goal;
  intent: InferredIntent;
  action?: ProposedAction | null;
  result?: ActionResult | null;
  verification?: VerificationResult | null;
  riskDecision?: RiskDecision | null;
  recoveryDecision?: RecoveryDecision | null;
  approvalKey?: string | null;
  approvalSatisfied?: boolean;
  stopReason: StopReason;
  nextAction?: string | null;
}

export interface StateStore {
  getState(): Promise<LoopState>;
  writeBack(record: WriteBackRecord): Promise<void>;
}

export interface ApprovalPolicy {
  requiresApproval(action: ProposedAction): boolean;
}

export class DefaultApprovalPolicy implements ApprovalPolicy {
  requiresApproval(action: ProposedAction): boolean {
    if (action.requiresHumanApproval) return true;
    if (action.irreversible) return true;
    if (action.risk === "high") return true;
    return false;
  }
}

export interface GoalLoopOptions {
  maxRetriesPerAction?: number;
  maxStrategyPivots?: number;
  maxTotalRecoveryAttempts?: number;
  approvedActionKey?: string | null;
}

export interface CycleReport extends WriteBackRecord {
  contextSources: string[];
}

interface RecoveryTracker {
  failureSignature: string;
  failureClass: FailureClass;
  attemptsForSignature: number;
  strategyPivots: number;
  totalAttempts: number;
}

function normalizeFailureSignature(result: ActionResult): string {
  const detail = (result.blocker || result.summary || "unknown-failure")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${result.actionId}:${detail}`;
}

function classifyFailure(result: ActionResult): FailureClass {
  if (result.blocker) return "environment";
  const text = result.summary.toLowerCase();
  if (/timeout|timed out|network|connection|rate limit|429|502|503|504|flaky|temporar/.test(text)) {
    return "transient";
  }
  if (/test|lint|build|compile|runtime|import|dependency|package|type|syntax|assert/.test(text)) {
    return "implementation";
  }
  return "unknown";
}

export class GoalDrivenLoop {
  private readonly planner: Planner;
  private readonly contextSources: ContextSource[];
  private readonly executor: CapabilityExecutor;
  private readonly verifier: Verifier;
  private readonly store: StateStore;
  private readonly policy: ApprovalPolicy;
  private readonly maxRetriesPerAction: number;
  private readonly maxStrategyPivots: number;
  private readonly maxTotalRecoveryAttempts: number;
  private readonly approvedActionKey: string | null;
  private readonly recoveryByAction = new Map<string, RecoveryTracker>();
  private approvalConsumed = false;
  private previousResult: ActionResult | null = null;

  constructor(
    planner: Planner,
    contextSources: ContextSource[],
    executor: CapabilityExecutor,
    verifier: Verifier,
    store: StateStore,
    policy: ApprovalPolicy = new DefaultApprovalPolicy(),
    options: GoalLoopOptions = {},
  ) {
    this.planner = planner;
    this.contextSources = contextSources;
    this.executor = executor;
    this.verifier = verifier;
    this.store = store;
    this.policy = policy;
    this.maxRetriesPerAction = options.maxRetriesPerAction ?? 3;
    this.maxStrategyPivots = options.maxStrategyPivots ?? 2;
    this.maxTotalRecoveryAttempts = options.maxTotalRecoveryAttempts ?? 9;
    this.approvedActionKey = options.approvedActionKey?.trim() || null;
  }

  async runCycle(input: {
    goal: Goal;
    preferences?: string[];
    recentDecisions?: string[];
  }): Promise<CycleReport> {
    const state = await this.store.getState();
    const supersedesPriorState = this.planner.supersedesPriorExecutionState === true;
    const context = (await Promise.all(
      this.contextSources.map((source) => source.collect({
        goal: input.goal,
        nextAction: supersedesPriorState ? null : state.nextAction,
      })),
    )).flat();

    const intent = await this.planner.inferIntent({
      goal: input.goal,
      context,
      preferences: input.preferences,
      recentDecisions: input.recentDecisions,
    });

    if (state.paused) {
      return this.finish({ goal: input.goal, intent, stopReason: "paused", nextAction: state.nextAction }, context);
    }

    if (state.blockers.length > 0 && !supersedesPriorState) {
      return this.finish({ goal: input.goal, intent, stopReason: "blocked", nextAction: state.nextAction }, context);
    }

    const action = await this.planner.proposeNextAction({
      goal: input.goal,
      context,
      intent,
      previousResult: this.previousResult,
    });
    if (!action) {
      return this.finish({ goal: input.goal, intent, action: null, stopReason: "goal_complete", nextAction: null }, context);
    }

    const riskDecision = evaluateRiskPolicy(action.riskSignals ?? {}, action.mediumRiskChecks);

    if (riskDecision.executionBlocked) {
      return this.finish({
        goal: input.goal,
        intent,
        action,
        riskDecision,
        stopReason: "blocked",
        nextAction: `Safety policy blocked: ${action.description}`,
      }, context);
    }

    let approvalKey: string | null = null;
    let approvalSatisfied = false;
    if (riskDecision.humanApprovalRequired || this.policy.requiresApproval(action)) {
      approvalKey = createApprovalKey(input.goal, action);
      approvalSatisfied = !this.approvalConsumed && this.approvedActionKey === approvalKey;
      if (!approvalSatisfied) {
        return this.finish({
          goal: input.goal,
          intent,
          action,
          riskDecision,
          approvalKey,
          approvalSatisfied: false,
          stopReason: "approval_required",
          nextAction: action.description,
        }, context);
      }
      this.approvalConsumed = true;
    }

    if (riskDecision.level === "MEDIUM" && !riskDecision.autoExecutionAllowed) {
      return this.finish({
        goal: input.goal,
        intent,
        action,
        riskDecision,
        stopReason: "continue",
        nextAction: `Complete automated MEDIUM-risk verification before: ${action.description}`,
      }, context);
    }

    const result = await this.executor.execute(action, context);
    this.previousResult = result;
    if (!result.ok) {
      const recoveryDecision = this.evaluateFailure(action, result);
      return this.finish({
        goal: input.goal,
        intent,
        action,
        result,
        riskDecision,
        recoveryDecision,
        approvalKey,
        approvalSatisfied,
        stopReason: recoveryDecision.blocked ? "blocked" : "continue",
        nextAction: this.recoveryNextAction(action, recoveryDecision),
      }, context);
    }

    const verification = await this.verifier.verify({ goal: input.goal, action, result, context });
    if (!verification.ok) {
      const verificationFailure: ActionResult = {
        actionId: action.id,
        ok: false,
        summary: `Verification failed: ${verification.summary}`,
        evidence: verification.evidence,
      };
      this.previousResult = verificationFailure;
      const recoveryDecision = this.evaluateFailure(action, verificationFailure);
      return this.finish({
        goal: input.goal,
        intent,
        action,
        result,
        verification,
        riskDecision,
        recoveryDecision,
        approvalKey,
        approvalSatisfied,
        stopReason: recoveryDecision.blocked ? "blocked" : "continue",
        nextAction: this.recoveryNextAction(action, recoveryDecision),
      }, context);
    }

    this.recoveryByAction.delete(action.id);
    this.previousResult = result;
    const stopReason: StopReason = action.completesBoundedCommand ? "goal_complete" : "continue";

    return this.finish({
      goal: input.goal,
      intent,
      action,
      result,
      verification,
      riskDecision,
      approvalKey,
      approvalSatisfied,
      stopReason,
      nextAction: null,
    }, context);
  }

  private evaluateFailure(action: ProposedAction, result: ActionResult): RecoveryDecision {
    const failureSignature = normalizeFailureSignature(result);
    const failureClass = classifyFailure(result);
    const previous = this.recoveryByAction.get(action.id);
    const sameSignature = previous?.failureSignature === failureSignature;
    const tracker: RecoveryTracker = {
      failureSignature,
      failureClass,
      attemptsForSignature: sameSignature ? previous.attemptsForSignature + 1 : 1,
      strategyPivots: previous?.strategyPivots ?? 0,
      totalAttempts: (previous?.totalAttempts ?? 0) + 1,
    };

    const decision = evaluateRecovery({
      ...tracker,
      explicitBlocker: result.blocker ?? null,
    }, {
      maxAttemptsPerSignature: this.maxRetriesPerAction,
      maxStrategyPivots: this.maxStrategyPivots,
      maxTotalAttempts: this.maxTotalRecoveryAttempts,
    });

    if (decision.action === "strategy_pivot") {
      tracker.strategyPivots = decision.nextStrategyPivot;
      tracker.attemptsForSignature = 0;
    }
    this.recoveryByAction.set(action.id, tracker);
    return decision;
  }

  private recoveryNextAction(action: ProposedAction, decision: RecoveryDecision): string {
    if (decision.action === "retry_same") {
      return `Retry same operation: ${action.description}`;
    }
    if (decision.action === "repair") {
      return `Repair current strategy and retry: ${action.description}`;
    }
    if (decision.action === "strategy_pivot") {
      return `Strategy pivot ${decision.nextStrategyPivot}: re-plan a different approach for ${action.description}`;
    }
    const hint = decision.humanInterventionHint ? ` Human intervention: ${decision.humanInterventionHint}` : "";
    return `BLOCKED: ${decision.reason}.${hint}`;
  }

  private async finish(record: WriteBackRecord, context: ContextItem[]): Promise<CycleReport> {
    await this.store.writeBack(record);
    return {
      ...record,
      contextSources: [...new Set(context.map((item) => item.source))],
    };
  }
}
