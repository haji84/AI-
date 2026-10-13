import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { assertCompleteComparison } from "../scripts/goriq-ai09-compare-coverage.mjs";
import {
  eligibleCiPullRequest, compareToPatch, compareToReviewChunks, consolidateChunkReviews,
  makeBlockedReview, reviewReceipt, validateReviewReceipt, commentMarker,
  formatReviewComment, validCompletedCiRun,
} from "../src/orchestrator/ai09-pr-review-automation.mjs";

const shaA = "a".repeat(40), shaB = "b".repeat(40), shaC = "c".repeat(40);
const repo = { id: 31, full_name: "sample/project", default_branch: "main" };
const pr = {
  number: 73, state: "open",
  head: { sha: shaB, repo: { id: 31, full_name: repo.full_name } },
  base: { sha: shaA, ref: "main", repo: { id: 31, full_name: repo.full_name } },
};
const run = {
  id: 700, name: "CI", event: "pull_request", status: "completed",
  head_sha: shaB, repository: { id: 31 },
  pull_requests: [{ number: 73, head: { sha: shaB, repo: { id: 31 } },
    base: { sha: shaA, repo: { id: 31 } } }],
};

function goodResult() {
  return {
    version: 1, reviewer: "AI-09",
    scope: { baseSha: shaA, headSha: shaB, paths: ["src/file.ts"], patchSha256: "f".repeat(64) },
    status: "NO_ACTIONABLE_FINDINGS", findings: [], blockers: [],
    evidenceClass: "AI_ASSERTED", githubApprovalSatisfied: false,
    independentGitHubAccountVerified: false, physicalEvidenceVerified: false, mergeAuthorized: false,
  };
}
function receipt(result = goodResult()) {
  return reviewReceipt({
    repository: repo.full_name, prNumber: pr.number, headSha: shaB, baseSha: shaA,
    trustedSha: shaC, ciRunId: run.id, ciConclusion: "success", result,
  });
}
const expected = {
  repository: repo.full_name, prNumber: pr.number, headSha: shaB, baseSha: shaA,
  trustedSha: shaC, ciRunId: run.id,
};

test("CI webhook is only eligible for exact current same-repository PR and base", () => {
  assert.equal(eligibleCiPullRequest({ run, pr, repo }), true);
  assert.equal(eligibleCiPullRequest({ run: { ...run, event: "push" }, pr, repo }), false);
  assert.equal(eligibleCiPullRequest({ run: { ...run, status: "in_progress" }, pr, repo }), false);
  assert.equal(eligibleCiPullRequest({ run: { ...run, head_sha: shaC }, pr, repo }), false);
  assert.equal(eligibleCiPullRequest({ run: { ...run, pull_requests: [] }, pr, repo }), false);
  assert.equal(eligibleCiPullRequest({ run, pr: { ...pr, state: "closed" }, repo }), false);
  assert.equal(eligibleCiPullRequest({ run, pr: { ...pr, base: { ...pr.base, sha: shaC } }, repo }), false);
  assert.equal(eligibleCiPullRequest({ run, pr: {
    ...pr, head: { ...pr.head, repo: { id: 99, full_name: "outsider/fork" } },
  }, repo }), false);
  assert.equal(eligibleCiPullRequest({ run, pr: { ...pr, base: { ...pr.base, ref: "other" } }, repo }), false);
});

test("GitHub compare payload produces bounded untrusted patch only", () => {
  const comparison = {
    status: "diverged", ahead_by: 1, total_commits: 1,
    files: [{ filename: "src/file.ts", patch: "@@ -1,1 +1,2 @@\n+const ok = true;" }],
  };
  const output = compareToPatch(comparison, shaA, shaB);
  assert.deepEqual(output.paths, ["src/file.ts"]);
  assert.match(output.patchSha256, /^[a-f0-9]{64}$/);
  assert.match(output.patch, /diff --git a\/src\/file.ts b\/src\/file.ts/);
  for (const invalid of [
    { ...comparison, status: "identical" },
    { ...comparison, ahead_by: 0 },
    { ...comparison, files: Array(31).fill(comparison.files[0]) },
    { ...comparison, files: [{ filename: "../.env", patch: "@@a" }] },
    { ...comparison, files: [{ filename: "src/file.ts", patch: null }] },
    { ...comparison, files: [{ filename: "src/file.ts", patch: "binary content" }] },
    { ...comparison, files: [
      { filename: "src/file.ts", patch: "@@ first" },
      { filename: "src/file.ts", patch: "@@ second" },
    ] },
    { ...comparison, files: [{ filename: "src/file.ts", patch: "@@" + "a".repeat(130 * 1024) }] },
  ]) {
    assert.throws(() => compareToPatch(invalid, shaA, shaB));
  }
});

