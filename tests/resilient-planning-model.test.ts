import assert from "node:assert/strict";
import test from "node:test";
import { ResilientPlanningModel } from "../src/orchestrator/resilient-planning-model.ts";
import type { PlanningModel } from "../src/orchestrator/model-planner.ts";

const input = {
  goal: { title: "Advance repository", successCriteria: ["verified"], constraints: [] },
  context: [],
};

test("retired GitHub Models provider becomes a bounded inspect plan", async () => {
  const inner: PlanningModel = {
    async plan() {
      throw new Error("GitHub Models HTTP 410");
    },
  };

  const plan = await new ResilientPlanningModel(inner).plan(input);
  assert.equal(plan.kind, "inspect");
  assert.match(plan.description, /Planner provider retired/);
  assert.match(plan.description, /No model-generated repository change was attempted/);
  assert.equal(plan.reason, "GitHub Models HTTP 410");
});

test("other provider failures become bounded unavailable plans", async () => {
  const inner: PlanningModel = {
    async plan() {
      throw new Error("network timeout");
    },
  };

  const plan = await new ResilientPlanningModel(inner).plan(input);
  assert.equal(plan.kind, "inspect");
  assert.match(plan.description, /Planner provider unavailable: network timeout/);
});

test("successful provider plans pass through unchanged", async () => {
  const expected = { kind: "inspect" as const, description: "Inspect current context" };
  const inner: PlanningModel = { async plan() { return expected; } };
  const plan = await new ResilientPlanningModel(inner).plan(input);
  assert.deepEqual(plan, expected);
});
