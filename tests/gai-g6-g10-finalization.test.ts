import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildAgiGapReport } from "../src/gai/agi-gap-report.ts";
import { summarizeBenchmark } from "../src/gai/benchmark.ts";
import type { BenchmarkOutcomeRecord } from "../src/gai/benchmark-history.ts";
import { defaultExternalBenchmarkAdapters, summarizeLongHorizon } from "../src/gai/long-horizon-evaluation.ts";
import { clusterFailures, decideExperiment, PersistentResearchHistory, proposeResearchHypotheses } from "../src/gai/research-loop.ts";

function failedRecord(taskId: string, actionId: string): BenchmarkOutcomeRecord {
  return {
    id: `${taskId}:1`, taskId, attempt: 1, split: "train", verified: true,
    actionId, passed: false, humanInterventionCount: 0, durationMs: 100,
    createdAt: new Date().toISOString(),
  };
}

test("clusters verified failures into research hypotheses", () => {
  const signals = clusterFailures([
    failedRecord("memory retrieval task", "memory:retrieve"),
    failedRecord("planning task", "planner:route"),
    failedRecord("another memory task", "memory:search"),
  ]);
  const hypotheses = proposeResearchHypotheses(signals);
  assert.equal(hypotheses[0]?.bottleneck, "memory");
  assert.equal(hypotheses[0]?.evidenceCount, 2);
});

test("accepts only held-out gains with zero cost and no regressions", () => {
  const accepted = decideExperiment({
    id: "exp-1", hypothesisId: "hypothesis:planner", benchmarkBefore: 0.70, benchmarkAfter: 0.74,
    humanInterventionBefore: 0.08, humanInterventionAfter: 0.06, additionalApiCost: 0, safetyRegression: false,
  });
  assert.equal(accepted.decision, "accepted");

  const paid = decideExperiment({ ...accepted, id: "exp-2", additionalApiCost: 0.01 });
  assert.equal(paid.decision, "rejected");

  const unsafe = decideExperiment({ ...accepted, id: "exp-3", safetyRegression: true });
  assert.equal(unsafe.decision, "rejected");
});

test("persists research history across restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gai-research-"));
  const file = join(dir, "research.json");
  try {
    const store = new PersistentResearchHistory(file);
    await store.saveHypothesis({ id: "h1", bottleneck: "planner", statement: "improve planner", expectedGain: 0.03, evidenceCount: 3, status: "proposed" });
    await store.recordExperiment(decideExperiment({
      id: "e1", hypothesisId: "h1", benchmarkBefore: 0.5, benchmarkAfter: 0.55,
      humanInterventionBefore: 0.1, humanInterventionAfter: 0.08, additionalApiCost: 0, safetyRegression: false,
    }));
    const restarted = new PersistentResearchHistory(file);
    assert.equal((await restarted.listExperiments()).length, 1);
    assert.equal((await restarted.listHypotheses())[0]?.status, "accepted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("measures long-horizon verified prefix and exposes external benchmark contracts", () => {
  const summary = summarizeLongHorizon([
    { step: 1, completed: true, verified: true, humanInterventions: 0, elapsedMs: 10 },
    { step: 2, completed: true, verified: true, humanInterventions: 0, elapsedMs: 20 },
    { step: 3, completed: false, verified: false, humanInterventions: 1, elapsedMs: 30 },
  ]);
  assert.equal(summary.longestVerifiedPrefix, 2);
  assert.equal(summary.completedSteps, 2);
  const adapters = defaultExternalBenchmarkAdapters();
  assert.deepEqual(adapters.map((item) => item.id), ["arc-agi", "swe-bench", "osworld", "memgym"]);
  assert.ok(adapters.every((item) => item.requiresExternalRuntime && !item.enabled));
});

test("AGI gap report never auto-claims AGI even when project gates pass", () => {
  const taskBenchmark = summarizeBenchmark(Array.from({ length: 100 }, (_, index) => ({
    id: String(index), passed: index < 90, humanInterventionCount: 0, durationMs: 10, transferTask: index < 20,
  })));
  const longHorizon = summarizeLongHorizon(Array.from({ length: 10 }, (_, index) => ({
    step: index + 1, completed: true, verified: true, humanInterventions: 0, elapsedMs: 10,
  })));
  const report = buildAgiGapReport({
    taskBenchmark, longHorizon, heldOutSelfImprovementGain: 0.02,
    transferSuccessRate: 0.9, worldModelCalibrationError: 0.1, additionalApiCost: 0,
  });
  assert.equal(report.readinessScore, 1);
  assert.equal(report.agiClaimAllowed, false);
  assert.match(report.conclusion, /not proof of AGI/i);
});
