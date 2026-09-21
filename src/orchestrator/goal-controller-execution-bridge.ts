import type { GoalControllerDecision } from "./goal-controller-runtime.ts";
import type { BoundedRunReport } from "./bounded-runner.ts";

export interface GoalExecutionAdapter {
  run(goalId: string, input?: { maxCycles?: number; context?: unknown[] }): Promise<BoundedRunReport>;
}

export interface GoalExecutionResult {
  decision: GoalControllerDecision;
  executed: boolean;
  report?: BoundedRunReport;
  reports?: BoundedRunReport[];
  reason?: string;
}

export interface GoalContinuationOptions {
  maxRuns?: number;
  context?: unknown[];
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

  /**
   * Goal-level continuation. Routine Job boundaries are not human gates.
   * The adapter is repeatedly invoked until the Goal is achieved or it reports
   * a real stop condition. The bounded maxRuns guard prevents infinite loops.
   */
  async executeUntilGoalTerminal(
    decision: GoalControllerDecision,
    options: GoalContinuationOptions = {},
  ): Promise<GoalExecutionResult> {
    if (decision.action !== "CONTINUE_GOAL" || !decision.goalId) {
      return { decision, executed: false, reason: "decision_does_not_require_goal_execution" };
    }
    const maxRuns = options.maxRuns ?? 12;
    if (!Number.isInteger(maxRuns) || maxRuns < 1) throw new Error("maxRuns must be a positive integer");
    const reports: BoundedRunReport[] = [];
    for (let run = 0; run < maxRuns; run += 1) {
      const report = await this.adapter.run(decision.goalId, { context: options.context ?? [] });
      reports.push(report);
      if (report.goalEvaluation?.achieved === true || report.stopReason === "goal_complete") {
        return { decision, executed: true, report, reports, reason: "goal_complete" };
      }
      if (report.stopReason === "approval_required") {
        return { decision, executed: true, report, reports, reason: "human_gate" };
      }
      if (report.stopReason === "blocked" || report.stopReason === "retry_exhausted") {
        return { decision, executed: true, report, reports, reason: report.stopReason };
      }
    }
    return {
      decision,
      executed: true,
      report: reports.at(-1),
      reports,
      reason: "goal_continuation_budget_exhausted",
    };
  }
}
