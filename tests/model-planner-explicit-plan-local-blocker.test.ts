import assert from "node:assert/strict";
import test from "node:test";
import type { ContextItem, Goal, InferredIntent } from "../src/orchestrator/goal-loop.ts";
import { ModelBackedPlanner, type ModelPlan, type PlanningModel } from "../src/orchestrator/model-planner.ts";

const goal: Goal = {
  title: "Run bounded smoke",
  successCriteria: ["verified"],
  constraints: ["preserve Human Gate"],
};

const intent: InferredIntent = { summary: "execute explicit bounded plan", confidence: 1, evidence: [] };

const blockedContext: ContextItem[] = [
  {
    source: "repository.file:PROJECT_STATE.md",
    summary: "NEXT_PRIORITY: run real-machine local runtime GPU smoke",
  },
  {
    source: "github.repository_state",
    summary: "live repository state",
    data: {
      openIssues: [
        {
          number: 158,
          title: "test: live Chat loop smoke",
          body: "Do not claim local-runtime evidence. Create one bounded docs PR.",
        },
      ],
    },
  },
];

class ExplicitCommandModel implements PlanningModel {
  readonly command = {
    plan: {
      kind: "propose_pr" as const,
      description: "create smoke PR",
      title: "test: record live autonomy loop smoke",
      files: [{ path: "docs/autonomy-live-smoke.md", content: "verified\n" }],
    },
  };

  async plan(): Promise<ModelPlan> {
    return this.command.plan;
  }
}

test("explicit command plan bypasses unrelated model-planner local blocker fallback", async () => {
  const planner = new ModelBackedPlanner(new ExplicitCommandModel());
  const action = await planner.proposeNextAction({ goal, intent, context: blockedContext });

  assert.equal(action?.capability, "repository.propose_pr");
  assert.equal(action?.risk, "low");
  assert.equal(action?.externalSideEffect, true);
  assert.deepEqual(action?.input, {
    title: "test: record live autonomy loop smoke",
    body: undefined,
    files: [{ path: "docs/autonomy-live-smoke.md", content: "verified\n" }],
  });
});

test("planner without explicit plan keeps local blocker fallback", async () => {
  let modelCalled = false;
  const model: PlanningModel = {
    async plan() {
      modelCalled = true;
      return { kind: "inspect", description: "inspect" };
    },
  };
  const planner = new ModelBackedPlanner(model);
  const action = await planner.proposeNextAction({ goal, intent, context: blockedContext });

  assert.equal(modelCalled, false);
  assert.equal(action?.capability, "runtime.local_blocker");
});