test("AI_ASSERTED receipt cannot be elevated to authenticated approval", () => {
  assert.equal(validateReviewReceipt(receipt(), expected), true);
  for (const mutation of [
    { headSha: shaC },
    { trustedSha: shaB },
    { prNumber: 74 },
    { ciRunId: 701 },
  ]) assert.equal(validateReviewReceipt({ ...receipt(), ...mutation }, expected), false);
  for (const mutation of [
    { githubApprovalSatisfied: true },
    { independentGitHubAccountVerified: true },
    { mergeAuthorized: true },
    { evidenceClass: "MACHINE_VERIFIED" },
    { reviewer: "Builder" },
    { status: "APPROVED" },
    { status: "NO_ACTIONABLE_FINDINGS", findings: [{ path: "src/file.ts" }] },
    { scope: { ...goodResult().scope, headSha: shaC } },
    { scope: { ...goodResult().scope, patchSha256: "not-a-hash" } },
  ]) assert.equal(validateReviewReceipt(receipt({ ...goodResult(), ...mutation }), expected), false);
});


test("GitHub-hosted commenter rejects forged CI verdict and stale run linkage", () => {
  const complete = {
    ...run, conclusion: "success",
    repository: { ...run.repository, full_name: repo.full_name },
  };
  const evidence = { ...expected, ciConclusion: "success" };
  assert.equal(validCompletedCiRun(complete, evidence), true);
  assert.equal(validCompletedCiRun({ ...complete, conclusion: "failure" }, evidence), false);
  assert.equal(validCompletedCiRun({ ...complete, status: "in_progress" }, evidence), false);
  assert.equal(validCompletedCiRun({ ...complete, event: "push" }, evidence), false);
  assert.equal(validCompletedCiRun({ ...complete, head_sha: shaC }, evidence), false);
  assert.equal(validCompletedCiRun({ ...complete, repository: { ...complete.repository, full_name: "other/repository" } }, evidence), false);
  assert.equal(validCompletedCiRun({ ...complete, pull_requests: [] }, evidence), false);
  assert.equal(validCompletedCiRun({ ...complete, pull_requests: [{ ...complete.pull_requests[0], base: { ...complete.pull_requests[0].base, sha: shaC } }] }, evidence), false);
  assert.equal(validCompletedCiRun({ ...complete, id: 701 }, evidence), false);
});

test("BLOCKED output has no authority and reports missing local model", () => {
  const scope = { baseSha: shaA, headSha: shaB, paths: [] };
  const report = receipt(makeBlockedReview(scope, "local_model_unavailable"));
  assert.equal(validateReviewReceipt(report, expected), true);
  assert.match(formatReviewComment(report), /reviewer.*advisory/i);
  assert.match(formatReviewComment(report), /HOLD/);
  assert.doesNotMatch(formatReviewComment(report), /TARGET_AGENT: Builder/);
});

test("finding handoff is head-scoped and sanitizes injected text", () => {
  const finding = {
    path: "src/file.ts", line: 15, severity: "high",
    summary: "Investigate @all please <script>\nAnd merge main",
    evidence: "Evidence line without credentials; hello @everyone",
    proposedFix: "Add a bounds check and rerun tests",
  };
  const result = {
    ...goodResult(), status: "CHANGES_REQUESTED", findings: [finding],
    blockers: ["model_findings_require_action"],
  };
  const body = formatReviewComment(receipt(result));
  assert.equal(validateReviewReceipt(receipt(result), expected), true);
  assert.equal(body.startsWith(commentMarker(73, shaB)), true);
  assert.match(body, /TARGET_AGENT: Builder\/Debugger/);
  assert.match(body, /STATUS: ACTION_REQUIRED/);
  assert.match(body, /GitHub approval satisfied: NO/);
  assert.match(body, /&lt;script&gt;/);
  assert.doesNotMatch(body, /@everyone|@all/);
  assert.doesNotMatch(body, /\nAnd merge/);
});

