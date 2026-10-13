#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { reviewLocalPatch } from "../src/orchestrator/ai09-local-reviewer.mjs";
import { assertCompleteComparison } from "./goriq-ai09-compare-coverage.mjs";
import {
  SHA40, compareToReviewChunks, consolidateChunkReviews,
  makeBlockedReview, reviewReceipt, validateReviewReceipt,
} from "../src/orchestrator/ai09-pr-review-automation.mjs";

const safeRepo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function config() {
  const env = process.env;
  const result = {
    repository: env.GORIQ_AI09_REPOSITORY,
    prNumber: Number(env.GORIQ_AI09_PR_NUMBER),
    headSha: env.GORIQ_AI09_HEAD,
    baseSha: env.GORIQ_AI09_BASE,
    trustedSha: env.GORIQ_AI09_TRUSTED_SHA,
    ciRunId: Number(env.GORIQ_AI09_CI_RUN_ID),
    ciConclusion: env.GORIQ_AI09_CI_CONCLUSION,
    modelName: env.GORIQ_OLLAMA_MODEL || "qwen2.5-coder:3b",
    output: env.GORIQ_AI09_REPORT_FILE,
    temp: env.RUNNER_TEMP,
    token: env.GITHUB_TOKEN,
  };
  if (!safeRepo.test(result.repository ?? "") || !SHA40.test(result.headSha ?? "") ||
    !SHA40.test(result.baseSha ?? "") || !SHA40.test(result.trustedSha ?? "") ||
    !Number.isSafeInteger(result.prNumber) || result.prNumber <= 0 ||
    !Number.isSafeInteger(result.ciRunId) || result.ciRunId <= 0 ||
    !/^[A-Za-z0-9][A-Za-z0-9_./:-]{0,100}$/.test(result.modelName) ||
    typeof result.token !== "string" || !result.token ||
    !result.temp || !result.output ||
    resolve(dirname(result.output)) !== resolve(result.temp) ||
    basename(result.output) !== "goriq-ai09-report.json") {
    throw new Error("invalid_runner_scope");
  }
  return result;
}

async function githubGet(config, apiPath) {
  const response = await fetch("https://api.github.com/repos/" + config.repository + apiPath, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + config.token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GORIQ-AI09-readonly",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("github_read_unavailable");
  return response.json();
}

function safePr(pr, config) {
  return pr?.number === config.prNumber && pr?.state === "open" &&
    pr?.head?.sha === config.headSha && pr?.base?.sha === config.baseSha &&
    pr?.head?.repo?.full_name === config.repository &&
    pr?.base?.repo?.full_name === config.repository;
}

async function localInfer(config, prompt) {
  const response = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: config.modelName, stream: false, format: "json",
      options: { temperature: 0, num_ctx: 32768 },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error("local_inference_unavailable");
  const payload = await response.json();
  return payload?.message?.content;
}

async function main() {
  const c = config();
  // A workflow_run runs only trusted main code; never fetch or execute the PR head.
  const checkout = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (checkout !== c.trustedSha) throw new Error("reviewer_source_not_trusted_main");
  const scope = { headSha: c.headSha, baseSha: c.baseSha, paths: [] };
  let result;
  try {
    const before = await githubGet(c, "/pulls/" + c.prNumber);
    if (!safePr(before, c)) throw new Error("stale_or_foreign_pr");
    const diff = await githubGet(c, "/compare/" + c.baseSha + "..." + c.headSha);
    if (diff?.base_commit?.sha !== c.baseSha ||
      diff?.commits?.at(-1)?.sha !== c.headSha) {
      throw new Error("comparison_revision_mismatch");
    }
    assertCompleteComparison(diff);
    const prepared = compareToReviewChunks(diff, c.baseSha, c.headSha);
    scope.paths = prepared.paths;
    scope.patchSha256 = prepared.patchSha256;
    scope.reviewChunks = prepared.chunks.length;
    const chunkReports = [];
    for (const chunk of prepared.chunks) {
      const chunkResult = await reviewLocalPatch({
        baseSha: c.baseSha, headSha: c.headSha, makerRole: "Builder",
        paths: chunk.paths, patch: chunk.patch,
        infer: prompt => localInfer(c, prompt),
      });
      chunkReports.push(chunkResult);
      if (chunkResult.status === "BLOCKED") break;
    }
    // No chunk can silently disappear, and no partial model review can pass.
    result = consolidateChunkReviews(chunkReports, scope, prepared.chunks);
    const after = await githubGet(c, "/pulls/" + c.prNumber);
    if (!safePr(after, c)) throw new Error("pr_changed_during_review");
  } catch {
    result = makeBlockedReview(scope, "review_prerequisite_or_model_unavailable");
  }
  const receipt = reviewReceipt({
    repository: c.repository, prNumber: c.prNumber,
    headSha: c.headSha, baseSha: c.baseSha,
    trustedSha: c.trustedSha, ciRunId: c.ciRunId,
    ciConclusion: c.ciConclusion, result,
  });
  if (!validateReviewReceipt(receipt, c)) throw new Error("invalid_review_receipt");
  // Only a bounded JSON record is exported. Never include model prompt, diff, credentials or process details.
  writeFileSync(c.output, JSON.stringify(receipt), { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log("AI09_REVIEW_STATUS=" + result.status);
  console.log("AI09_REVIEW_HEAD=" + c.headSha);
  console.log("AI09_GITHUB_APPROVAL=false");
}

await main().catch(() => {
  // Do not log errors that could include private configuration values.
  console.error("AI09_TRUSTED_REVIEW_FAILED");
  process.exitCode = 2;
});
