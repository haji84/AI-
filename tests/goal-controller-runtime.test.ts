import test from "node:test";
import assert from "node:assert/strict";
import { GoalControllerRuntime, normalizeIntake, type ActiveGoal, type GoalRegistry, type GoalControllerDecision } from "../src/orchestrator/goal-controller-runtime.ts";
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

test("an unknown explicit Goal hint never falls back to a similar existing Goal", async () => {
  const registry = new Registry();
  registry.goals.push({
    goalId: "goal-unrelated",
    goal: { title: "GORIQ delivery", description: "Complete GORIQ delivery", successCriteria: ["GORIQ delivery"], constraints: ["Preserve stopped work"] },
    workState: null,
  });
  const before = JSON.stringify(registry.goals);
  const runtime = new GoalControllerRuntime({ registry });
  await assert.rejects(runtime.handle({
    source: "github", text: "Complete GORIQ delivery", goalHint: "goal-requested",
  }), /GOAL_HINT_NOT_FOUND/);
  assert.equal(JSON.stringify(registry.goals), before);
});

test("an unknown explicit Goal hint cannot create a replacement Goal", async () => {
  const registry = new Registry();
  const runtime = new GoalControllerRuntime({ registry });
  await assert.rejects(runtime.handle({
    source: "codex", text: "Complete GORIQ delivery", goalHint: "goal-requested",
  }), /GOAL_HINT_NOT_FOUND/);
  assert.equal(registry.goals.length, 0);
});

test("an exact existing title remains a supported explicit Goal hint", async () => {
  const registry = new Registry();
  registry.goals.push({
    goalId: "goal-known", goal: { title: "Known delivery", successCriteria: ["Verified artifact"], constraints: [] }, workState: null,
  });
  const runtime = new GoalControllerRuntime({ registry });
  const result = await runtime.handle({ source: "github", text: "Complete this work", goalHint: "Known delivery" });
  assert.equal(result.goalId, "goal-known");
  assert.equal(result.resolution.reason, "explicit_goal_hint");
  assert.equal(registry.goals.length, 1);
});

test("informational questions with a missing Goal hint still remain read-only", async () => {
  const registry = new Registry();
  const runtime = new GoalControllerRuntime({ registry });
  const result = await runtime.handle({ source: "chat", text: "What is the status?", goalHint: "goal-missing" });
  assert.equal(result.action, "ANSWER");
  assert.equal(result.resolution.kind, "NO_GOAL");
  assert.equal(registry.goals.length, 0);
});

test("a cached decision cannot replay an explicit hint into a different Goal", async () => {
  const registry = new Registry();
  registry.goals.push({ goalId: "goal-unrelated", goal: { title: "GORIQ delivery", successCriteria: ["Deliver"], constraints: [] }, workState: null });
  const request = { source: "github" as const, text: "Complete GORIQ delivery", goalHint: "goal-requested", idempotencyKey: "historical-misroute" };
  const cached: GoalControllerDecision = {
    resolution: { kind: "EXISTING_GOAL", intent: "GOAL", intake: normalizeIntake(request), goal: registry.goals[0], reason: "active_goal_similarity" },
    action: "CONTINUE_GOAL", goalId: "goal-unrelated",
  };
  let writes = 0;
  const runtime = new GoalControllerRuntime({ registry, decisionStore: { async get() { return cached; }, async put() { writes += 1; } } });
  await assert.rejects(runtime.handle(request), /INTAKE_IDEMPOTENCY_CONFLICT/);
  assert.equal(writes, 0);
  assert.equal(cached.goalId, "goal-unrelated");
});
