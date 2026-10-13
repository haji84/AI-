#!/usr/bin/env node
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { eligibleCiPullRequest, SHA40 } from "../src/orchestrator/ai09-pr-review-automation.mjs";

function output(values) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("missing_actions_output");
  for (const [key, value] of Object.entries(values)) {
    if (!/^[a-z_]+$/.test(key) || typeof value !== "string" || value.includes("\n")) {
      throw new Error("invalid_actions_output");
    }
    appendFileSync(process.env.GITHUB_OUTPUT, key + "=" + value + "\n");
  }
}

async function githubGet(repo, path, token) {
  const response = await fetch("https://api.github.com/repos/" + repo + path, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GORIQ-AI09-trusted-preflight",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("preflight_github_unavailable");
  return response.json();
}

async function main() {
  output({ eligible: "false" });
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000,
  }).trim();
  if (!SHA40.test(sourceSha)) return;
  const raw = readFileSync(process.env.GITHUB_EVENT_PATH, "utf8");
  if (raw.length > 2 * 1024 * 1024) return;
  const event = JSON.parse(raw);
  const repo = event?.repository;
  const run = event?.workflow_run;
  const token = process.env.GITHUB_TOKEN;
  if (!token || repo?.full_name !== process.env.GITHUB_REPOSITORY ||
    !run || run.name !== "CI" || run.event !== "pull_request" ||
    run.status !== "completed" || !SHA40.test(run.head_sha ?? "")) return;
  const linked = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  if (linked.length !== 1) return;
  const candidate = linked[0];
  if (!Number.isSafeInteger(candidate.number) || candidate.number <= 0) return;
  const pr = await githubGet(repo.full_name, "/pulls/" + candidate.number, token);
  if (!eligibleCiPullRequest({ run, pr, repo, defaultBranch: repo.default_branch })) return;
  if (!Number.isSafeInteger(run.id) || run.id <= 0 ||
    !["success", "failure", "cancelled", "timed_out", "neutral", "skipped", "action_required"].includes(run.conclusion)) return;
  output({
    eligible: "true",
    repository: repo.full_name,
    pr_number: String(pr.number),
    base_sha: pr.base.sha,
    head_sha: pr.head.sha,
    trusted_sha: sourceSha,
    ci_run_id: String(run.id),
    ci_conclusion: run.conclusion,
  });
  console.log("AI09_ELIGIBLE_PR=" + pr.number);
}

await main().catch(() => {
  // No sensitive API response or workflow payload data in logs.
  console.error("AI09_PREFLIGHT_BLOCKED");
  process.exitCode = 2;
});
