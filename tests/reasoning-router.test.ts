import assert from "node:assert/strict";
import test from "node:test";
import { routeReasoningTask } from "../src/orchestrator/reasoning-router.ts";

test("keeps routine reasoning in Chat by default", () => {
  const decision = routeReasoningTask({ text: "Review status and decide the next step" });
  assert.equal(decision.surface, "chat");
  assert.equal(decision.status, "ready");
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.executionMode, "single");
  assert.equal(decision.budgetRemaining, null);
});

test("asks before using Codex for code-changing work", () => {
  const decision = routeReasoningTask({ text: "Implement the repository code fix and run tests" });
  assert.equal(decision.surface, "codex");
  assert.equal(decision.status, "surface_approval_required");
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.approvalSurface, "codex");
  assert.deepEqual(decision.continuationSurfaceOptions, ["chat", "codex"]);
});

test("owner can choose Chat instead of Codex and continue in bounded chunks", () => {
  const decision = routeReasoningTask({
    text: "Implement the repository code fix and run tests",
    approvedSurface: "chat",
  });
  assert.equal(decision.surface, "chat");
  assert.equal(decision.status, "ready");
  assert.equal(decision.executionMode, "chunked");
  assert.equal(decision.maxChunkSteps, 3);
  assert.equal(decision.approvalRequired, false);
});

test("uses Codex only after explicit approval", () => {
  const decision = routeReasoningTask({
    text: "Implement the repository code fix and run tests",
    approvedSurface: "codex",
  });
  assert.equal(decision.surface, "codex");
  assert.equal(decision.status, "ready");
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.executionMode, "single");
});

test("asks before using Work for materially cross-app work", () => {
  const decision = routeReasoningTask({
    text: "Coordinate Gmail and Calendar for this recurring workflow",
    crossApp: true,
    recurring: true,
  });
  assert.equal(decision.surface, "work");
  assert.equal(decision.status, "surface_approval_required");
  assert.equal(decision.approvalRequired, true);
  assert.equal(decision.approvalSurface, "work");
  assert.deepEqual(decision.continuationSurfaceOptions, ["chat", "work"]);
});

test("owner can choose Chat instead of Work and continue in bounded chunks", () => {
  const decision = routeReasoningTask({
    text: "Coordinate Gmail and Calendar for this recurring workflow",
    crossApp: true,
    recurring: true,
    approvedSurface: "chat",
  });
  assert.equal(decision.surface, "chat");
  assert.equal(decision.status, "ready");
  assert.equal(decision.executionMode, "chunked");
  assert.equal(decision.maxChunkSteps, 3);
});

test("uses Work only after explicit approval", () => {
  const decision = routeReasoningTask({
    text: "Coordinate Gmail and Calendar for this recurring workflow",
    crossApp: true,
    recurring: true,
    approvedSurface: "work",
  });
  assert.equal(decision.surface, "work");
  assert.equal(decision.status, "ready");
  assert.equal(decision.approvalRequired, false);
});

test("defers approved heavy reasoning after a soft budget is exhausted", () => {
  const decision = routeReasoningTask(
    { text: "Refactor repository code and update tests", approvedSurface: "codex" },
    { work: 0, codex: 3 },
    { work: 2, codex: 3 },
  );
  assert.equal(decision.surface, "codex");
  assert.equal(decision.status, "defer_heavy_reasoning");
  assert.equal(decision.budgetRemaining, 0);
});

test("continues in chunked Chat without asking when heavy routing is explicitly safe to avoid", () => {
  const decision = routeReasoningTask(
    { text: "Coordinate multiple sources", crossApp: true, fallbackToChatSafe: true },
    { work: 0, codex: 0 },
    { work: 2, codex: 3 },
  );
  assert.equal(decision.surface, "chat");
  assert.equal(decision.status, "ready");
  assert.equal(decision.approvalRequired, false);
  assert.equal(decision.executionMode, "chunked");
  assert.equal(decision.maxChunkSteps, 3);
});

test("approval for a different heavy surface cannot authorize this step", () => {
  const decision = routeReasoningTask({
    text: "Implement repository code",
    changesCode: true,
    approvedSurface: "work",
  });
  assert.equal(decision.surface, "codex");
  assert.equal(decision.status, "surface_approval_required");
  assert.equal(decision.approvalSurface, "codex");
});
