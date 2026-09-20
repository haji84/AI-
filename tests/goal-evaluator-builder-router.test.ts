import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGoalFromWorkState } from "../src/orchestrator/goal-evaluator.ts";
import { BuilderRouter } from "../src/orchestrator/builder-router.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

function state(): WorkState {
  return {
    goalId: "g", objective: "complete", status: "IN_PROGRESS", riskClass: "R1", constraints: [],
    definitionOfDone: [
      { id: "a", description: "A", required: true },
      { id: "b", description: "B", required: true },
    ],
    currentState: "", decisions: [], artifacts: [], verificationResults: [], childWorkItems: [], blockers: [], nextAction: null,
    updatedAt: new Date(0).toISOString(),
  };
}

test("Goal is not achieved merely because work ran", () => {
  const result = evaluateGoalFromWorkState(state());
  assert.equal(result.achieved, false);
  assert.deepEqual(result.unverifiedRequired, ["a", "b"]);
});

test("Goal is achieved only when every required criterion is verified and blockers are clear", () => {
  const input = state();
  input.verificationResults = [{ itemId: "a", passed: true }, { itemId: "b", passed: true }];
  assert.equal(evaluateGoalFromWorkState(input).achieved, true);
  input.blockers = ["device evidence missing"];
  assert.equal(evaluateGoalFromWorkState(input).achieved, false);
});

test("Builder router fails closed instead of faking coding success when no real Builder is available", async () => {
  const router = new BuilderRouter([]);
  const result = await router.execute({
    id: "build-1",
    description: "change code",
    capability: "code.builder",
    risk: "low",
    input: { goalId: "g", attemptId: "a1", strategyId: "s1", objective: "change code" },
  }, []);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "real_builder_capability_unavailable");
});
