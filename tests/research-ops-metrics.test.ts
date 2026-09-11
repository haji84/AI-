import assert from "node:assert/strict";
import test from "node:test";
import { comparePairedBinary, repeatRunVariance, sampleSizeWarning, wilsonInterval } from "../src/gai/research-statistics.ts";
import { evaluateCalibration } from "../src/gai/world-model-calibration.ts";
import { evaluateContinualLearning, forwardTransfer } from "../src/gai/continual-learning-metrics.ts";
import { guardCurriculum, taskFingerprint } from "../src/gai/curriculum-guard.ts";
import { evaluateModelAdaptation } from "../src/gai/model-adaptation-gate.ts";
import { evaluateReplication } from "../src/gai/replication-evaluation.ts";
import { buildResearchDossier } from "../src/gai/research-dossier.ts";

test("research statistics expose uncertainty and paired deltas", () => {
  const interval = wilsonInterval(80, 100);
  assert.equal(interval.estimate, 0.8);
  assert.ok(interval.lower < 0.8 && interval.upper > 0.8);
  const paired = comparePairedBinary([
    { id: "a", before: false, after: true },
    { id: "b", before: true, after: true },
    { id: "c", before: true, after: false },
    { id: "d", before: false, after: true },
  ]);
  assert.equal(paired.improved, 2);
  assert.equal(paired.regressed, 1);
  assert.equal(paired.delta, 0.25);
  assert.ok(sampleSizeWarning(10));
  assert.equal(sampleSizeWarning(50), null);
  assert.ok(repeatRunVariance([0.7, 0.8, 0.9]).standardDeviation > 0);
});

test("world-model calibration reports Brier score and ECE", () => {
  const report = evaluateCalibration([
    { id: "a", confidence: 0.9, occurred: true },
    { id: "b", confidence: 0.8, occurred: true },
    { id: "c", confidence: 0.2, occurred: false },
    { id: "d", confidence: 0.1, occurred: false },
  ], 5);
  assert.ok(report.brierScore < 0.1);
  assert.ok(report.expectedCalibrationError >= 0);
  assert.equal(report.count, 4);
});

test("continual-learning metrics expose transfer and forgetting", () => {
  const report = evaluateContinualLearning(
    [{ taskId: "a", score: 0.8 }, { taskId: "b", score: 0.5 }],
    [{ taskId: "a", score: 0.7 }, { taskId: "b", score: 0.8 }],
  );
  assert.equal(report.commonTasks, 2);
  assert.ok(report.forgetting > 0);
  assert.equal(report.regressedTasks[0], "a");
  assert.ok(Math.abs(forwardTransfer(0.4, 0.6) - 0.2) < 1e-12);
});

test("curriculum guard blocks heldout leakage and duplicates", () => {
  const heldoutPrompt = "Secret heldout prompt";
  const result = guardCurriculum([
    { id: "train-1", prompt: "New hard task", sourceFailureIds: ["f1"], difficulty: 2 },
    { id: "train-2", prompt: heldoutPrompt, sourceFailureIds: ["f2"], difficulty: 3 },
    { id: "train-3", prompt: "New hard task", sourceFailureIds: ["f3"], difficulty: 4 },
  ], new Set(["heldout-1"]), new Set([taskFingerprint(heldoutPrompt)]));
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 2);
});

test("model adaptation rejects regressions, cost, or unjustified tuning", () => {
  const accepted = evaluateModelAdaptation({
    id: "candidate",
    method: "qlora",
    baselineHeldout: 0.7,
    adaptedHeldout: 0.75,
    forgetting: 0.005,
    safetyRegression: false,
    additionalPaygApiCost: 0,
    benchmarkJustifiedBottleneck: true,
  });
  assert.equal(accepted.accept, true);
  const rejected = evaluateModelAdaptation({
    id: "bad",
    method: "lora",
    baselineHeldout: 0.7,
    adaptedHeldout: 0.8,
    forgetting: 0.02,
    safetyRegression: false,
    additionalPaygApiCost: 0,
    benchmarkJustifiedBottleneck: true,
  });
  assert.equal(rejected.accept, false);
});

test("replication and dossier remain conservative", () => {
  const replication = evaluateReplication([
    { name: "successRate", original: 0.8, replicated: 0.79, tolerance: 0.02 },
  ]);
  assert.equal(replication.allWithinTolerance, true);

  const dossier = buildResearchDossier({
    evidence: [],
    contradictions: [{ id: "c1", description: "independent result disagrees", severity: "high", resolved: false }],
    independentExternalValidation: false,
    unresolvedSafetyRegression: false,
    additionalPaygApiCost: 0,
    generatedAt: "2026-09-11T00:00:00.000Z",
  });
  assert.equal(dossier.agiClaim.allowed, false);
  assert.equal(dossier.unresolvedContradictions, 1);
});
