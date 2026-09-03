import assert from "node:assert/strict";
import test from "node:test";
import { GoalDrivenLoop, type Goal, type Planner, type WriteBackRecord } from "../src/orchestrator/goal-loop.ts";
import { runBoundedGoalLoop } from "../src/orchestrator/bounded-runner.ts";
import { ModelBackedPlanner } from "../src/orchestrator/model-planner.ts";

const goal: Goal = {
  title: "Execute one bounded command",
  successCriteria: ["verified once"],
  constraints: ["do not replay"],
};

function memoryStore() {
  const records: WriteBackRecord[] = [];
  return {
    records,
    async getState() {
      return { completed: [], blockers: [], nextAction: null };
    },
    async writeBack(record: WriteBackRecord) {
      records.push(record);
    },
  };
}

function successfulLoop(planner: Planner, executions: { count: number }) {
  const store = memoryStore();
  const loop = new GoalDrivenLoop(
    planner,
    [],
    {
      async execute(action) {
        executions.count += 1;
        return { actionId: action.id, ok: true, summary: "executed" };
      },
    },
    {
      async verify() {
        return { ok: true, summary: "verified" };
      },
    },
    store,
  );
  return { loop, store };
}

test("verified explicit bounded plan terminates the run after one cycle", async () => {
  const model = {
    command: { plan: { kind: "inspect" } },
    async plan() {
      return { kind: "inspect" as const, description: "inspect once" };
    },
  };
  const planner = new ModelBackedPlanner(model);
  const executions = { count: 0 };
  const { loop } = successfulLoop(planner, executions);

  const report = await runBoundedGoalLoop(loop, goal, { maxCycles: 3 });

  assert.equal(report.stopReason, "goal_complete");
  assert.equal(report.cycles.length, 1);
  assert.equal(report.cycles[0]?.action?.completesBoundedCommand, true);
  assert.equal(executions.count, 1);
});

test("ordinary verified actions preserve multi-cycle behavior", async () => {
  const planner: Planner = {
    async inferIntent() {
      return { summary: "continue ordinary work", confidence: 1, evidence: [] };
    },
    async proposeNextAction() {
      return { id: "ordinary", description: "ordinary step", capability: "context.inspect", risk: "low" };
    },
  };
  const executions = { count: 0 };
  const { loop } = successfulLoop(planner, executions);

  const report = await runBoundedGoalLoop(loop, goal, { maxCycles: 3 });

  assert.equal(report.stopReason, "cycle_budget_exhausted");
  assert.equal(report.cycles.length, 3);
  assert.equal(executions.count, 3);
});
