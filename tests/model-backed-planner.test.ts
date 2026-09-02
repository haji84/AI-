import assert from "node:assert/strict";
import test from "node:test";
import { ModelBackedPlanner, detectLocalOnlyBlocker, type PlanningModel } from "../src/orchestrator/model-planner.ts";
import type { ContextItem, Goal } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "Advance repository",
  successCriteria: ["verified"],
  constraints: ["Human Gate for merge"],
};

const intent = { summary: "advance", confidence: 0.9, evidence: [] };

test("explicit machine-bound state is surfaced as a blocker instead of inspect looping", async () => {
  const context: ContextItem[] = [{
    source: "repository.file:PROJECT_STATE.md",
    summary: "NEXT_PRIORITY: Complete the machine-bound image-editing acceptance requirement before advancing Phase 3",
  }];
  assert.ok(detectLocalOnlyBlocker(context));
  const model: PlanningModel = { async plan() { throw new Error("model must not be called for local blocker"); } };
  const action = await new ModelBackedPlanner(model).proposeNextAction({ goal, context, intent });
  assert.equal(action?.capability, "runtime.local_blocker");
  assert.equal(action?.externalSideEffect, false);
});

test("cloud-safe model plan becomes a bounded low-risk PR proposal action", async () => {
  const context: ContextItem[] = [{ source: "repository.file:PROJECT_STATE.md", summary: "NEXT_PRIORITY: improve unit test coverage" }];
  const model: PlanningModel = {
    async plan() {
      return {
        kind: "propose_pr",
        description: "Add a regression test",
        title: "test: add regression coverage",
        body: "Generated bounded proposal",
        files: [{ path: "tests/example.test.ts", content: "export {};\n" }],
      };
    },
  };
  const action = await new ModelBackedPlanner(model).proposeNextAction({ goal, context, intent });
  assert.equal(action?.capability, "repository.propose_pr");
  assert.equal(action?.risk, "low");
  assert.equal(action?.externalSideEffect, true);
  assert.deepEqual((action?.input as { files: unknown[] }).files.length, 1);
});