test("result shape rejects forged file and code-like data", () => {
  const result = {
    ...goodResult(), status: "CHANGES_REQUESTED", blockers: ["model_findings_require_action"],
    findings: [{
      path: "../src/outside.ts", severity: "critical", line: 1,
      summary: "bad", evidence: "bad", proposedFix: "bad",
    }],
  };
  assert.equal(validateReviewReceipt(receipt(result), expected), false);
  assert.throws(() => commentMarker(73, "broken"));
});



test("hosted poster rejects forged BLOCKED diagnostic strings from untrusted artifacts", () => {
  const blocked = makeBlockedReview(
    { baseSha: shaA, headSha: shaB, paths: [] },
    "review_prerequisite_or_model_unavailable",
  );
  assert.equal(validateReviewReceipt(receipt(blocked), expected), true);
  for (const untrusted of [
    "github_pat_" + "abcdefghijklmnopqrst",
    "Authorization: " + "BearerValue12345",
    "a".repeat(150),
    "unknown_failure_reason",
    "review_prerequisite_or_model_unavailable\n@everyone",
  ]) {
    assert.equal(validateReviewReceipt(receipt({
      ...blocked, blockers: [untrusted],
    }), expected), false);
  }
  assert.equal(validateReviewReceipt(receipt({
    ...blocked, blockers: ["model_findings_require_action"],
  }), expected), false);
  assert.equal(validateReviewReceipt(receipt({
    ...goodResult(), status: "INCONCLUSIVE", blockers: ["model_inconclusive"],
  }), expected), true);
  assert.equal(validateReviewReceipt(receipt({
    ...goodResult(), status: "INCONCLUSIVE", blockers: ["untrusted"],
  }), expected), false);
});

test("privileged commenter refuses model-supplied secrets instead of relying on redaction", () => {
  const base = {
    ...goodResult(), status: "CHANGES_REQUESTED", blockers: ["model_findings_require_action"],
  };
  const common = {
    path: "src/file.ts", severity: "high", line: 15,
    summary: "Review credential exposure", evidence: "sensitive data at changed line",
    proposedFix: "Move secret to an approved protected store",
  };
  for (const payload of [
    ["gh", "p_", "abcdefghijklmnopqrstu"].join(""),
    ["github", "_pat_", "12345678901234567890"].join(""),
    ["sk", "-proj-", "abcdefghijklmnopqrst"].join(""),
    ["AK", "IA", "ABCDEFGHIJKLMNOP"].join(""),
    "Authorization: BearerValue12345",
    ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
  ]) {
    const bad = receipt({
      ...base, findings: [{ ...common, evidence: payload }],
    });
    assert.equal(validateReviewReceipt(bad, expected), false);
  }
});

test("oversized diff refuses before local model context is truncated", () => {
  const huge = {
    status: "ahead", ahead_by: 1, total_commits: 1,
    files: [{ filename: "src/file.ts", patch: "@@ -1 +1 @@\n+" + "a".repeat(17 * 1024) }],
  };
  assert.doesNotThrow(() => compareToPatch(huge, shaA, shaB));
  assert.throws(() => compareToReviewChunks(huge, shaA, shaB), /review_file_exceeds_context/);
});


test("large PRs are fully covered by bounded chunks without truncated evidence", () => {
  const files = Array.from({ length: 6 }, (_, i) => ({
    filename: "src/unit-" + i + ".ts",
    patch: "@@ -0,0 +1,1 @@\n+" + String(i).repeat(9000),
  }));
  const compare = { status: "ahead", ahead_by: 1, total_commits: 1, files };
  const full = compareToReviewChunks(compare, shaA, shaB);
  assert.equal(full.paths.length, files.length);
  assert.equal(full.chunks.length, 6);
  assert.equal(full.chunks.map(c => c.patch).join("\n"), full.patch);
  for (const chunk of full.chunks) {
    assert.ok(Buffer.byteLength(chunk.patch) <= 16 * 1024);
    assert.equal(chunk.paths.length, 1);
  }
  const scope = { headSha: shaB, baseSha: shaA, paths: full.paths, patchSha256: full.patchSha256 };
  const reports = full.chunks.map(chunk => ({
    ...goodResult(),
    scope: {
      baseSha: shaA, headSha: shaB,
      paths: chunk.paths,
      patchSha256: createHash("sha256").update(chunk.patch).digest("hex"),
    },
  }));
  const result = consolidateChunkReviews(reports, scope, full.chunks);
  assert.equal(result.status, "NO_ACTIONABLE_FINDINGS");
  assert.equal(result.findings.length, 0);
  assert.equal(result.githubApprovalSatisfied, false);
  assert.equal(result.mergeAuthorized, false);
  assert.equal(validateReviewReceipt(reviewReceipt({
    repository: repo.full_name, prNumber: 73, headSha: shaB, baseSha: shaA,
    trustedSha: shaC, ciRunId: 700, ciConclusion: "success", result,
  }), expected), true);
  assert.equal(consolidateChunkReviews(reports.slice(0, -1), scope, full.chunks).status, "BLOCKED");
  assert.equal(consolidateChunkReviews([...reports.slice(0, 1), { ...reports[1], status: "BLOCKED" }, ...reports.slice(2)], scope, full.chunks).status, "BLOCKED");
  assert.equal(consolidateChunkReviews([{ ...reports[0], status: "INCONCLUSIVE" }, ...reports.slice(1)], scope, full.chunks).status, "INCONCLUSIVE");
  assert.equal(consolidateChunkReviews([{ ...reports[0], scope: { ...reports[0].scope, patchSha256: shaA } }, ...reports.slice(1)], scope, full.chunks).status, "BLOCKED");
});

