import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { applyExecutionReadyGoalDraft } from "../src/orchestrator/goal-draft-compass.ts";

function readyDraft() {
  return {
    title: "Run the AI company from a collaboratively defined goal",
    desiredOutcome: "Chat/Work/Codex and the user define the goal, then GitHub Actions executes only the bounded plan.",
    successCriteria: ["Compass stores the agreed goal", "Execution uses that goal"],
    constraints: ["No additional AI API billing"],
    assumptions: ["GitHub Actions is available"],
    unresolvedQuestions: [],
    confidence: 0.92,
    approvalRequired: false,
  } as const;
}

test("writes an execution-ready collaborative goal into Compass", () => {
  const compass = new CompassStore(":memory:");
  try {
    const result = applyExecutionReadyGoalDraft(compass, readyDraft());
    assert.equal(result.ready, true);
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(compass.getGoal(), result.goal);
    assert.equal(result.goal?.title, readyDraft().title);
    assert.equal(result.goal?.description, readyDraft().desiredOutcome);
    assert.deepEqual(result.goal?.successCriteria, readyDraft().successCriteria);
    assert.deepEqual(result.goal?.constraints, readyDraft().constraints);
  } finally {
    compass.close();
  }
});

test("does not mutate Compass when the collaborative goal is not ready", () => {
  const compass = new CompassStore(":memory:");
  try {
    compass.setGoal({ title: "existing goal", description: "keep me" });
    const before = compass.getGoal();
    const result = applyExecutionReadyGoalDraft(compass, {
      ...readyDraft(),
      confidence: 0.5,
      approvalRequired: true,
    });
    assert.equal(result.ready, false);
    assert.deepEqual(result.reasons, ["low_confidence", "user_approval_required"]);
    assert.equal(result.goal, null);
    assert.deepEqual(compass.getGoal(), before);
  } finally {
    compass.close();
  }
});
