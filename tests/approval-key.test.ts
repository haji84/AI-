import assert from "node:assert/strict";
import test from "node:test";
import { createApprovalKey } from "../src/orchestrator/approval-key.ts";
import type { Goal, ProposedAction } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "Ship safely",
  successCriteria: ["verified"],
  constraints: ["preserve Human Gate"],
};

test("approval key ignores volatile action id but binds material action content", () => {
  const first: ProposedAction = {
    id: "runtime-1",
    description: "Deploy production",
    capability: "deploy",
    risk: "low",
    riskSignals: { productionDeploy: true },
    input: { release: "v1", region: "ap-northeast-1" },
  };
  const sameActionNewRuntimeId: ProposedAction = { ...first, id: "runtime-2" };
  const changedAction: ProposedAction = { ...first, id: "runtime-3", input: { release: "v2", region: "ap-northeast-1" } };

  assert.equal(createApprovalKey(goal, first), createApprovalKey(goal, sameActionNewRuntimeId));
  assert.notEqual(createApprovalKey(goal, first), createApprovalKey(goal, changedAction));
});
