import assert from "node:assert/strict";
import test from "node:test";
import {
  createDashboardBoundedPlan,
  dashboardCommandNeedsReasoning,
} from "../src/orchestrator/dashboard-command-routing.ts";
import { reasoningHandoffRequiredOutcome } from "../src/orchestrator/autonomy-run-outcome.ts";

test("read-only issue check keeps the bounded inspect path", () => {
  const command = "Issue #243を確認して";
  assert.equal(dashboardCommandNeedsReasoning(command), false);
  assert.deepEqual(createDashboardBoundedPlan(command), {
    kind: "inspect",
    description: command,
  });
});

test("progress language takes precedence over an earlier check phrase", () => {
  const command = "Issue #243を確認して、安全に進めて";
  assert.equal(dashboardCommandNeedsReasoning(command), true);
  assert.equal(createDashboardBoundedPlan(command), undefined);
});

test("implementation and completion requests are not converted into fake inspect plans", () => {
  for (const command of [
    "UIを修正して最後まで進めて",
    "Windows向けexe化まで完成させて",
    "このバグを直して",
    "Implement the feature and finish it",
  ]) {
    assert.equal(dashboardCommandNeedsReasoning(command), true, command);
    assert.equal(createDashboardBoundedPlan(command), undefined, command);
  }
});

test("reasoning handoff outcome preserves the command as the next bounded reasoning target", () => {
  const outcome = reasoningHandoffRequiredOutcome("chat", "UIを修正して最後まで進めて");
  assert.equal(outcome.status, "reasoning_handoff_required");
  assert.match(outcome.verificationSummary, /without a fabricated inspect plan/);
  assert.match(outcome.nextAction, /UIを修正して最後まで進めて/);
});
