// Isolated non-Codex development smoke for CI. No GitHub writes, tokens, model APIs or production state.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { adviseDevelopmentIntake, adviseChatActionsHandoff } from "../src/orchestrator/development-pr-advisory.ts";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const base = "a".repeat(40), head = "b".repeat(40);
export function syntheticIntake(overrides = {}) {
  const pr = {
    repository: "sandbox/example", issueNumber: 1865, baseBranch: "main",
    operation: "fix_existing_pr", inventoryComplete: true,
    pullRequests: [{ number: 1866, repository: "sandbox/example", issueNumber: 1865,
      baseBranch: "main", headBranch: "sandbox/example-branch", state: "open", merged: false }],
    riskEvidenceComplete: true, riskSignals: {}, comparison: { baseSha: base, headSha: head },
    globallyPaused: false,
    ...overrides,
  };
  return pr;
}
export const sandboxChat = Object.freeze({
  source: "chat", command: "Implement the isolated addition function and verify it",
  goalId: "sandbox-goal-1865", messageId: "synthetic-message-1865",
  // This is an isolated fixture, NOT real GitHub owner authentication.
  ownerIdentityVerifiedByTrustedHost: true, githubActionsAvailable: true,
  existingNonCodexBuilderAvailable: true,
});
function checkAddition(location, expected) {
  const code = readFileSync(location, "utf8");
  const normalized = code.replace(/^export\s+/, "");
  if (!/^function sum\(a,b\)\s*\{\s*return a\s*[+-]\s*b;\s*\}\s*$/.test(normalized)) {
    throw Error("UNTRUSTED_BUILDER_OUTPUT_REJECTED");
  }
  const op = normalized.includes("a+b") ? "+" : "-";
  const result = op === "+" ? 7 + 5 : 7 - 5;
  return result === expected;
}
function receipt(stage, event) {
  return { stage, result: event, simulated: true };
}
/**
 * Every stage runs against an ephemeral, synthetic task/PR. No GitHub API,
 * real AI inference, real PR revision, actual AI09 or independent approval.
 */
export function runSandboxCycle({ pr = syntheticIntake(), chat = sandboxChat } = {}) {
  const prAdvice = adviseDevelopmentIntake(pr);
  const handoff = adviseChatActionsHandoff(chat, prAdvice);
  if (handoff.status !== "PROPOSE_ONLY" || prAdvice.pr.action !== "REUSE") {
    return { mode:"ISOLATED_SYNTHETIC", completed:false, blocked:handoff.status,
      reusedPr:prAdvice.pr.number ?? null, records:[receipt("intake", handoff.status)],
      actualGitHubMutation:false, realAi09Reviewed:false, modelUsed:false };
  }
  const work = mkdtempSync(join(tmpdir(), "goriq-chat-actions-"));
  const file = join(work, "sum.mjs");
  const records = [];
  try {
    records.push(receipt("chat", "SYNTHETIC_CHAT_COMMAND"));
    records.push(receipt("route", "GITHUB_ACTIONS_HOST_NON_CODEX"));
    records.push(receipt("pr", "REUSE_SAME_PR_" + prAdvice.pr.number));
    const git = (...args) => execFileSync("git", args, {cwd:work,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
    const sandboxBranch = "sandbox-reuse-" + prAdvice.pr.number;
    git("init","-q","-b",sandboxBranch);
    git("config","user.name","isolated-actions-smoke");
    git("config","user.email","sandbox@example.invalid");
    writeFileSync(file, "export function sum(a,b){return a-b;}\n", "utf8");
    git("add","sum.mjs");
    git("commit","-qm","sandbox: intentionally failing implementation");
    if (checkAddition(file, 12)) throw Error("RED_TEST_NOT_REPRODUCED");
    records.push(receipt("test", "RED_FAILED_AS_EXPECTED"));
    writeFileSync(file, "export function sum(a,b){return a+b;}\n", "utf8");
    if (!checkAddition(file, 12)) throw Error("GREEN_TEST_FAILED");
    git("add","sum.mjs");
    git("commit","-qm","sandbox: repair in same temporary branch");
    if (git("branch","--show-current") !== sandboxBranch) throw Error("SANDBOX_BRANCH_IDENTITY_CHANGED");
    if (Number(git("rev-list","--count","HEAD")) !== 2) throw Error("SANDBOX_REPAIR_HISTORY_MISSING");
    records.push(receipt("repair", "TWO_REAL_LOCAL_GIT_COMMITS_IN_SAME_EPHEMERAL_BRANCH"));
    records.push(receipt("repair", "SAME_SIMULATED_PR_BRANCH"));
    records.push(receipt("test", "GREEN_VERIFIED"));
    // A fixture receipt is checked by the existing advisory, not actual AI09.
    const review = adviseDevelopmentIntake({ ...pr,
      ai09: { reviewer:"AI-09", evidenceClass:"AI_ASSERTED",
        status:"NO_ACTIONABLE_FINDINGS", scope:{ baseSha:base, headSha:head },
        githubApprovalSatisfied:false, mergeAuthorized:false } });
    if (review.review !== "CLEAR_ADVISORY") throw Error("AI09_FIXTURE_NOT_CURRENT");
    records.push(receipt("review", "AI09_FIXTURE_ONLY_NOT_GITHUB_APPROVAL"));
    const nextAction = "NEXT_SAFE_SANDBOX_TASK";
    records.push(receipt("continuation", nextAction));
    const artifactDigest = sha(readFileSync(file, "utf8"));
    return { mode:"ISOLATED_SYNTHETIC", completed:true, blocked:null,
      reusedPr:prAdvice.pr.number, nonCodexBuilder:"DETERMINISTIC_FIXTURE_BUILDER",
      artifactDigest, records, nextAction, isolatedGitCommits:2, actualGitHubMutation:false,
      realAi09Reviewed:false, modelUsed:false, autoMerge:false, authorizedProduction:false };
  } finally {
    rmSync(work, { recursive:true, force:true });
  }
}
if (process.argv[1]?.endsWith("/chat-actions-sandbox.mjs")) {
  const out = runSandboxCycle();
  const report = JSON.stringify(out, null, 2);
  process.stdout.write(report + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      "## Chat-first isolated Actions sandbox",
      "This is a SYNTHETIC intake and deterministic non-Codex builder, NOT a live Chat trigger or AI09 approval.",
      "Completion (fixture only): " + out.completed,
      "Existing simulated PR reused: " + out.reusedPr,
      "Real GitHub mutation: " + out.actualGitHubMutation,
      "Actual AI09 model execution: " + out.realAi09Reviewed,
      "Next action (simulation): " + (out.nextAction ?? "none"),
    ];
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
  }
  if (!out.completed) process.exitCode = 1;
}
