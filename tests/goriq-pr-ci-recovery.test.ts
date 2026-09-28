import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AUTOMATIC_ATTEMPTS,
  MAX_AUTOMATIC_ATTEMPTS_PER_STRATEGY,
  MAX_AUTOMATIC_STRATEGIES,
  SAME_FAILURE_SWITCH_THRESHOLD,
  allowedRepairPaths,
  buildRecoveryPrompt,
  chooseRecoveryStrategy,
  failureFingerprint,
  isSameRepositoryOpenPullRequest,
  parseRecoveryHistory,
  recoveryAttemptCount,
  sanitizeFailureLog,
  sanitizedBuilderEnvironment,
} from "../scripts/goriq-pr-ci-recovery.ts";

test("same-repository open PR only is eligible", () => {
  const base = {
    number: 10,
    state: "open",
    head: { ref: "feat/x", sha: "a".repeat(40), repo: { full_name: "haji84/AI-" } },
    base: { ref: "main", repo: { full_name: "haji84/AI-" } },
  };
  assert.equal(isSameRepositoryOpenPullRequest(base, "haji84/AI-"), true);
  assert.equal(isSameRepositoryOpenPullRequest({ ...base, state: "closed" }, "haji84/AI-"), false);
  assert.equal(isSameRepositoryOpenPullRequest({ ...base, head: { ...base.head, ref: "main" } }, "haji84/AI-"), false);
  assert.equal(isSameRepositoryOpenPullRequest({ ...base, head: { ...base.head, repo: { full_name: "fork/repo" } } }, "haji84/AI-"), false);
  assert.equal(isSameRepositoryOpenPullRequest({ ...base, base: { ref: "feat/parent", repo: { full_name: "haji84/AI-" } } }, "haji84/AI-"), true);
  assert.equal(isSameRepositoryOpenPullRequest({ ...base, base: { ref: "feat/parent", repo: { full_name: "fork/repo" } } }, "haji84/AI-"), false);
});

test("automatic recovery uses three attempts per strategy across three strategies", () => {
  assert.equal(MAX_AUTOMATIC_ATTEMPTS_PER_STRATEGY, 3);
  assert.equal(MAX_AUTOMATIC_STRATEGIES, 3);
  assert.equal(MAX_AUTOMATIC_ATTEMPTS, 9);
  assert.equal(SAME_FAILURE_SWITCH_THRESHOLD, 2);
  assert.equal(recoveryAttemptCount([
    "feat: one",
    "fix(ci): goriq recovery attempt 1",
    "fix(ci): goriq recovery strategy 2 attempt 1",
    "fix(ci): goriq recovery strategy 2 attempt 2",
  ]), 3);
});

test("failure fingerprint ignores volatile run ids timestamps and source line numbers", () => {
  const first = failureFingerprint("2026-09-28T01:02:03Z ERROR run 42 failed at src/a.ts:123:4 TypeError: x is not a function");
  const second = failureFingerprint("2026-09-28T09:10:11Z ERROR run 99 failed at src/a.ts:987:8 TypeError: x is not a function");
  assert.equal(first, second);
  assert.equal(first.length, 16);
});

test("recovery history reads strategy metadata and legacy attempts", () => {
  const history = parseRecoveryHistory([
    [
      "fix(ci): goriq recovery strategy 2 attempt 1",
      "",
      "GORIQ-Recovery-Strategy: 2",
      "GORIQ-Recovery-Strategy-Attempt: 1",
      "GORIQ-Recovery-Total-Attempt: 4",
      "GORIQ-Recovery-Failure-Fingerprint: abcdef0123456789",
    ].join("\n"),
    "fix(ci): goriq recovery attempt 3",
  ]);
  assert.deepEqual(history, [
    {
      strategy: 2,
      strategyAttempt: 1,
      totalAttempt: 4,
      failureFingerprint: "abcdef0123456789",
    },
    {
      strategy: 1,
      strategyAttempt: 3,
      totalAttempt: 3,
      failureFingerprint: "legacy-unknown",
    },
  ]);
});

