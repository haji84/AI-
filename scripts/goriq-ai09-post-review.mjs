#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHA40, validateReviewReceipt, commentMarker, formatReviewComment, compareToPatch,
} from "../src/orchestrator/ai09-pr-review-automation.mjs";

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function config() {
  const e = process.env;
  const c = {
    repository: e.GORIQ_AI09_REPOSITORY,
    prNumber: Number(e.GORIQ_AI09_PR_NUMBER),
    headSha: e.GORIQ_AI09_HEAD,
    baseSha: e.GORIQ_AI09_BASE,
    trustedSha: e.GORIQ_AI09_TRUSTED_SHA,
    ciRunId: Number(e.GORIQ_AI09_CI_RUN_ID),
    token: e.GITHUB_TOKEN,
    artifactPath: e.GORIQ_AI09_RECEIPT_PATH,
    expectedRoot: e.RUNNER_TEMP,
  };
  if (!repoPattern.test(c.repository ?? "") ||
    !Number.isSafeInteger(c.prNumber) || c.prNumber <= 0 ||
    !Number.isSafeInteger(c.ciRunId) || c.ciRunId <= 0 ||
    ![c.headSha, c.baseSha, c.trustedSha].every(sha => SHA40.test(sha ?? "")) ||
    !c.token || !c.artifactPath || !c.expectedRoot ||
    !resolve(c.artifactPath).startsWith(resolve(c.expectedRoot) + "/")) {
    throw new Error("invalid_posting_scope");
  }
  return c;
}

async function githubApi(c, apiPath, method = "GET", body) {
  const response = await fetch("https://api.github.com/repos/" + c.repository + apiPath, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + c.token,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GORIQ-AI09-post-only",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("github_advisory_post_failed");
  return response.json();
}

async function run() {
  const c = config();
  const stats = statSync(c.artifactPath);
  if (!stats.isFile() || stats.size < 100 || stats.size > 64 * 1024) throw new Error("invalid_receipt_size");
  const receipt = JSON.parse(readFileSync(c.artifactPath, "utf8"));
  if (!validateReviewReceipt(receipt, c)) throw new Error("untrusted_or_stale_review_receipt");
  const pr = await githubApi(c, "/pulls/" + c.prNumber);
  if (pr?.state !== "open" || pr?.head?.sha !== c.headSha || pr?.base?.sha !== c.baseSha ||
    pr?.head?.repo?.full_name !== c.repository || pr?.base?.repo?.full_name !== c.repository) {
    console.log("AI09_POST_SKIPPED_STALE_PR");
    return;
  }
  // A self-hosted runner is not the authority for the patch hash or file list.
  // Recompute them on GitHub-hosted infrastructure directly from trusted GitHub API.
  if (receipt.reviewerResult.status !== "BLOCKED" || receipt.reviewerResult.scope.patchSha256) {
    const compare = await githubApi(c, "/compare/" + c.baseSha + "..." + c.headSha);
    if (compare?.base_commit?.sha !== c.baseSha ||
      compare?.commits?.at(-1)?.sha !== c.headSha) throw new Error("comment_diff_revision_mismatch");
    const trusted = compareToPatch(compare, c.baseSha, c.headSha);
    const received = receipt.reviewerResult.scope;
    if (trusted.patchSha256 !== received.patchSha256 ||
      JSON.stringify(trusted.paths) !== JSON.stringify(received.paths)) {
      throw new Error("untrusted_review_patch_receipt");
    }
  } else if (receipt.reviewerResult.scope.paths.length > 0) {
    throw new Error("unverified_blocked_review_paths");
  }
  const marker = commentMarker(c.prNumber, c.headSha);
  for (let page = 1; page <= 10; page++) {
    const comments = await githubApi(c, "/issues/" + c.prNumber + "/comments?per_page=100&page=" + page);
    if (!Array.isArray(comments)) throw new Error("invalid_comment_inventory");
    if (comments.some(comment => comment.user?.login === "github-actions[bot]" &&
      typeof comment.body === "string" && comment.body.startsWith(marker))) {
      console.log("AI09_POST_SKIPPED_ALREADY_RECORDED");
      return;
    }
    if (comments.length < 100) break;
    if (page === 10) throw new Error("unbounded_comment_inventory");
  }
  const body = formatReviewComment(receipt);
  // One permitted mutation: a PR Conversation comment. No merge, approval, repo state or file writes.
  await githubApi(c, "/issues/" + c.prNumber + "/comments", "POST", { body });
  console.log("AI09_REVIEW_COMMENT_RECORDED");
}

await run().catch(() => {
  console.error("AI09_ADVISORY_POST_BLOCKED");
  process.exitCode = 2;
});
