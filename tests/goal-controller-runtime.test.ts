import test from "node:test";
import assert from "node:assert/strict";
import { GoalControllerRuntime, type ActiveGoal, type GoalRegistry } from "../src/orchestrator/goal-controller-runtime.ts";
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

test("question does not create a persistent goal", async () => {
  const registry = new Registry();
  const runtime = new GoalControllerRuntime({ registry });
  const result = await runtime.handle({ source: "chat", text: "このエラーの意味教えて？" });
  assert.equal(result.action, "ANSWER");
  assert.equal(result.resolution.kind, "NO_GOAL");
  assert.equal(registry.goals.length, 0);
});

test("goal request creates and routes through Goal Controller", async () => {
  const registry = new Registry();
  const runtime = new GoalControllerRuntime({ registry });
  const result = await runtime.handle({ source: "jarvis", text: "端末登録を最後まで完成させて" });
  assert.equal(result.action, "CONTINUE_GOAL");
  assert.equal(result.resolution.kind, "NEW_GOAL");
  assert.equal(registry.goals.length, 1);
});

test("related development request resolves to existing active goal", async () => {
  const registry = new Registry();
  registry.goals.push({
    goalId: "goal-device",
    goal: { title: "端末登録", description: "端末登録フローを完成", successCriteria: ["端末登録成功"], constraints: [] },
    workState: null,
  });
  const runtime = new GoalControllerRuntime({ registry });
  const result = await runtime.handle({ source: "codex", text: "端末登録フローを修正して", goalHint: "goal-device" });
  assert.equal(result.resolution.kind, "EXISTING_GOAL");
  assert.equal(result.goalId, "goal-device");
});

test("same idempotency key does not create duplicate goals across entry points", async () => {
  const registry = new Registry();
  const runtime = new GoalControllerRuntime({ registry });
  const key = "owner-request-123";
  const first = await runtime.handle({ source: "chat", text: "JARVISの登録機能を完成させて", idempotencyKey: key });
  const second = await runtime.handle({ source: "codex", text: "JARVISの登録機能を完成させて", idempotencyKey: key });
  assert.equal(first.goalId, second.goalId);
  assert.equal(registry.goals.length, 1);
});

test("inspection is not inflated into a goal", async () => {
  const registry = new Registry();
  const runtime = new GoalControllerRuntime({ registry });
  const result = await runtime.handle({ source: "codex", text: "現在の登録コードを確認して" });
  assert.equal(result.action, "INSPECT");
  assert.equal(registry.goals.length, 0);
});
