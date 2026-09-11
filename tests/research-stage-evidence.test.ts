import assert from "node:assert/strict";
import test from "node:test";
import {
  buildR2ImprovementEvidence,
  buildR4LongHorizonEvidence,
  buildR6BenchmarkEvidence,
  buildR10RouterEvidence,
  buildR15CurriculumEvidence,
  buildR17SelfModificationEvidence,
  buildR18AdaptationEvidence,
} from "../src/gai/research-stage-evidence.ts";

const common = { runId: "run-1", source: "verified-artifact", collectedAt: "2026-09-11T00:00:00.000Z" };

test("R2 only promotes measurable heldout improvement without safety/cost/intervention regression", () => {
  const accepted = buildR2ImprovementEvidence({ ...common, heldoutBefore: 0.70, heldoutAfter: 0.73, humanInterventionBefore: 0.05, humanInterventionAfter: 0.04, safetyRegression: false, additionalApiCost: 0 });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(new Set(accepted.evidence.map((item) => item.kind)), new Set(["heldout-evaluation", "research-loop", "safety-regression", "cost-regression"]));
  assert.equal(buildR2ImprovementEvidence({ ...common, heldoutBefore: 0.70, heldoutAfter: 0.705, humanInterventionBefore: 0, humanInterventionAfter: 0, safetyRegression: false, additionalApiCost: 0 }).accepted, false);
});

test("R4 rejects short endurance runs", () => {
  assert.equal(buildR4LongHorizonEvidence({ ...common, totalSteps: 19, verifiedCompletionRate: 1, humanInterventionsPerStep: 0, safetyRegression: false }).accepted, false);
  assert.equal(buildR4LongHorizonEvidence({ ...common, totalSteps: 20, verifiedCompletionRate: 0.9, humanInterventionsPerStep: 0.05, safetyRegression: false }).accepted, true);
});

test("R6 requires a real >=100-case hashed benchmark with heldout cases", () => {
  const result = buildR6BenchmarkEvidence({ ...common, runMode: "REAL_SELF_HOSTED_LOCAL_MODEL", total: 120, heldoutTotal: 20, successRate: 0.8, heldoutSuccessRate: 0.75, suiteSha256: "a".repeat(64) });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.evidence.map((item) => item.kind), ["internal-baseline", "heldout-evaluation"]);
});

test("R10 preserves zero-payg and safety gates", () => {
  assert.equal(buildR10RouterEvidence({ ...common, evaluatedTasks: 20, fallbackVerified: true, safetyRegression: false, additionalApiCost: 0 }).accepted, true);
  assert.equal(buildR10RouterEvidence({ ...common, evaluatedTasks: 20, fallbackVerified: true, safetyRegression: false, additionalApiCost: 0.01 }).accepted, false);
});

test("R15 refuses heldout leakage", () => {
  assert.equal(buildR15CurriculumEvidence({ ...common, generatedTasks: 10, heldoutLeakageCount: 1, heldoutBefore: 0.7, heldoutAfter: 0.8 }).accepted, false);
});

test("R17 stays human-gated and requires rollback plus heldout improvement", () => {
  assert.equal(buildR17SelfModificationEvidence({ ...common, heldoutBefore: 0.7, heldoutAfter: 0.8, rollbackVerified: true, safetyRegression: false, humanApproved: false }).accepted, false);
  assert.equal(buildR17SelfModificationEvidence({ ...common, heldoutBefore: 0.7, heldoutAfter: 0.8, rollbackVerified: true, safetyRegression: false, humanApproved: true }).accepted, true);
});

test("R18 only promotes accepted zero-cost adaptation", () => {
  assert.equal(buildR18AdaptationEvidence({ ...common, accepted: true, heldoutBefore: 0.7, heldoutAfter: 0.75, forgetting: 0.005, additionalApiCost: 0 }).accepted, true);
  assert.equal(buildR18AdaptationEvidence({ ...common, accepted: true, heldoutBefore: 0.7, heldoutAfter: 0.75, forgetting: 0.005, additionalApiCost: 1 }).accepted, false);
});
