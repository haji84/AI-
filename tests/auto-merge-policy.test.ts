import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAutoMergeEligibility,
  evaluateTaskScopedAutoMergeEligibility,
} from "../src/orchestrator/auto-merge-policy.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";

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

test("task-scoped owner authorization allows verified LOW/MEDIUM main merge", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const taskAuthorization = createTaskCompletionAuthorization("Issue #248を最後まで進めて", { now });
  const decision = evaluateTaskScopedAutoMergeEligibility({
    baseBranch: "main",
    changedFiles: ["src/app/example.tsx", "tests/example.test.ts"],
    lintPassed: true,
    testsPassed: true,
    buildPassed: true,
    qaPassed: true,
    reviewerPassed: true,
    unresolvedReviewThreads: 0,
    destructiveChangeAbsent: true,
    privilegedChangeAbsent: true,
    taskAuthorization,
    taskScopeId: "issue:248",
  }, now);

  assert.equal(decision.eligible, true);
  assert.deepEqual(decision.reasons, []);
});

test("task authorization cannot auto-merge a different task", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const taskAuthorization = createTaskCompletionAuthorization("Issue #248を最後まで進めて", { now });
  const decision = evaluateTaskScopedAutoMergeEligibility({
    baseBranch: "main",
    changedFiles: ["src/app/example.tsx"],
    lintPassed: true,
    testsPassed: true,
    buildPassed: true,
    qaPassed: true,
    reviewerPassed: true,
    unresolvedReviewThreads: 0,
    destructiveChangeAbsent: true,
    privilegedChangeAbsent: true,
    taskAuthorization,
    taskScopeId: "issue:249",
  }, now);

  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes("task_completion_authorization_missing_or_invalid"));
});

test("PROJECT_STATE can only use task-scoped auto-merge when explicitly state-only", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const taskAuthorization = createTaskCompletionAuthorization("Issue #248を最後まで進めて", { now });
  const base = {
    baseBranch: "main",
    changedFiles: ["PROJECT_STATE.md"],
    lintPassed: true,
    testsPassed: true,
    buildPassed: true,
    qaPassed: true,
    reviewerPassed: true,
    unresolvedReviewThreads: 0,
    destructiveChangeAbsent: true,
    privilegedChangeAbsent: true,
    taskAuthorization,
    taskScopeId: "issue:248",
  };

  assert.equal(evaluateTaskScopedAutoMergeEligibility({ ...base, stateOnlyProjectStateChange: true }, now).eligible, true);
  assert.equal(evaluateTaskScopedAutoMergeEligibility({ ...base, stateOnlyProjectStateChange: false }, now).eligible, false);
});

test("governance and workflow paths stay outside task-scoped auto-merge", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const taskAuthorization = createTaskCompletionAuthorization("Issue #248を最後まで進めて", { now });

  for (const path of ["AGENTS.md", ".github/workflows/ci.yml", "package.json", "pnpm-lock.yaml"]) {
    const decision = evaluateTaskScopedAutoMergeEligibility({
      baseBranch: "main",
      changedFiles: [path],
      lintPassed: true,
      testsPassed: true,
      buildPassed: true,
      qaPassed: true,
      reviewerPassed: true,
      unresolvedReviewThreads: 0,
      destructiveChangeAbsent: true,
      privilegedChangeAbsent: true,
      taskAuthorization,
      taskScopeId: "issue:248",
    }, now);

    assert.equal(decision.eligible, false, path);
    assert.ok(decision.reasons.includes("unbounded_path"), path);
  }
});
