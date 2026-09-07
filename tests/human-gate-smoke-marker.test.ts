import assert from "node:assert/strict";
import test from "node:test";
import type { InferredIntent, Planner, ProposedAction } from "../src/orchestrator/goal-loop.ts";
import { HUMAN_GATE_SMOKE_MARKER, TeamAwarePlanner } from "../src/orchestrator/team-aware-planner.ts";

const intent: InferredIntent = { summary: "smoke", confidence: 1, evidence: [] };
const goal = { title: "Human Gate smoke", successCriteria: ["verified"], constraints: ["no side effects"] };

function delegateFor(action: ProposedAction): Planner {
  return {
    async inferIntent() { return intent; },
    async proposeNextAction() { return action; },
  };
}

test("explicit harmless smoke marker becomes a real HIGH Human Gate without side effects", async () => {
  const planner = new TeamAwarePlanner(delegateFor({
    id: "inspect-smoke",
    description: `${HUMAN_GATE_SMOKE_MARKER} verify one-tap approval path`,
    capability: "context.inspect",
    risk: "low",
    completesBoundedCommand: true,
  }), { explicitBoundedPlan: true });

  const action = await planner.proposeNextAction({ goal, context: [], intent });
  assert.ok(action);
  assert.equal(action.capability, "context.inspect");
  assert.equal(action.risk, "high");
  assert.equal(action.requiresHumanApproval, true);
  assert.equal(action.irreversible, false);
  assert.equal(action.externalSideEffect, false);
  assert.deepEqual(action.riskSignals, { highRiskMainMerge: true });
  assert.deepEqual(action.input, { smoke: "human_gate_high", harmless: true, originalInput: null });
});

test("ordinary explicit inspect remains LOW and unchanged", async () => {
  const original: ProposedAction = {
    id: "inspect-normal",
    description: "inspect repository status",
    capability: "context.inspect",
    risk: "low",
    completesBoundedCommand: true,
  };
  const planner = new TeamAwarePlanner(delegateFor(original), { explicitBoundedPlan: true });
  const action = await planner.proposeNextAction({ goal, context: [], intent });
  assert.deepEqual(action, original);
});
