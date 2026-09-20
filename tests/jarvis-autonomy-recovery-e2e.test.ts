import test from "node:test";
import assert from "node:assert/strict";
import { GoalControllerExecutionBridge, type GoalExecutionAdapter } from "../src/orchestrator/goal-controller-execution-bridge.ts";
import { GoalControllerRuntime, type ActiveGoal, type GoalRegistry } from "../src/orchestrator/goal-controller-runtime.ts";
import { UnifiedEntryRuntime } from "../src/orchestrator/unified-entry-runtime.ts";
import { SqliteSharedContextStore } from "../src/orchestrator/shared-context-store.ts";
import { SqliteGoalDecisionStore } from "../src/orchestrator/goal-decision-store.ts";
import { JarvisAutonomyRuntime } from "../src/jarvis/autonomy-runtime.ts";
import { JarvisControlPlane } from "../src/jarvis/control-plane.ts";
import type { Goal } from "../src/orchestrator/goal-loop.ts";

class Registry implements GoalRegistry {
  goals: ActiveGoal[] = [{
    goalId: "goal-device",
    goal: { title: "端末登録", description: "端末登録を完成", successCriteria: ["登録成功"], constraints: [] },
    workState: null,
  }];
  async listActive() { return this.goals; }
  async create(input: { title: string; description: string; successCriteria: string[]; constraints: string[] }) {
    const goal: Goal = { title: input.title, description: input.description, successCriteria: input.successCriteria, constraints: input.constraints };
    const active = { goal, goalId: `goal-${this.goals.length + 1}`, workState: null };
    this.goals.push(active);
    return active;
  }
}

test("cross-entry Goal failure emits recovery next action into JARVIS control plane", async () => {
  const registry = new Registry();
  const contexts = new SqliteSharedContextStore(":memory:");
  const decisions = new SqliteGoalDecisionStore(":memory:");
  const entry = new UnifiedEntryRuntime({
    controller: new GoalControllerRuntime({ registry, decisionStore: decisions }),
    contextStore: contexts,
  });
  let attempt = 0;
  const adapter: GoalExecutionAdapter = {
    async run() {
      attempt += 1;
      if (attempt === 1) {
        return {
          stopReason: "cycle_budget_exhausted",
          cycles: [{
            goal: registry.goals[0].goal,
            intent: { summary: "fix enrollment", confidence: 1, evidence: [] },
            action: { id: "fix-a", description: "first implementation", capability: "code", risk: "low" },
            result: { actionId: "fix-a", ok: false, summary: "test failed" },
            recoveryDecision: { action: "strategy_pivot", reason: "repeated implementation failure", blocked: false, nextStrategyPivot: 1 },
            stopReason: "continue",
            nextAction: "Strategy pivot 1: re-plan a different approach for first implementation",
            contextSources: ["shared-context"],
          }],
        };
      }
      return {
        stopReason: "goal_complete",
        cycles: [{
          goal: registry.goals[0].goal,
          intent: { summary: "alternate implementation", confidence: 1, evidence: [] },
          action: { id: "fix-b", description: "alternate implementation", capability: "code", risk: "low", completesBoundedCommand: true },
          result: { actionId: "fix-b", ok: true, summary: "alternate implementation passed" },
          verification: { ok: true, summary: "verified" },
          stopReason: "goal_complete",
          nextAction: null,
          contextSources: ["shared-context"],
        }],
      };
    },
  };
  const controlPlane = new JarvisControlPlane();
  const runtime = new JarvisAutonomyRuntime({ entry, bridge: new GoalControllerExecutionBridge(adapter), controlPlane });

  const first = await runtime.handle({ source: "codex", text: "端末登録を修正して", goalHint: "goal-device", idempotencyKey: "attempt-1" });
  assert.equal(first.execution.report?.cycles[0].recoveryDecision?.action, "strategy_pivot");
  assert.ok(first.queuedTaskId);
  const queued = controlPlane.queue.get(first.queuedTaskId!);
  assert.equal(queued?.type, "goal-next-action");
  assert.match(String(queued?.payload.nextAction), /Strategy pivot/);

  const second = await runtime.handle({ source: "jarvis", text: "端末登録を別の方法で修正して", goalHint: "goal-device", idempotencyKey: "attempt-2" });
  assert.equal(second.execution.report?.stopReason, "goal_complete");
  assert.equal(second.execution.report?.cycles[0].verification?.ok, true);
  decisions.close();
  contexts.close();
});
