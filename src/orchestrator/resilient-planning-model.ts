import type { PlanningModel, ModelPlan } from "./model-planner.ts";
import type { ContextItem, Goal } from "./goal-loop.ts";

function providerFailureDescription(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/GitHub Models HTTP 410/i.test(message)) {
    return "Planner provider retired: GitHub Models inference is no longer available. No model-generated repository change was attempted.";
  }
  return `Planner provider unavailable: ${message}. No model-generated repository change was attempted.`;
}

export class ResilientPlanningModel implements PlanningModel {
  private readonly inner: PlanningModel;

  constructor(inner: PlanningModel) {
    this.inner = inner;
  }

  async plan(input: { goal: Goal; context: ContextItem[] }): Promise<ModelPlan> {
    try {
      return await this.inner.plan(input);
    } catch (error) {
      return {
        kind: "inspect",
        description: providerFailureDescription(error),
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
