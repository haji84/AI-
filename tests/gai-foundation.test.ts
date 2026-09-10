import assert from "node:assert/strict";
import test from "node:test";

import { summarizeBenchmark, meetsInitialGaiTarget } from "../src/gai/benchmark.ts";
import { learnFromOutcome, shouldPromoteRule } from "../src/gai/learning.ts";
import { routeModel } from "../src/gai/model-router.ts";
import { evaluateImprovement } from "../src/gai/self-improvement.ts";

test("routes routine work locally and frontier work to Astra without API cost", () => {
  assert.equal(routeModel({ id: "1", description: "summarize logs", difficulty: 2, risk: "LOW" }).tier, "local");
  const frontier = routeModel({ id: "2", description: "research novel architecture", difficulty: 10, risk: "MEDIUM", requiresFrontierReasoning: true });
  assert.equal(frontier.tier, "astra");
  assert.equal(frontier.additionalApiCostAllowed, false);
});

test("turns outcomes into transferable rules", () => {
  const record = learnFromOutcome(
    { action: "use responsive layout", expectedOutcome: "mobile layout stays stable", confidence: 0.8 },
    { actualOutcome: "mobile layout stayed stable", success: true, evidence: ["visual regression passed"] },
  );
  assert.equal(shouldPromoteRule(record), true);
  assert.match(record.transferableRule ?? "", /reusing the strategy/);
});

test("accepts only benchmarked self-improvements with sufficient held-out gain", () => {
  assert.equal(evaluateImprovement({ id: "c1", parentVersion: "1", hypothesis: "x", changedComponents: ["planner"], benchmarkBefore: 0.6, benchmarkAfter: 0.64, status: "candidate" }).accept, true);
  assert.equal(evaluateImprovement({ id: "c2", parentVersion: "1", hypothesis: "x", changedComponents: ["planner"], benchmarkBefore: 0.6, benchmarkAfter: 0.6, status: "candidate" }).accept, false);
});

test("scores initial GAI target", () => {
  const results = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    passed: index < 85,
    humanInterventionCount: index < 5 ? 1 : 0,
    durationMs: 100,
    transferTask: index < 20,
  }));
  const summary = summarizeBenchmark(results);
  assert.equal(summary.successRate, 0.85);
  assert.equal(summary.humanInterventionRate, 0.05);
  assert.equal(meetsInitialGaiTarget(summary), true);
});
