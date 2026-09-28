import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AUTOMATIC_ATTEMPTS,
  allowedRepairPaths,
  buildRecoveryPrompt,
  isSameRepositoryOpenPullRequest,
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

test("automatic recovery is capped at three fixer commits", () => {
  assert.equal(MAX_AUTOMATIC_ATTEMPTS, 3);
  assert.equal(recoveryAttemptCount([
    "feat: one",
    "fix(ci): goriq recovery attempt 1",
    "fix(ci): goriq recovery attempt 2",
    "fix(ci): goriq recovery attempt 3",
  ]), 3);
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
  ]), ["src/gai/worker-runtime.ts"]);
});

test("failure evidence redacts tokens and stays bounded", () => {
  const value = "Bearer abc.def\ntoken=supersecret\n" + "x".repeat(70_000);
  const sanitized = sanitizeFailureLog(value);
  assert.doesNotMatch(sanitized, /abc\.def|supersecret/);
  assert.ok(sanitized.length <= 60_000);
});

test("recovery prompt preserves bounded authority", () => {
  const prompt = buildRecoveryPrompt({
    prNumber: 1363,
    attempt: 2,
    allowedPaths: ["src/gai/worker-runtime.ts"],
    failureLog: "ReferenceError: helper is not defined",
  });
  assert.match(prompt, /attempt 2 of 3/);
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
