import assert from "node:assert/strict";
import test from "node:test";
import { GoalControllerExecutionBridge, type GoalExecutionAdapter } from "../src/orchestrator/goal-controller-execution-bridge.ts";
import type { GoalControllerDecision } from "../src/orchestrator/goal-controller-runtime.ts";

for (const stopReason of ["blocked", "retry_exhausted"] as const) {
  test(`${stopReason} remains terminal when resource and safety gaps coexist`, async () => {
    let calls = 0;
    const adapter: GoalExecutionAdapter = { async run() {
      calls++;
      return { cycles: [], stopReason, goalEvaluation: {
        achieved: false, verifiedRequired: [], failedRequired: [], unverifiedRequired: ["criterion-1"],
        blockers: ["safety_block"], remainingGaps: ["resource_wait:busy", "safety_block"],
      } };
    } };
    const decision: GoalControllerDecision = {
      action: "CONTINUE_GOAL", goalId: "issue:1219",
      resolution: { kind: "EXISTING_GOAL", intent: "DEVELOPMENT_TASK", reason: "explicit_goal_hint",
        intake: { id: "stop-precedence", source: "codex", text: "fix continuation", sourceContext: {}, idempotencyKey: "stop-precedence" } },
    };
    const result = await new GoalControllerExecutionBridge(adapter).executeUntilGoalTerminal(decision);
    assert.equal(result.reason, stopReason);
    assert.equal(calls, 1);
  });
}
