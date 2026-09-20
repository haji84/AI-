import test from "node:test";
import assert from "node:assert/strict";
import { GoalControllerExecutionBridge, type GoalExecutionAdapter } from "../src/orchestrator/goal-controller-execution-bridge.ts";
import type { GoalControllerDecision } from "../src/orchestrator/goal-controller-runtime.ts";

function decision(action: GoalControllerDecision["action"], goalId?: string): GoalControllerDecision {
  return {
    action,
    goalId,
    resolution: {
      kind: goalId ? "EXISTING_GOAL" : "NO_GOAL",
      intent: goalId ? "DEVELOPMENT_TASK" : "QUESTION",
      intake: { id: "i", source: "jarvis", text: "x", sourceContext: {}, idempotencyKey: "k" },
      reason: "test",
    },
  };
}

test("CONTINUE_GOAL invokes existing autonomy execution adapter", async () => {
  const calls: string[] = [];
  const adapter: GoalExecutionAdapter = {
    async run(goalId) {
      calls.push(goalId);
      return { cycles: [], stopReason: "cycle_budget_exhausted" };
    },
  };
  const result = await new GoalControllerExecutionBridge(adapter).execute(decision("CONTINUE_GOAL", "goal-1"), [{ summary: "chat finding" }]);
  assert.equal(result.executed, true);
  assert.deepEqual(calls, ["goal-1"]);
  assert.equal(result.report?.stopReason, "cycle_budget_exhausted");
});

test("question and bounded commands do not invoke Goal Loop", async () => {
  let calls = 0;
  const adapter: GoalExecutionAdapter = {
    async run() {
      calls += 1;
      return { cycles: [], stopReason: "goal_complete" };
    },
  };
  const bridge = new GoalControllerExecutionBridge(adapter);
  assert.equal((await bridge.execute(decision("ANSWER"))).executed, false);
  assert.equal((await bridge.execute(decision("EXECUTE_BOUNDED"))).executed, false);
  assert.equal(calls, 0);
});
