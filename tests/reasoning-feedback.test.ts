import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { buildReasoningFeedback } from "../src/orchestrator/reasoning-feedback.ts";

function baseInput() {
  const compass = new CompassStore(":memory:");
  compass.setGoal({
    title: "Ship safely",
    description: "Execute bounded work and feed the result back to the reasoning plane.",
    successCriteria: ["Verified result"],
    constraints: ["No extra AI API billing"],
  });
  const goal = compass.getGoal();
  const state = compass.updateState({
    status: "RUNNING",
    blockers: [],
    verificationSummary: "verified",
    nextAction: "inspect the result",
  });
  compass.close();
  return { goal, state };
}

test("emits a compact continuable feedback packet", () => {
  const { goal, state } = baseInput();
  const feedback = buildReasoningFeedback({
    goal,
    state,
    status: "RUNNING",
    commandSource: "chat",
    command: "continue",
    report: { stopReason: "completed" },
    generatedAt: "2026-09-03T13:20:00.000Z",
  });
  assert.equal(feedback.version, 1);
  assert.equal(feedback.goal?.title, "Ship safely");
  assert.equal(feedback.reasoningRequired, false);
  assert.equal(feedback.humanApprovalRequired, false);
  assert.equal(feedback.nextAction, "inspect the result");
  assert.equal(feedback.reasoningRoute.surface, "chat");
  assert.equal(feedback.reasoningRoute.status, "ready");
});

test("signals fresh reasoning for idle, stale, draft-gated, or blocked states", () => {
  const { goal, state } = baseInput();
  for (const status of ["awaiting_command", "stale_command_invalidated", "goal_draft_not_ready"] as const) {
    const feedback = buildReasoningFeedback({ goal, state, status, commandSource: null, command: null });
    assert.equal(feedback.reasoningRequired, true);
  }
  const blocked = buildReasoningFeedback({
    goal,
    state,
    status: "blocked",
    commandSource: "work",
    command: "continue",
    blockers: ["local_runtime_required"],
  });
  assert.equal(blocked.reasoningRequired, true);
});

test("surfaces Human Gate evidence separately from general reasoning", () => {
  const { goal, state } = baseInput();
  const feedback = buildReasoningFeedback({
    goal,
    state,
    status: "approval_required",
    commandSource: "codex",
    command: "prepare merge",
    report: { stopReason: "approval_required" },
  });
  assert.equal(feedback.reasoningRequired, true);
  assert.equal(feedback.humanApprovalRequired, true);
});

test("shows budget exhaustion in the structured feedback packet", () => {
  const { goal, state } = baseInput();
  const feedback = buildReasoningFeedback({
    goal,
    state: { ...state, nextAction: "Refactor repository code and update tests" },
    status: "RUNNING",
    commandSource: "chat",
    command: "continue",
    reasoningUsage: { work: 0, codex: 3 },
    reasoningSoftBudgets: { work: 2, codex: 3 },
  });
  assert.equal(feedback.reasoningRoute.surface, "codex");
  assert.equal(feedback.reasoningRoute.status, "defer_heavy_reasoning");
  assert.equal(feedback.reasoningRoute.budgetRemaining, 0);
});
