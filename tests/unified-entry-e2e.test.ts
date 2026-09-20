import test from "node:test";
import assert from "node:assert/strict";
import { GoalControllerRuntime, type ActiveGoal, type GoalRegistry } from "../src/orchestrator/goal-controller-runtime.ts";
import { SqliteGoalDecisionStore } from "../src/orchestrator/goal-decision-store.ts";
import { SqliteSharedContextStore } from "../src/orchestrator/shared-context-store.ts";
import { contextRecordFromIntake } from "../src/orchestrator/shared-context.ts";
import { normalizeIntake } from "../src/orchestrator/goal-controller-runtime.ts";
import { UnifiedEntryRuntime } from "../src/orchestrator/unified-entry-runtime.ts";
import { repositoryTrigger, triggerToUnifiedIntake } from "../src/orchestrator/trigger-runtime.ts";
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

test("Chat inspection context is resolved by later Codex task under one Goal", async () => {
  const registry = new Registry();
  registry.goals.push({ goalId: "goal-device", goal: { title: "端末登録", description: "端末登録を完成", successCriteria: ["登録成功"], constraints: [] }, workState: null });
  const decisions = new SqliteGoalDecisionStore(":memory:");
  const contexts = new SqliteSharedContextStore(":memory:");
  const runtime = new UnifiedEntryRuntime({ controller: new GoalControllerRuntime({ registry, decisionStore: decisions }), contextStore: contexts });

  const inspection = normalizeIntake({ source: "chat", text: "端末登録エラーの原因を調べて", idempotencyKey: "inspect-device" });
  await contexts.put(contextRecordFromIntake(inspection, "INSPECTION", { goalId: "goal-device", summary: "端末登録エラーは期限切れトークン処理が原因", result: { cause: "expired_token" } }));

  const result = await runtime.handle({ source: "codex", text: "端末登録エラーを修正して", goalHint: "goal-device", idempotencyKey: "fix-device" });
  assert.equal(result.decision.goalId, "goal-device");
  assert.equal(result.decision.action, "CONTINUE_GOAL");
  assert.equal(result.context.some((item) => (item.result as { cause?: string } | undefined)?.cause === "expired_token"), true);
  decisions.close();
  contexts.close();
});

test("repository event enters through the same unified intake contract", async () => {
  const registry = new Registry();
  const decisions = new SqliteGoalDecisionStore(":memory:");
  const contexts = new SqliteSharedContextStore(":memory:");
  const runtime = new UnifiedEntryRuntime({ controller: new GoalControllerRuntime({ registry, decisionStore: decisions }), contextStore: contexts });
  const trigger = repositoryTrigger({ id: "issue-910", summary: "端末登録の実装を修正して", kind: "issue" });
  const result = await runtime.handle(triggerToUnifiedIntake(trigger));
  assert.equal(result.decision.resolution.intake.source, "github");
  assert.equal(result.decision.action, "EXECUTE_BOUNDED");
  decisions.close();
  contexts.close();
});

test("JARVIS and Codex with same idempotency key share one durable Goal decision", async () => {
  const registry = new Registry();
  const decisions = new SqliteGoalDecisionStore(":memory:");
  const first = new UnifiedEntryRuntime({ controller: new GoalControllerRuntime({ registry, decisionStore: decisions }) });
  const a = await first.handle({ source: "jarvis", text: "端末登録を最後まで完成させて", idempotencyKey: "owner-goal-1" });
  const second = new UnifiedEntryRuntime({ controller: new GoalControllerRuntime({ registry, decisionStore: decisions }) });
  const b = await second.handle({ source: "codex", text: "端末登録を最後まで完成させて", idempotencyKey: "owner-goal-1" });
  assert.equal(a.decision.goalId, b.decision.goalId);
  assert.equal(registry.goals.length, 1);
  decisions.close();
});
