import assert from "node:assert/strict";
import test from "node:test";
import { validateExternalBenchmarkRun, type ExternalBenchmarkRun } from "../src/gai/external-benchmark-evidence.ts";

const valid = (): ExternalBenchmarkRun => ({
  id: "run-1",
  benchmark: "swe-bench",
  harnessRepository: "https://github.com/SWE-bench/SWE-bench",
  harnessRevision: "abc123",
  officialOrCompatibleHarness: true,
  model: "local-model",
  runtime: "self-hosted-zbook",
  taskCount: 50,
  score: 0.42,
  scoreName: "resolved_rate",
  rawArtifactSha256: "a".repeat(64),
  completedAt: "2026-09-11T00:00:00.000Z",
  additionalApiCost: 0,
});

test("R3 accepts zero-cost real provenance and emits external evidence", () => {
  const decision = validateExternalBenchmarkRun(valid(), "R3");
  assert.equal(decision.accepted, true);
  assert.equal(decision.evidence?.kind, "external-benchmark");
  assert.equal(decision.evidence?.verified, true);
});

test("R12 requires interactive provenance", () => {
  const rejected = validateExternalBenchmarkRun(valid(), "R12");
  assert.equal(rejected.accepted, false);
  const accepted = validateExternalBenchmarkRun({ ...valid(), benchmark: "osworld", interactive: true }, "R12");
  assert.equal(accepted.accepted, true);
});

test("R19 requires independent environment", () => {
  const rejected = validateExternalBenchmarkRun(valid(), "R19");
  assert.equal(rejected.accepted, false);
  const accepted = validateExternalBenchmarkRun({ ...valid(), independentEnvironment: true }, "R19");
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.evidence?.kind, "independent-replication");
});

test("pay-as-you-go cost and missing artifact hash are rejected", () => {
  const decision = validateExternalBenchmarkRun({ ...valid(), additionalApiCost: 0.01, rawArtifactSha256: "bad" }, "R3");
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.some((reason) => reason.includes("cost")));
  assert.ok(decision.reasons.some((reason) => reason.includes("SHA")));
});
