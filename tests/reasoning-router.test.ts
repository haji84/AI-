import assert from "node:assert/strict";
import test from "node:test";
import { routeReasoningTask } from "../src/orchestrator/reasoning-router.ts";

test("keeps routine reasoning in Chat by default", () => {
  const decision = routeReasoningTask({ text: "Review status and decide the next step" });
  assert.equal(decision.surface, "chat");
  assert.equal(decision.status, "ready");
  assert.equal(decision.budgetRemaining, null);
});

test("reserves code-changing work for Codex", () => {
  const decision = routeReasoningTask({ text: "Implement the repository code fix and run tests" });
  assert.equal(decision.surface, "codex");
  assert.equal(decision.status, "ready");
});

test("reserves materially cross-app work for Work", () => {
  const decision = routeReasoningTask({
    text: "Coordinate Gmail and Calendar for this recurring workflow",
    crossApp: true,
    recurring: true,
  });
  assert.equal(decision.surface, "work");
  assert.equal(decision.status, "ready");
});

test("defers heavy reasoning after a soft budget is exhausted", () => {
  const decision = routeReasoningTask(
    { text: "Refactor repository code and update tests" },
    { work: 0, codex: 3 },
    { work: 2, codex: 3 },
  );
  assert.equal(decision.surface, "codex");
  assert.equal(decision.status, "defer_heavy_reasoning");
  assert.equal(decision.budgetRemaining, 0);
});

test("falls back to Chat only when explicitly safe", () => {
  const decision = routeReasoningTask(
    { text: "Coordinate multiple sources", crossApp: true, fallbackToChatSafe: true },
    { work: 2, codex: 0 },
    { work: 2, codex: 3 },
  );
  assert.equal(decision.surface, "chat");
  assert.equal(decision.status, "ready");
});
