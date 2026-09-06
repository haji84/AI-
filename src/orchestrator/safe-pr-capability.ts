import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, normalize, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateAutoMergeEligibility } from "./auto-merge-policy.ts";
import type { ActionResult, ProposedAction } from "./goal-loop.ts";

interface ProposalFile { path: string; content: string; }
interface ProposalInput { title?: string; body?: string; files?: ProposalFile[]; }
interface OpenedPullRequest { url: string; nodeId: string; number: number; }

const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 100_000;
const ALLOWED_PREFIXES = ["src/", "tests/", "docs/", "scripts/"];
const FORBIDDEN = new Set(["AGENTS.md", "PROJECT_STATE.md", "ROADMAP.md", "package.json", "pnpm-lock.yaml"]);

function parseInput(action: ProposedAction): Required<Pick<ProposalInput, "title" | "body" | "files">> {
  const input = action.input as ProposalInput | undefined;
  const files = input?.files;
  if (!input?.title?.trim() || !Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) {
    throw new Error("invalid autonomous PR proposal input");
  }
  let total = 0;
  for (const file of files) {
    const path = normalize(file.path).replaceAll("\\", "/");
    if (path.startsWith("../") || path.startsWith("/") || path.includes("/../")) throw new Error(`unsafe path: ${file.path}`);
    if (FORBIDDEN.has(path) || path.startsWith(".github/") || !ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      throw new Error(`path is outside bounded autonomous scope: ${file.path}`);
    }
    total += Buffer.byteLength(file.content, "utf-8");
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("autonomous proposal exceeds maximum patch size");
  return {
    title: input.title.trim(),
    body: input.body?.trim() || "Bounded autonomous proposal. Verified low-risk proposals may auto-merge after repository protections and required checks succeed.",
    files,
  };
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).slice(-4000)}`);
  return result.stdout.trim();
}

async function openPullRequest(input: { token: string; repository: string; head: string; title: string; body: string }): Promise<OpenedPullRequest> {
  const response = await fetch(`https://api.github.com/repos/${input.repository}/pulls`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: "main" }),
  });
  if (!response.ok) throw new Error(`GitHub PR creation failed with HTTP ${response.status}`);
  const payload = await response.json() as { html_url?: string; node_id?: string; number?: number };
  if (!payload.html_url || !payload.node_id || !payload.number) throw new Error("GitHub PR creation returned incomplete metadata");
  return { url: payload.html_url, nodeId: payload.node_id, number: payload.number };
}

async function enablePullRequestAutoMerge(input: { token: string; nodeId: string }): Promise<{ enabled: boolean; reason?: string }> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation($pullRequestId: ID!) {
        enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: SQUASH}) {
          pullRequest { number autoMergeRequest { enabledAt } }
        }
      }`,
      variables: { pullRequestId: input.nodeId },
    }),
  });
  const payload = await response.json() as { errors?: Array<{ message?: string }> };
  if (!response.ok || payload.errors?.length) {
    return { enabled: false, reason: payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || `HTTP ${response.status}` };
  }
  return { enabled: true };
}

export function createSafePrProposalCapability(options: { cwd?: string; token?: string | null; repository?: string } = {}) {
  return {
    name: "repository.propose_pr",
    async execute(action: ProposedAction): Promise<ActionResult> {
      try {
        const proposal = parseInput(action);
        const cwd = options.cwd ?? process.cwd();
        const token = options.token ?? process.env.GITHUB_TOKEN ?? null;
        const repository = options.repository ?? process.env.GITHUB_REPOSITORY ?? "";
        if (!token || !repository) {
          return { actionId: action.id, ok: false, summary: "PR proposal capability is not connected to GitHub write authorization", blocker: "github_write_unavailable" };
        }

        for (const file of proposal.files) {
          const destination = resolve(cwd, file.path);
          if (!destination.startsWith(resolve(cwd) + "/") && destination !== resolve(cwd)) throw new Error(`resolved path escaped repository: ${file.path}`);
          mkdirSync(dirname(destination), { recursive: true });
          writeFileSync(destination, file.content, "utf-8");
        }

        run("pnpm", ["lint"], cwd);
        run("pnpm", ["test"], cwd);
        run("pnpm", ["build"], cwd);

        const changedFiles = proposal.files.map((file) => file.path);
        const autoMergeDecision = evaluateAutoMergeEligibility({
          baseBranch: "main",
          changedFiles,
          lintPassed: true,
          testsPassed: true,
          buildPassed: true,
          draft: false,
        });

        const runId = process.env.GITHUB_RUN_ID?.replace(/[^0-9A-Za-z_-]/g, "") || Date.now().toString();
        const branch = `autonomy/run-${runId}`;
        run("git", ["config", "user.name", "ai-company-autonomy"], cwd);
        run("git", ["config", "user.email", "actions@users.noreply.github.com"], cwd);
        run("git", ["checkout", "-b", branch], cwd);
        run("git", ["add", "--", ...changedFiles], cwd);
        const status = run("git", ["status", "--porcelain"], cwd);
        if (!status) return { actionId: action.id, ok: false, summary: "Model proposal produced no repository changes", blocker: "empty_patch" };
        run("git", ["commit", "-m", "chore: bounded autonomous proposal"], cwd);
        run("git", ["push", "origin", `HEAD:${branch}`], cwd);
        const pr = await openPullRequest({ token, repository, head: branch, title: proposal.title, body: proposal.body });

        const autoMerge = autoMergeDecision.eligible
          ? await enablePullRequestAutoMerge({ token, nodeId: pr.nodeId })
          : { enabled: false, reason: autoMergeDecision.reasons.join(",") };

        return {
          actionId: action.id,
          ok: true,
          summary: autoMerge.enabled
            ? `Created verified bounded proposal PR with auto-merge queued behind repository protections: ${pr.url}`
            : `Created verified bounded proposal PR; auto-merge was not enabled: ${pr.url}`,
          evidence: {
            prUrl: pr.url,
            prNumber: pr.number,
            branch,
            changedFiles,
            verification: ["pnpm lint", "pnpm test", "pnpm build"],
            autoMergeEligible: autoMergeDecision.eligible,
            autoMergeEnabled: autoMerge.enabled,
            autoMergeReason: autoMerge.enabled ? null : autoMerge.reason ?? null,
          },
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "unknown bounded proposal error";
        return { actionId: action.id, ok: false, summary: `Bounded PR proposal failed: ${message}`, blocker: "proposal_failed" };
      }
    },
  };
}
