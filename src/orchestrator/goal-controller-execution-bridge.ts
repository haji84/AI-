import type { GoalControllerDecision } from "./goal-controller-runtime.ts";
import type { BoundedRunReport } from "./bounded-runner.ts";

export interface GoalExecutionAdapter {
  run(goalId: string, input?: { maxCycles?: number; context?: unknown[] }): Promise<BoundedRunReport>;
}

export interface GoalExecutionResult {
  decision: GoalControllerDecision;
  executed: boolean;
  report?: BoundedRunReport;
  reason?: string;
}

export class GoalControllerExecutionBridge {
  private readonly adapter: GoalExecutionAdapter;
  constructor(adapter: GoalExecutionAdapter) { this.adapter = adapter; }

  async execute(decision: GoalControllerDecision, context: unknown[] = []): Promise<GoalExecutionResult> {
    if (decision.action !== "CONTINUE_GOAL" || !decision.goalId) {
      return { decision, executed: false, reason: "decision_does_not_require_goal_execution" };
    }
    const report = await this.adapter.run(decision.goalId, { context });
    return { decision, executed: true, report };
  }
}
