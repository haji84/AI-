import assert from "node:assert/strict";
import test from "node:test";
import { CopilotCliPlanningClient } from "../src/orchestrator/copilot-cli-planner.ts";
import { GitHubModelsPlanningClient } from "../src/orchestrator/model-planner.ts";
import { createPlanningModel, WorkCloudPlanningClient } from "../src/orchestrator/planning-provider.ts";

test("defaults to Work cloud without invoking a separately metered provider", async () => {
  const previous = process.env.AUTONOMY_PLANNER_PROVIDER;
  delete process.env.AUTONOMY_PLANNER_PROVIDER;
  try {
    const model = createPlanningModel({ token: "unused" });
    assert.ok(model instanceof WorkCloudPlanningClient);
    const plan = await model.plan({
      goal: { id: "g", title: "Continue safely" },
      context: [],
    });
    assert.equal(plan.kind, "inspect");
    assert.equal(plan.reason, "work_cloud_external_planner");
  } finally {
    if (previous === undefined) delete process.env.AUTONOMY_PLANNER_PROVIDER;
    else process.env.AUTONOMY_PLANNER_PROVIDER = previous;
  }
});

test("keeps Copilot CLI available only through explicit selection", () => {
  assert.ok(createPlanningModel({ provider: "copilot-cli" }) instanceof CopilotCliPlanningClient);
});

test("keeps retired GitHub Models available only through explicit legacy selection", () => {
  assert.ok(createPlanningModel({ provider: "github-models", token: "test-token" }) instanceof GitHubModelsPlanningClient);
});

test("rejects unknown planner providers", () => {
  assert.throws(() => createPlanningModel({ provider: "unknown" }), /unsupported autonomy planner provider/);
});
