import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { runRecoveryPreflight } from "../scripts/goriq-pr-ci-recovery-preflight.mjs";
import { eligibleCiPullRequest } from "../src/orchestrator/ai09-pr-review-automation.mjs";
import { verifierCommand } from "../scripts/jarvis-independent-check-runner.mjs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const ci = read(".github/workflows/ci.yml");

test("existing CI admits submitted PR reviews only, preserving ordinary PR, manual and main push events", () => {
  const events = ci.split("\non:\n")[1].split("\npermissions:\n")[0];
  const review = events.match(/^ {2}pull_request_review:\n {4}types: \[([^\]]+)\]$/m);
  assert.ok(review, "submitted review event must be explicitly declared");
  assert.deepEqual(review[1].split(",").map(x => x.trim()), ["submitted"]);
  assert.match(events, /^ {2}pull_request:$/m);
  assert.match(events, /^ {2}workflow_dispatch:$/m);
  assert.match(events, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.doesNotMatch(events, /pull_request_target|pull_request_review_comment/);
  assert.doesNotMatch(ci, /github\.event\.review\.state/);
});

test("review CI retains the four existing jobs, read-only permissions and exact PR-head signed-six producer", () => {
  const jobs = ci.split("\njobs:\n")[1];
  assert.deepEqual([...jobs.matchAll(/^ {2}([a-z-]+):$/gm)].map(match => match[1]),
    ["repository-guard", "project-checks", "independent-verifier-container", "windows-runtime-byte-fixtures"]);
  assert.match(ci, /\npermissions:\n {2}contents: read\n\njobs:/);
  const producer = jobs.split("  independent-verifier-container:\n")[1].split("  windows-runtime-byte-fixtures:\n")[0];
  assert.match(producer, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\n\s+persist-credentials: false/);
  assert.match(producer, /name: Real restricted-container six-check verification\n\s+if: \$\{\{ !cancelled\(\) \}\}\n\s+run: node scripts\/jarvis-verifier-live-ci\.mjs --execute-hosted-ci/);
  for (const [check, args] of Object.entries({ lint: ["lint"], typecheck: ["exec", "tsc", "--noEmit"],
    unit: ["test"], integration: ["test"], security: ["test:p8-security"], build: ["build", "--webpack"] })) {
    assert.deepEqual(verifierCommand(check), ["pnpm", args]);
  }
});

test("actual recovery preflight rejects successful and failed review-event CI before any GitHub access", async () => {
  for (const conclusion of ["failure", "success"]) {
    let accesses = 0;
    const github = new Proxy({}, { get() { accesses++; throw Error("PUBLIC_GITHUB_ACCESS_FORBIDDEN"); } });
    const outputs = {};
    const context = { repo: { owner: "sample", repo: "project" }, payload: { workflow_run: {
      event: "pull_request_review", conclusion, head_sha: "a".repeat(40), pull_requests: [{ number: 1903 }],
    } } };
    const core = { setOutput: (key, value) => { outputs[key] = value; }, notice: () => {} };
    const result = await runRecoveryPreflight({ github, context, core });
    assert.deepEqual(result, { eligible: false, reason: "INELIGIBLE_FAILED_PR_EVENT" });
    assert.equal(outputs.eligible, "false"); assert.equal(accesses, 0);
    if (conclusion === "failure") {
      const control = { ...context, payload: { workflow_run: { ...context.payload.workflow_run, event: "pull_request" } } };
      await assert.rejects(runRecoveryPreflight({ github, context: control, core }), /PUBLIC_GITHUB_ACCESS_FORBIDDEN/);
      assert.equal(accesses, 1, "otherwise-valid PR event reaches the API boundary");
    }
  }
});

test("native recovery and AI09 keep exact PR-event gates and actual AI09 eligibility rejects review events", () => {
  const recovery = read(".github/workflows/goriq-pr-ci-recovery.yml");
  const ai09 = read(".github/workflows/goriq-ai09-pr-review.yml");
  assert.match(recovery, /github\.event\.workflow_run\.event == 'pull_request' &&/);
  assert.match(recovery, /recover:\n\s+needs: \[preflight\]\n\s+if: needs\.preflight\.outputs\.eligible == 'true'/);
  assert.match(ai09, /preflight:\n\s+if: github\.event\.workflow_run\.event == 'pull_request'\n/);
  const repo = { id: 31, full_name: "sample/project" };
  const pr = { number: 73, state: "open", head: { sha: "b".repeat(40), repo }, base: { sha: "a".repeat(40), ref: "main", repo } };
  const run = { name: "CI", event: "pull_request", status: "completed", head_sha: pr.head.sha, repository: repo,
    pull_requests: [{ number: 73, head: { sha: pr.head.sha, repo }, base: { sha: pr.base.sha, repo } }] };
  assert.equal(eligibleCiPullRequest({ run, pr, repo }), true, "fixture must otherwise be eligible");
  for (const conclusion of ["success", "failure"]) {
    assert.equal(eligibleCiPullRequest({ run: { ...run, event: "pull_request_review", conclusion }, pr, repo }), false);
  }
});
