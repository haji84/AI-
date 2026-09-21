import type { ActionResult, ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "./goal-loop.ts";
import { goalWorkStateId } from "./work-state-integration.ts";

const DEVELOPMENT_MARKERS = /(code|coding|implement|implementation|fix|repair|refactor|test|build|source|repository|script|patch|develop|development|コード|実装|修正|改修|開発|テスト)/i;

function nextAction(context: ContextItem[]): string | null {
  const direct = context.find((item) => item.source === "state.next_action")?.summary?.trim();
  if (direct) return direct;
  for (const item of context) {
    if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) continue;
    const value = (item.data as { nextAction?: unknown }).nextAction;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function failureSignature(result?: ActionResult | null): string[] {
  if (!result || result.ok) return [];
  const detail = (result.blocker || result.summary || "unknown-failure")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return [`${result.actionId}:${detail}`];
}

export class RuntimeDevelopmentPlanner implements Planner {
  readonly supersedesPriorExecutionState?: boolean;
  private readonly delegate: Planner;

  constructor(delegate: Planner) {
    this.delegate = delegate;
    this.supersedesPriorExecutionState = delegate.supersedesPriorExecutionState;
  }

  inferIntent(input: {
    goal: Goal;
    context: ContextItem[];
    preferences?: string[];
    recentDecisions?: string[];
  }): Promise<InferredIntent> {
    return this.delegate.inferIntent(input);
  }

  async proposeNextAction(input: {
    goal: Goal;
    context: ContextItem[];
    intent: InferredIntent;
    previousResult?: ActionResult | null;
  }): Promise<ProposedAction | null> {
    if (input.context.some((item) => item.source === "goal.complete" && item.summary === "true")) return null;

    const next = nextAction(input.context);
    const scope = [input.goal.title, input.goal.description ?? "", next ?? "", input.intent.summary].join("\n");
    if (!DEVELOPMENT_MARKERS.test(scope)) {
      return this.delegate.proposeNextAction(input);
    }

    const recovery = input.previousResult && !input.previousResult.ok;
    const now = Date.now();
    const objective = next || input.goal.description?.trim() || input.goal.title;
    return {
      id: `runtime-builder:${now}`,
      description: objective,
      capability: "code.builder",
      risk: "low",
      irreversible: false,
      externalSideEffect: false,
      input: {
        goalId: goalWorkStateId(input.goal),
        attemptId: `attempt-${now}`,
        strategyId: recovery ? `recovery-${now}` : `initial-${now}`,
        objective: recovery
          ? `${objective}. Previous attempt failed: ${input.previousResult?.summary ?? "unknown failure"}. Use a materially different implementation strategy.`
          : objective,
        previousFailureSignatures: failureSignature(input.previousResult),
      },
    };
  }
}
