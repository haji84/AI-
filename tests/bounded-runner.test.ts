import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { runBoundedGoalLoop } from "../src/orchestrator/bounded-runner.ts";
import type { CycleReport, Goal, GoalDrivenLoop } from "../src/orchestrator/goal-loop.ts";

test("Compass adapter reads goal and durably writes cycle state", async () => {
  const compass = new CompassStore(":memory:");
  const storedGoal = compass.setGoal({
    title: "Ship autonomous loop",
    description: "Keep moving until a bounded stop condition",
    successCriteria: ["tests pass"],
    constraints: ["human gate"],
  });
  const goal = compassGoalToLoopGoal(storedGoal);
  assert.deepEqual(goal.successCriteria, ["tests pass"]);

  const adapter = new CompassStateStoreAdapter(compass);
  await adapter.writeBack({
    goal,
    intent: { summary: "continue implementation", confidence: 0.9, evidence: [] },
    action: { id: "a1", description: "implement adapter", capability: "code", risk: "low" },
    result: { actionId: "a1", ok: true, summary: "adapter implemented" },
    verification: { ok: true, summary: "tests pass" },
    stopReason: "continue",
    nextAction: "implement runner",
  });

  const state = compass.getState();
  assert.equal(state.nextAction, "implement runner");
  assert.deepEqual(state.completed, ["implement adapter"]);
  assert.equal(compass.getHistory(1)[0]?.taskStatus, "continue");
  compass.close();
});

test("bounded runner stops at approval_required", async () => {
  const goal: Goal = { title: "Goal", successCriteria: [], constraints: [] };
  let calls = 0;
  const fakeLoop = {
    async runCycle(): Promise<CycleReport> {
      calls += 1;
      return {
        goal,
        intent: { summary: "intent", confidence: 1, evidence: [] },
        stopReason: calls === 2 ? "approval_required" : "continue",
        nextAction: "merge",
        contextSources: [],
      };
    },
  } as unknown as GoalDrivenLoop;

  const report = await runBoundedGoalLoop(fakeLoop, goal, { maxCycles: 10 });
  assert.equal(calls, 2);
  assert.equal(report.stopReason, "approval_required");
});

test("bounded runner cannot exceed cycle budget", async () => {
  const goal: Goal = { title: "Goal", successCriteria: [], constraints: [] };
  let calls = 0;
  const fakeLoop = {
    async runCycle(): Promise<CycleReport> {
      calls += 1;
      return {
        goal,
        intent: { summary: "intent", confidence: 1, evidence: [] },
        stopReason: "continue",
        nextAction: "next",
        contextSources: [],
      };
    },
  } as unknown as GoalDrivenLoop;

  const report = await runBoundedGoalLoop(fakeLoop, goal, { maxCycles: 3 });
  assert.equal(calls, 3);
  assert.equal(report.stopReason, "cycle_budget_exhausted");
});
