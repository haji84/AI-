import assert from "node:assert/strict";
import test from "node:test";
import { benchmarkCases, suiteMeta } from "../benchmarks/internal/v1_1/suite.mjs";
import { verifyTypedBenchmark } from "../src/gai/typed-benchmark-verifier.ts";

test("Benchmark Suite v1.1 is frozen at 120 unique cases with 20 heldout", () => {
  assert.equal(suiteMeta.expectedCaseCount, 120);
  assert.equal(benchmarkCases.length, 120);
  assert.equal(benchmarkCases.filter((item) => item.split === "heldout").length, 20);
  assert.equal(new Set(benchmarkCases.map((item) => item.id)).size, 120);
  assert.equal(new Set(benchmarkCases.map((item) => item.promptSha256)).size, 120);
  assert.equal(new Set(benchmarkCases.map((item) => item.category)).size, 10);
});

test("typed verifier tolerates harmless representation differences", () => {
  assert.equal(verifyTypedBenchmark({ type: "exact", expected: "PASS" }, " pass \n"), true);
  assert.equal(verifyTypedBenchmark({ type: "number", expected: 42, tolerance: 1e-9 }, "42.0000000001"), true);
  assert.equal(verifyTypedBenchmark({ type: "contains", expected: "string[]" }, "type Names = string[];"), true);
  assert.equal(verifyTypedBenchmark({ type: "json", expected: { name: "x", qty: 2, active: true } }, "```json\n{\"active\":true,\"qty\":2,\"name\":\"x\"}\n```"), true);
  assert.equal(verifyTypedBenchmark({ type: "set", expected: ["2", "5"] }, "5, 2"), true);
});

test("typed verifier rejects semantic mismatches", () => {
  assert.equal(verifyTypedBenchmark({ type: "exact", expected: "YES" }, "NO"), false);
  assert.equal(verifyTypedBenchmark({ type: "number", expected: 10, tolerance: 0 }, "11"), false);
  assert.equal(verifyTypedBenchmark({ type: "set", expected: ["a", "b"] }, "a,c"), false);
});
