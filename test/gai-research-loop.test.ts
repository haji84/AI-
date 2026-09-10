import assert from "node:assert/strict";
import test from "node:test";

import type { BenchmarkOutcomeRecord } from "../src/gai/benchmark-history.ts";
import { BoundedResearchLoop } from "../src/gai/research-loop.ts";

function failure(taskId: string, actionId: string): BenchmarkOutcomeRecord {
  return {
    id: `failure:${taskId}`,
    taskId,
    attempt: 1,
    split: "train",
    verified: true,
    actionId,
    passed: false,
    humanInterventionCount: 0,
    durationMs: 10,
    createdAt: "2026-09-10T00:00:00.000Z",
  };
}

test("clusters repeated verified training failures into bounded hypotheses", () => {
  const loop = new BoundedResearchLoop();
  const hypotheses = loop.generateHypotheses([
    failure("task-a", "planner:select"),
    failure("task-b", "planner:select"),
    { ...failure("heldout", "planner:select"), split: "heldout" },
  ]);
  assert.equal(hypotheses.length, 1);
  assert.equal(hypotheses[0]?.bottleneck, "planner");
  assert.deepEqual(hypotheses[0]?.evidenceTaskIds, ["task-a", "task-b"]);
});

test("candidate is reversible, governance-preserving, and zero-cost", () => {
  const loop = new BoundedResearchLoop();
  const hypothesis = loop.generateHypotheses([failure("a", "tool:run"), failure("b", "adapter:run")])[0];
  assert.ok(hypothesis);
  const candidate = loop.proposeCandidate(hypothesis);
  assert.equal(candidate.reversible, true);
  assert.equal(candidate.changesGovernance, false);
  assert.equal(candidate.additionalApiCost, 0);
});

test("accepts only meaningful held-out gain without safety cost or intervention regression", () => {
  const loop = new BoundedResearchLoop({ minHeldoutGain: 0.05 });
  assert.deepEqual(loop.evaluateHeldout({
    candidateId: "candidate:1",
    baselineSuccessRate: 0.6,
    candidateSuccessRate: 0.7,
    baselineInterventions: 2,
    candidateInterventions: 2,
    additionalApiCost: 0,
    safetyRegression: false,
  }).accepted, true);

  assert.equal(loop.evaluateHeldout({
    candidateId: "candidate:2",
    baselineSuccessRate: 0.6,
    candidateSuccessRate: 0.8,
    baselineInterventions: 2,
    candidateInterventions: 2,
    additionalApiCost: 1,
    safetyRegression: false,
  }).reason, "cost_regression");

  assert.equal(loop.evaluateHeldout({
    candidateId: "candidate:3",
    baselineSuccessRate: 0.6,
    candidateSuccessRate: 0.8,
    baselineInterventions: 2,
    candidateInterventions: 3,
    additionalApiCost: 0,
    safetyRegression: false,
  }).reason, "intervention_regression");

  assert.equal(loop.evaluateHeldout({
    candidateId: "candidate:4",
    baselineSuccessRate: 0.6,
    candidateSuccessRate: 0.8,
    baselineInterventions: 2,
    candidateInterventions: 2,
    additionalApiCost: 0,
    safetyRegression: true,
  }).reason, "safety_regression");
});