test("strategy controller continues on progress and escalates on repeated failure or attempt budget", () => {
  const initial = chooseRecoveryStrategy([], "fp-initial");
  assert.deepEqual(initial, {
    action: "attempt",
    strategy: 1,
    strategyAttempt: 1,
    totalAttempt: 1,
    failureFingerprint: "fp-initial",
    sameFailureOccurrences: 1,
    reason: "initial",
  });

  const progress = chooseRecoveryStrategy([
    { strategy: 1, strategyAttempt: 1, totalAttempt: 1, failureFingerprint: "old-fingerprint" },
  ], "new-fingerprint");
  assert.equal(progress.action, "attempt");
  if (progress.action === "attempt") {
    assert.equal(progress.strategy, 1);
    assert.equal(progress.strategyAttempt, 2);
    assert.equal(progress.reason, "progress-continue");
  }

  const repeated = chooseRecoveryStrategy([
    { strategy: 1, strategyAttempt: 1, totalAttempt: 1, failureFingerprint: "same-failure" },
  ], "same-failure");
  assert.equal(repeated.action, "attempt");
  if (repeated.action === "attempt") {
    assert.equal(repeated.strategy, 2);
    assert.equal(repeated.strategyAttempt, 1);
    assert.equal(repeated.reason, "same-failure-escalation");
    assert.equal(repeated.sameFailureOccurrences, 2);
  }

  const budget = chooseRecoveryStrategy([
    { strategy: 1, strategyAttempt: 3, totalAttempt: 3, failureFingerprint: "fp-3" },
    { strategy: 1, strategyAttempt: 2, totalAttempt: 2, failureFingerprint: "fp-2" },
    { strategy: 1, strategyAttempt: 1, totalAttempt: 1, failureFingerprint: "fp-1" },
  ], "fp-4");
  assert.equal(budget.action, "attempt");
  if (budget.action === "attempt") {
    assert.equal(budget.strategy, 2);
    assert.equal(budget.strategyAttempt, 1);
    assert.equal(budget.reason, "strategy-budget-escalation");
  }
});

test("strategy controller requires human gate after the final strategy stagnates", () => {
  const decision = chooseRecoveryStrategy([
    { strategy: 3, strategyAttempt: 1, totalAttempt: 7, failureFingerprint: "same-final-failure" },
    { strategy: 2, strategyAttempt: 3, totalAttempt: 6, failureFingerprint: "previous" },
  ], "same-final-failure");
  assert.equal(decision.action, "human-gate");
  assert.equal(decision.reason, "strategies-exhausted");
});

test("repair scope excludes tests, workflow, canonical and dependency files", () => {
  assert.deepEqual(allowedRepairPaths([
    "src/gai/worker-runtime.ts",
    "tests/gai-worker.test.ts",
    ".github/workflows/ci.yml",
    "docs/JARVIS_PRODUCT_SPEC.md",
    "docs/jarvis-requirements.json",
    "docs/jarvis-reverse-traceability.json",
    "package.json",
    "pnpm-lock.yaml",
    "src/jarvis/worker-auth.ts",
    "src/app/api/jarvis/enrollment/route.ts",
  ]), ["src/gai/worker-runtime.ts"]);
});

test("failure evidence redacts tokens and stays bounded", () => {
  const value = "Bearer abc.def\ntoken=supersecret\n" + "x".repeat(70_000);
  const sanitized = sanitizeFailureLog(value);
  assert.doesNotMatch(sanitized, /abc\.def|supersecret/);
  assert.ok(sanitized.length <= 60_000);
});

test("recovery prompt preserves bounded authority while changing strategy", () => {
  const prompt = buildRecoveryPrompt({
    prNumber: 1363,
    strategy: 2,
    strategyAttempt: 1,
    totalAttempt: 4,
    decisionReason: "same-failure-escalation",
    failureFingerprint: "abcdef0123456789",
    allowedPaths: ["src/gai/worker-runtime.ts"],
    failureLog: "ReferenceError: helper is not defined",
  });
  assert.match(prompt, /Recovery strategy 2 of 3/);
  assert.match(prompt, /strategy attempt 1 of 3/);
  assert.match(prompt, /total attempt 4 of at most 9/);
  assert.match(prompt, /materially different implementation path/);
  assert.match(prompt, /src\/gai\/worker-runtime\.ts/);
  assert.match(prompt, /Do not commit, push, merge, deploy/);
  assert.match(prompt, /Do not weaken or delete tests/);
});

test("coding engine environment cannot see GitHub write credentials", () => {
  const env = sanitizedBuilderEnvironment({
    NODE_ENV: "test",
    PATH: "x",
    GITHUB_TOKEN: "ghs_secret",
    GH_TOKEN: "gh_secret",
    ACTIONS_RUNTIME_TOKEN: "actions_secret",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc_secret",
    CODE_BUILDER_TOKEN: "builder_secret",
    OPENAI_API_KEY: "model_auth_preserved",
  });
  assert.equal(env.PATH, "x");
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.ACTIONS_RUNTIME_TOKEN, undefined);
  assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
  assert.equal(env.CODE_BUILDER_TOKEN, undefined);
  assert.equal(env.OPENAI_API_KEY, "model_auth_preserved");
});