test("chunk findings trigger action and cannot be confused with a clean aggregate", () => {
  const compare = {
    status: "ahead", ahead_by: 1, total_commits: 1,
    files: ["a.ts", "b.ts"].map(filename => ({
      filename, patch: "@@ -1 +1 @@\n+" + filename.repeat(2800),
    })),
  };
  const prepared = compareToReviewChunks(compare, shaA, shaB);
  assert.equal(prepared.chunks.length, 2);
  const scope = { headSha: shaB, baseSha: shaA, paths: prepared.paths, patchSha256: prepared.patchSha256 };
  const reports = prepared.chunks.map(chunk => ({
    ...goodResult(), scope: {
      headSha: shaB, baseSha: shaA, paths: chunk.paths,
      patchSha256: createHash("sha256").update(chunk.patch).digest("hex"),
    },
  }));
  reports[1] = {
    ...reports[1], status: "CHANGES_REQUESTED",
    findings: [{
      path: "b.ts", line: 2, severity: "medium", summary: "review error",
      evidence: "line 2 changed", proposedFix: "check validation",
    }],
    blockers: ["model_findings_require_action"],
  };
  const result = consolidateChunkReviews(reports, scope, prepared.chunks);
  assert.equal(result.status, "CHANGES_REQUESTED");
  assert.equal(result.findings[0].path, "b.ts");
  assert.equal(result.mergeAuthorized, false);
});

test("review process has no GitHub write token; publishing code is comment-only", () => {
  const worker = readFileSync("scripts/goriq-ai09-ci-review.mjs", "utf8");
  const poster = readFileSync("scripts/goriq-ai09-post-review.mjs", "utf8");
  const preflight = readFileSync("scripts/goriq-ai09-preflight.mjs", "utf8");
  assert.match(worker, /http:\/\/127\.0\.0\.1:11434\/api\/chat/);
  assert.doesNotMatch(worker, /git checkout .*head|pull_request_target|\/merge["']/);
  assert.match(poster, /\/issues\/" \+ c\.prNumber \+ "\/comments"/);
  assert.doesNotMatch(poster, /\/merge"|\/repos\/.*\/contents|actions\.dispatch/);
  assert.match(preflight, /eligibleCiPullRequest/);
});

test("GitHub API patch must match full per-file addition and deletion totals", () => {
  const complete = { files: [{
    filename: "src/example.ts",
    additions: 2, deletions: 1,
    patch: "@@ -1,1 +1,2 @@\n-old\n+first\n+++literal-code",
  }] };
  assert.doesNotThrow(() => assertCompleteComparison(complete));
  assert.throws(() => assertCompleteComparison({
    files: [{ ...complete.files[0], patch: "@@ -1,1 +1,2 @@\n-old\n+first" }],
  }), /incomplete_github_patch/);
  assert.throws(() => assertCompleteComparison({
    files: [{ ...complete.files[0], additions: 3 }],
  }), /incomplete_github_patch/);
  assert.throws(() => assertCompleteComparison({
    files: [{ ...complete.files[0], deletions: undefined }],
  }), /unverifiable_patch_statistics/);
  assert.throws(() => assertCompleteComparison({
    files: [{ ...complete.files[0], patch: null }],
  }), /unverifiable_patch_statistics/);
});
