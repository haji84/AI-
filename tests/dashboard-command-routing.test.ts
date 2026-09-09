import assert from "node:assert/strict";
import test from "node:test";
import {
  createDashboardBoundedPlan,
  dashboardCommandNeedsReasoning,
  dashboardCommandStartsFreshTask,
  FREE_PLANNER_DELEGATE_REASON,
} from "../src/orchestrator/dashboard-command-routing.ts";
import { reasoningHandoffRequiredOutcome } from "../src/orchestrator/autonomy-run-outcome.ts";

test("read-only issue check keeps the bounded inspect path", () => {
  const command = "Issue #243を確認して";
  assert.equal(dashboardCommandNeedsReasoning(command), false);
  assert.equal(dashboardCommandStartsFreshTask(command), false);
  assert.deepEqual(createDashboardBoundedPlan(command), {
    kind: "inspect",
    description: command,
  });
});

test("progress language delegates to the free planner instead of dropping the plan", () => {
  const command = "Issue #243を確認して、安全に進めて";
  assert.equal(dashboardCommandNeedsReasoning(command), true);
  assert.equal(dashboardCommandStartsFreshTask(command), false);
  assert.deepEqual(createDashboardBoundedPlan(command), {
    kind: "inspect",
    description: command,
    reason: FREE_PLANNER_DELEGATE_REASON,
  });
});

test("implementation and completion requests are delegated to the bounded free planner", () => {
  for (const command of [
    "UIを修正して最後まで進めて",
    "Windows向けexe化まで完成させて",
    "このバグを直して",
    "Implement the feature and finish it",
  ]) {
    assert.equal(dashboardCommandNeedsReasoning(command), true, command);
    assert.deepEqual(createDashboardBoundedPlan(command), {
      kind: "inspect",
      description: command,
      reason: FREE_PLANNER_DELEGATE_REASON,
    }, command);
  }
});

test("specific execution command without an issue reference starts a fresh task", () => {
  const command = "操作画面の「最新結果を確認」ボタンを「最新の実行結果を見る」に変更して完成させて";
  assert.equal(dashboardCommandNeedsReasoning(command), true);
  assert.equal(dashboardCommandStartsFreshTask(command), true);
});

test("generic continuation commands keep the existing task scope", () => {
  for (const command of ["進めて", "次へ進んで", "続けて", "完成させて", "最後まで進めて"]) {
    assert.equal(dashboardCommandStartsFreshTask(command), false, command);
  }
});

test("reasoning handoff outcome remains available for non-dashboard sources without a plan", () => {
  const outcome = reasoningHandoffRequiredOutcome("chat", "UIを修正して最後まで進めて");
  assert.equal(outcome.status, "reasoning_handoff_required");
  assert.match(outcome.verificationSummary, /without a fabricated inspect plan/);
  assert.match(outcome.nextAction, /UIを修正して最後まで進めて/);
});
