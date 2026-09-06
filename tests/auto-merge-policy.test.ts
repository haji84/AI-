import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutoMergeEligibility } from "../src/orchestrator/auto-merge-policy.ts";

test("verified bounded source change is eligible for auto-merge", () => {
  const decision = evaluateAutoMergeEligibility({
    baseBranch: "main",
    changedFiles: ["src/orchestrator/example.ts", "tests/example.test.ts"],
    lintPassed: true,
    testsPassed: true,
    buildPassed: true,
  });
  assert.equal(decision.eligible, true);
  assert.deepEqual(decision.reasons, []);
});

test("privileged repository paths cannot auto-merge", () => {
  for (const path of [".github/workflows/ci.yml", "AGENTS.md", "PROJECT_STATE.md", "package.json", "pnpm-lock.yaml"]) {
    const decision = evaluateAutoMergeEligibility({
      baseBranch: "main",
      changedFiles: [path],
      lintPassed: true,
      testsPassed: true,
      buildPassed: true,
    });
    assert.equal(decision.eligible, false, path);
    assert.ok(decision.reasons.includes("unbounded_path"), path);
  }
});

test("missing verification blocks auto-merge without creating a Human Gate", () => {
  const decision = evaluateAutoMergeEligibility({
    baseBranch: "main",
    changedFiles: ["docs/example.md"],
    lintPassed: true,
    testsPassed: false,
    buildPassed: true,
  });
  assert.equal(decision.eligible, false);
  assert.deepEqual(decision.reasons, ["tests_not_verified"]);
});

test("draft, empty, or non-main proposals are not eligible", () => {
  assert.equal(evaluateAutoMergeEligibility({
    baseBranch: "develop",
    changedFiles: ["src/example.ts"],
    lintPassed: true,
    testsPassed: true,
    buildPassed: true,
  }).eligible, false);
  assert.equal(evaluateAutoMergeEligibility({
    baseBranch: "main",
    changedFiles: [],
    lintPassed: true,
    testsPassed: true,
    buildPassed: true,
  }).eligible, false);
  assert.equal(evaluateAutoMergeEligibility({
    baseBranch: "main",
    changedFiles: ["src/example.ts"],
    lintPassed: true,
    testsPassed: true,
    buildPassed: true,
    draft: true,
  }).eligible, false);
});
