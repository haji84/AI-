#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { reviewLocalPatch } from "../src/orchestrator/ai09-local-reviewer.mjs";

function argument(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--" + name);
  return index !== -1 ? args[index + 1] : undefined;
}

function revision(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function git(args, maxBuffer = 80 * 1024) {
  return execFileSync("git", args, { encoding: "utf8", timeout: 10000, maxBuffer, stdio: ["ignore", "pipe", "ignore"] }).trimEnd();
}

function outputBlocked(reason) {
  console.log(JSON.stringify({
    version: 1, reviewer: "AI-09", status: "BLOCKED", blockers: [reason],
    githubApprovalSatisfied: false, independentGitHubAccountVerified: false,
    physicalEvidenceVerified: false, mergeAuthorized: false,
  }));
  process.exitCode = 2;
}

async function main() {
  const baseSha = argument("base");
  const headSha = argument("head");
  const makerRole = argument("maker");
  const model = argument("model") ?? process.env.GORIQ_OLLAMA_MODEL ?? "qwen2.5-coder:3b";
  const args = process.argv.slice(2);
  if (args.length !== 8 || !["--base", "--head", "--maker", "--model"].every(flag => args.includes(flag)) ||
      !revision(baseSha) || !revision(headSha) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,100}$/.test(model) ||
      typeof makerRole !== "string" || !/^[A-Za-z][A-Za-z0-9 _/-]{0,63}$/.test(makerRole)) {
    return outputBlocked("invalid_readonly_cli_arguments");
  }
  let patch, paths;
  try {
    if (git(["rev-parse", "HEAD"]) !== headSha) return outputBlocked("checkout_head_mismatch");
    if (git(["cat-file", "-t", baseSha]) !== "commit" || git(["cat-file", "-t", headSha]) !== "commit") {
      return outputBlocked("missing_commit");
    }
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", baseSha, headSha], { timeout: 10000, stdio: "ignore" });
    if (ancestor.status !== 0) return outputBlocked("base_not_ancestor");
    paths = git(["diff", "--no-ext-diff", "--name-only", baseSha, headSha, "--"]).split("\n").filter(Boolean);
    patch = git(["diff", "--no-ext-diff", "--no-textconv", "--unified=3", baseSha, headSha, "--"]);
  } catch {
    return outputBlocked("git_readonly_preflight_failed_or_diff_too_large");
  }
  const result = await reviewLocalPatch({
    baseSha, headSha, makerRole, paths, patch,
    infer: async prompt => {
      // No remote endpoint override, API key, cloud fallback or metered provider.
      const response = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          model, stream: false, format: "json",
          options: { temperature: 0, num_ctx: 8192 },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) throw new Error("local_model_http_error");
      const payload = await response.json();
      return payload?.message?.content;
    },
  });
  console.log(JSON.stringify({ ...result, modelProvider: "ollama-loopback", modelName: model, source: "read-only-git-diff" }));
  if (result.status === "BLOCKED" || result.status === "CHANGES_REQUESTED" || result.status === "INCONCLUSIVE") {
    process.exitCode = 2;
  }
}

await main().catch(() => outputBlocked("unexpected_review_failure"));
