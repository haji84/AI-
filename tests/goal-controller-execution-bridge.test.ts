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

test("goal continuation automatically advances across routine bounded runs until achieved", async () => {
  let calls = 0;
  const adapter: GoalExecutionAdapter = {
    async run() {
      calls += 1;
      if (calls < 3) return { cycles: [], stopReason: "cycle_budget_exhausted", goalEvaluation: { achieved: false, reason: "remaining work", verifiedRequired: [], failedRequired: [], unverifiedRequired: ["remaining"], blockers: [], remainingGaps: ["remaining"] } };
      return { cycles: [], stopReason: "goal_complete", goalEvaluation: { achieved: true, reason: "done", verifiedRequired: ["done"], failedRequired: [], unverifiedRequired: [], blockers: [], remainingGaps: [] } };
    },
  };
  const result = await new GoalControllerExecutionBridge(adapter).executeUntilGoalTerminal(decision("CONTINUE_GOAL", "goal-1"));
  assert.equal(calls, 3);
  assert.equal(result.reason, "goal_complete");
  assert.equal(result.reports?.length, 3);
});

test("goal continuation stops at a real human gate", async () => {
  let calls = 0;
  const adapter: GoalExecutionAdapter = {
    async run() {
      calls += 1;
      return { cycles: [], stopReason: "approval_required", goalEvaluation: { achieved: false, reason: "approval required", verifiedRequired: [], failedRequired: [], unverifiedRequired: [], blockers: ["approval_required"], remainingGaps: ["approval_required"] } };
    },
  };
  const result = await new GoalControllerExecutionBridge(adapter).executeUntilGoalTerminal(decision("CONTINUE_GOAL", "goal-1"));
  assert.equal(calls, 1);
  assert.equal(result.reason, "human_gate");
});

test("goal continuation has a bounded stagnation guard", async () => {
  let calls = 0;
  const adapter: GoalExecutionAdapter = {
    async run() {
      calls += 1;
      return { cycles: [], stopReason: "cycle_budget_exhausted", goalEvaluation: { achieved: false, reason: "remaining work", verifiedRequired: [], failedRequired: [], unverifiedRequired: ["remaining"], blockers: [], remainingGaps: ["remaining"] } };
    },
  };
  const result = await new GoalControllerExecutionBridge(adapter).executeUntilGoalTerminal(decision("CONTINUE_GOAL", "goal-1"), { maxRuns: 3 });
  assert.equal(calls, 3);
  assert.equal(result.reason, "goal_continuation_budget_exhausted");
});

test("publication wait is a durable continuation boundary, not a failed Goal or exhausted retry", async () => {
  const adapter: GoalExecutionAdapter = {
    async run() {
      return { cycles: [], stopReason: "cycle_budget_exhausted", goalEvaluation: { achieved: false, reason: "ready to publish", verifiedRequired: [], failedRequired: [], unverifiedRequired: ["release"], blockers: [], remainingGaps: ["publication_connectivity_unavailable"] } };
    },
  };
  const result = await new GoalControllerExecutionBridge(adapter).executeUntilGoalTerminal(
    decision("CONTINUE_GOAL", "goal-1"),
    { maxRuns: 1 },
  );
  assert.equal(result.reason, "publication_wait");
  assert.equal(result.report?.stopReason, "cycle_budget_exhausted");
});
