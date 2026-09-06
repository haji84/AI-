import assert from "node:assert/strict";
import test from "node:test";
import type { ReasoningFeedback } from "../src/orchestrator/reasoning-feedback.ts";
import { dashboardStateFromFeedback } from "../src/app/dashboard-state.ts";

function feedback(overrides: Partial<ReasoningFeedback> = {}): ReasoningFeedback {
  return {
    version: 1,
    goal: null,
    status: "RUNNING",
    commandSource: "chat",
    command: "continue",
    blockers: [],
    verificationSummary: "tests passed",
    nextAction: "continue bounded work",
    report: null,
    riskDecision: null,
    reasoningRequired: false,
    humanApprovalRequired: false,
    reasoningRoute: {
      surface: "chat",
      status: "ready",
      reason: "lightweight",
      usage: { work: 0, codex: 0 },
      softBudgets: { work: 2, codex: 3 },
      budgetRemaining: null,
    },
    generatedAt: "2026-09-07T05:00:00+09:00",
    ...overrides,
  };
}

test("dashboard has no owner decision for LOW autonomous work", () => {
  const state = dashboardStateFromFeedback(feedback({
    riskDecision: {
      level: "LOW",
      humanApprovalRequired: false,
      autoExecutionAllowed: true,
      executionBlocked: false,
      reasons: ["No high-risk signals detected"],
    },
  }));
  assert.equal(state.decisions.length, 0);
  assert.equal(state.riskLevel, "LOW");
});

test("dashboard promotes HIGH approval to a single owner decision", () => {
  const state = dashboardStateFromFeedback(feedback({
    nextAction: "本番反映を実行",
    humanApprovalRequired: true,
    riskDecision: {
      level: "HIGH",
      humanApprovalRequired: true,
      autoExecutionAllowed: false,
      executionBlocked: false,
      reasons: ["Production deployment requires owner approval"],
    },
  }));
  assert.equal(state.decisions.length, 1);
  assert.equal(state.decisions[0]?.title, "本番反映を実行");
  assert.deepEqual(state.decisions[0]?.reasons, ["Production deployment requires owner approval"]);
});

test("CRITICAL remains blocked and is not rendered as an approvable owner decision", () => {
  const state = dashboardStateFromFeedback(feedback({
    humanApprovalRequired: false,
    riskDecision: {
      level: "CRITICAL",
      humanApprovalRequired: false,
      autoExecutionAllowed: false,
      executionBlocked: true,
      reasons: ["Irreversible destructive operation"],
    },
  }));
  assert.equal(state.decisions.length, 0);
  assert.equal(state.riskLevel, "CRITICAL");
});
