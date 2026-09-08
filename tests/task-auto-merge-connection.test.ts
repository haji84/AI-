import assert from "node:assert/strict";
import test from "node:test";
import { ModelBackedPlanner, type ModelPlan, type PlanningModel } from "../src/orchestrator/model-planner.ts";
import { createTaskCompletionAuthorization, requestsTaskCompletion } from "../src/orchestrator/task-authorization.ts";

const goal = {
  title: "Complete the requested app change",
  successCriteria: ["PR created"],
  constraints: ["only low/medium auto-merge"],
};

const intent = { summary: "finish the task", confidence: 1, evidence: [] };

test("完成させて is treated as explicit task completion authorization", () => {
  assert.equal(requestsTaskCompletion("これを完成させて"), true);
  const authorization = createTaskCompletionAuthorization("Issue #246を完成させて", {
    now: new Date("2026-09-08T00:00:00Z"),
  });
  assert.equal(authorization?.scopeId, "issue:246");
  assert.equal(authorization?.allowLowMediumMainMerge, true);
});

test("ModelBackedPlanner carries task authorization into bounded PR action input", async () => {
  const authorization = createTaskCompletionAuthorization("Issue #246を最後まで進めて", {
    now: new Date("2026-09-08T00:00:00Z"),
  });
  assert.ok(authorization);

  const plan: ModelPlan = {
    kind: "propose_pr",
    description: "Implement safe change",
    title: "feat: safe change",
    files: [{ path: "src/example.ts", content: "export const ok = true;\n" }],
  };
  const model: PlanningModel & { command: { plan: ModelPlan; taskAuthorization: typeof authorization } } = {
    command: { plan, taskAuthorization: authorization },
    async plan() { return plan; },
  };

  const planner = new ModelBackedPlanner(model, undefined, { explicitBoundedPlan: true });
  const action = await planner.proposeNextAction({ goal, context: [], intent });
  assert.ok(action);
  const input = action.input as {
    taskAuthorization?: { scopeId?: string };
    taskScopeId?: string;
  };
  assert.equal(input.taskAuthorization?.scopeId, "issue:246");
  assert.equal(input.taskScopeId, "issue:246");
});
