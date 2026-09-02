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
    if (action.externalSideEffect && action.risk !== "low") return true;
    return false;
  }
}

export interface GoalLoopOptions {
  maxRetriesPerAction?: number;
}

export interface CycleReport extends WriteBackRecord {
  contextSources: string[];
}

export class GoalDrivenLoop {
  private readonly planner: Planner;
  private readonly contextSources: ContextSource[];
  private readonly executor: CapabilityExecutor;
  private readonly verifier: Verifier;
  private readonly store: StateStore;
  private readonly policy: ApprovalPolicy;
  private readonly maxRetriesPerAction: number;

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
  }

  async runCycle(input: {
    goal: Goal;
    preferences?: string[];
    recentDecisions?: string[];
  }): Promise<CycleReport> {
    const state = await this.store.getState();
    const context = (await Promise.all(
      this.contextSources.map((source) => source.collect({ goal: input.goal, nextAction: state.nextAction })),
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

    if (state.blockers.length > 0) {
      return this.finish({ goal: input.goal, intent, stopReason: "blocked", nextAction: state.nextAction }, context);
    }

    const action = await this.planner.proposeNextAction({ goal: input.goal, context, intent });
    if (!action) {
      return this.finish({ goal: input.goal, intent, action: null, stopReason: "goal_complete", nextAction: null }, context);
    }

    if (this.policy.requiresApproval(action)) {
      return this.finish({
        goal: input.goal,
        intent,
        action,
        stopReason: "approval_required",
        nextAction: action.description,
      }, context);
    }

    if ((state.retriesForCurrentAction ?? 0) >= this.maxRetriesPerAction) {
      return this.finish({
        goal: input.goal,
        intent,
        action,
        stopReason: "retry_exhausted",
        nextAction: action.description,
      }, context);
    }

    const result = await this.executor.execute(action, context);
    if (!result.ok) {
      return this.finish({
        goal: input.goal,
        intent,
        action,
        result,
        stopReason: result.blocker ? "blocked" : "continue",
        nextAction: action.description,
      }, context);
    }

    const verification = await this.verifier.verify({ goal: input.goal, action, result, context });
    const stopReason: StopReason = verification.ok ? "continue" : "blocked";
    const nextAction = verification.ok ? null : action.description;

    return this.finish({ goal: input.goal, intent, action, result, verification, stopReason, nextAction }, context);
  }

  private async finish(record: WriteBackRecord, context: ContextItem[]): Promise<CycleReport> {
    await this.store.writeBack(record);
    return {
      ...record,
      contextSources: [...new Set(context.map((item) => item.source))],
    };
  }
}
