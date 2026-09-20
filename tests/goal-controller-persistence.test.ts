import test from "node:test";
import assert from "node:assert/strict";
import { GoalControllerRuntime, type ActiveGoal, type GoalRegistry } from "../src/orchestrator/goal-controller-runtime.ts";
import { SqliteGoalDecisionStore } from "../src/orchestrator/goal-decision-store.ts";
import type { Goal } from "../src/orchestrator/goal-loop.ts";

class Registry implements GoalRegistry {
  goals: ActiveGoal[] = [];
  async listActive() { return this.goals; }
  async create(input: { title: string; description: string; successCriteria: string[]; constraints: string[] }) {
    const goal: Goal = { title: input.title, description: input.description, successCriteria: input.successCriteria, constraints: input.constraints };
    const active = { goal, goalId: `goal-${this.goals.length + 1}`, workState: null };
    this.goals.push(active);
    return active;
  }
}

test("deduplication survives Goal Controller restart and entry-point change", async () => {
  const registry = new Registry();
  const store = new SqliteGoalDecisionStore(":memory:");
  const firstRuntime = new GoalControllerRuntime({ registry, decisionStore: store });
  const first = await firstRuntime.handle({
    source: "chat",
    text: "端末登録を最後まで完成させて",
    idempotencyKey: "same-owner-goal",
  });
  const secondRuntime = new GoalControllerRuntime({ registry, decisionStore: store });
  const second = await secondRuntime.handle({
    source: "codex",
    text: "端末登録を最後まで完成させて",
    idempotencyKey: "same-owner-goal",
  });
  assert.equal(first.goalId, second.goalId);
  assert.equal(registry.goals.length, 1);
  store.close();
});

test("inspection remains non-persistent through durable store", async () => {
  const registry = new Registry();
  const store = new SqliteGoalDecisionStore(":memory:");
  const runtime = new GoalControllerRuntime({ registry, decisionStore: store });
  const result = await runtime.handle({ source: "jarvis", text: "現在の状態を確認して", idempotencyKey: "inspect-1" });
  assert.equal(result.action, "INSPECT");
  assert.equal(registry.goals.length, 0);
  store.close();
});
