import type { ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "./goal-loop.ts";
import { inferIntentFromSignals } from "./intent.ts";

function evidenceSummary(context: ContextItem[]): string {
  return context.map((item) => `${item.source}:${item.summary}`).join(" | ");
}

export class BaselinePlanner implements Planner {
  async inferIntent(input: {
    goal: Goal;
    context: ContextItem[];
    preferences?: string[];
    recentDecisions?: string[];
  }): Promise<InferredIntent> {
    return inferIntentFromSignals({
      goal: input.goal,
      context: input.context,
      preferences: input.preferences,
      recentDecisions: input.recentDecisions,
    });
  }

  async proposeNextAction(input: {
    goal: Goal;
    context: ContextItem[];
    intent: InferredIntent;
  }): Promise<ProposedAction | null> {
    const next = input.context.find((item) => item.source === "state.next_action")?.summary?.trim();
    const description = next || `Inspect context required to advance goal: ${input.goal.title}`;
    if (input.context.some((item) => item.source === "goal.complete" && item.summary === "true")) return null;

    return {
      id: `baseline:${description}`,
      description,
      capability: "context.inspect",
      risk: "low",
      irreversible: false,
      externalSideEffect: false,
    };
  }
}

export function createContextInspectCapability() {
  return {
    name: "context.inspect",
    async execute(action: ProposedAction, context: ContextItem[]) {
      return {
        actionId: action.id,
        ok: true,
        summary: `Inspected context for: ${action.description}`,
        evidence: { context: evidenceSummary(context) },
      };
    },
  };
}
