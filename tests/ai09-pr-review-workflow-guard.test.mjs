import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(".github/workflows/goriq-ai09-pr-review.yml", "utf8");

function job(name, until) {
  const start = source.indexOf("\n  " + name + ":\n");
  if (start < 0) throw new Error("missing_review_job:" + name);
  const end = until ? source.indexOf("\n  " + until + ":\n", start + 1) : source.length;
  if (end < 0) throw new Error("missing_successor_job");
  return source.slice(start, end);
}

test("AI-09 workflow only listens for completed CI and defaults to no scopes", () => {
  assert.match(source, /\non:\n\s+workflow_run:\n\s+workflows: \["CI"\]\n\s+types: \[completed\]/);
  assert.match(source, /\npermissions: \{\}/);
  assert.doesNotMatch(source, /pull_request_target|id-token:\s*write|contents:\s*write|pull-requests:\s*write|actions:\s*write/);
  assert.match(source, /cancel-in-progress:\s*true/);
});

test("preflight is hosted, read-only and checks the live PR", () => {
  const s = job("preflight", "review");
  assert.match(s, /runs-on:\s*ubuntu-latest/);
  assert.match(s, /contents:\s*read/);
  assert.match(s, /pull-requests:\s*read/);
  assert.match(s, /ref:\s*main/);
  assert.match(s, /persist-credentials:\s*false/);
  assert.match(s, /node scripts\/goriq-ai09-preflight.mjs/);
  assert.doesNotMatch(s, /issues:\s*write/);
});

test("self-hosted Ollama job cannot write GitHub state or execute PR checkout", () => {
  const s = job("review", "comment");
  assert.match(s, /runs-on:\s*\[self-hosted, Windows, X64\]/);
  assert.match(s, /contents:\s*read/);
  assert.match(s, /pull-requests:\s*read/);
  assert.match(s, /ref:\s*\$\{\{ needs\.preflight\.outputs\.trusted_sha \}\}/);
  assert.match(s, /node scripts\/goriq-ai09-ci-review.mjs/);
  assert.doesNotMatch(s, /issues:\s*write|ref:\s*\$\{\{\s*github\.event\.pull_request|pull_request_target/);
  assert.match(s, /actions\/upload-artifact@v4/);
});

test("only hosted publisher can write issue comments after successful review", () => {
  const s = job("comment");
  assert.match(s, /runs-on:\s*ubuntu-latest/);
  assert.match(s, /needs\.review\.result == 'success'/);
  assert.match(s, /issues:\s*write/);
  assert.match(s, /contents:\s*read/);
  assert.match(s, /pull-requests:\s*read/);
  assert.match(s, /ref:\s*\$\{\{ needs\.preflight\.outputs\.trusted_sha \}\}/);
  assert.match(s, /node scripts\/goriq-ai09-post-review.mjs/);
  assert.doesNotMatch(s, /contents:\s*write|pull-requests:\s*write|actions:\s*write/);
});


test("review requires an owner-pinned ZBook runner before checkout", () => {
  const s = job("review", "comment");
  const identity = s.indexOf("- name: Verify owner-pinned ZBook runner name");
  const checkout = s.indexOf("- name: Checkout pinned trusted main reviewer code only");
  assert.ok(identity >= 0 && checkout > identity,
    "runner identity must be checked before any checkout or model execution");
  assert.match(s, /GORIQ_AI09_EXPECTED_RUNNER_NAME:\s*\$\{\{\s*vars\.GORIQ_AI09_EXPECTED_RUNNER_NAME\s*\}\}/);
  assert.match(s, /IsNullOrWhiteSpace\(\$expected\)/);
  assert.match(s, /\$env:RUNNER_NAME/);
  assert.match(s, /\[StringComparison\]::Ordinal/);
  assert.match(s, /AI09_RUNNER_IDENTITY_NOT_AUTHORIZED/);
  assert.match(s, /AI09_RUNNER_PLATFORM_NOT_AUTHORIZED/);
  assert.match(s, /AI09_RUNNER_ENVIRONMENT_NOT_AUTHORIZED/);
});

test("self-hosted review timeout can cover every bounded model chunk", () => {
  const reviewJob = job("review", "comment");
  const timeoutMatch = reviewJob.match(/timeout-minutes:\s*(\d+)/);
  const automation = readFileSync("src/orchestrator/ai09-pr-review-automation.mjs", "utf8");
  const inference = readFileSync("scripts/goriq-ai09-ci-review.mjs", "utf8");
  const chunkMatch = automation.match(/const MAX_CHUNKS = (\d+);/);
  const modelFunction = inference.split("async function localInfer(")[1]?.split("\nasync function main()")[0];
  const deadlineMatch = modelFunction?.match(/AbortSignal\.timeout\((\d+)\)/);
  assert.ok(timeoutMatch && chunkMatch && deadlineMatch, "required bounded limits missing");
  const jobMillis = Number(timeoutMatch[1]) * 60_000;
  const worstInferenceMillis = Number(chunkMatch[1]) * Number(deadlineMatch[1]);
  assert.ok(jobMillis >= worstInferenceMillis + 4 * 60_000,
    "review job must allow all model chunks plus finite overhead");
});

test("both trust boundaries reject incomplete API patches", () => {
  const reviewer = readFileSync("scripts/goriq-ai09-ci-review.mjs", "utf8");
  const poster = readFileSync("scripts/goriq-ai09-post-review.mjs", "utf8");
  for (const script of [reviewer, poster]) {
    assert.match(script, /import \{ assertCompleteComparison \}/);
    assert.match(script, /assertCompleteComparison\(/);
  }
});
