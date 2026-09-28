import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_AUTOMATIC_ATTEMPTS = 3;

export interface PullRequestInfo {
  number: number;
  state: string;
  head: { ref: string; sha: string; repo?: { full_name?: string } | null };
  base: { ref: string };
}

export function isSameRepositoryOpenPullRequest(pr: PullRequestInfo, repository: string): boolean {
  return pr.state === "open"
    && pr.head.repo?.full_name === repository
    && pr.head.ref !== "main"
    && pr.base.ref === "main";
}

export function recoveryAttemptCount(subjects: string[]): number {
  return subjects.filter((subject) => subject.startsWith("fix(ci): goriq recovery attempt ")).length;
}

export function sanitizeFailureLog(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:token|secret|password)=([^\s&]+)/gi, "$1=[REDACTED]")
    .replace(/\r\n/g, "\n")
    .slice(-60_000);
}

const PROTECTED_PREFIXES = [
  ".github/",
  "src/app/api/owner-login/",
  "src/app/api/owner-logout/",
  "src/app/api/vercel-owner/",
  "migrations/",
];

const PROTECTED_FILES = new Set([
  "AGENTS.md",
  "PROJECT_STATE.md",
  "docs/JARVIS_PRODUCT_SPEC.md",
  "docs/jarvis-requirements.json",
  "docs/jarvis-owner-decisions.json",
  "package.json",
  "pnpm-lock.yaml",
]);

function isTestPath(path: string): boolean {
  return path.startsWith("tests/") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

export function allowedRepairPaths(prPaths: string[]): string[] {
  return [...new Set(prPaths)]
    .filter((path) => !PROTECTED_FILES.has(path))
    .filter((path) => !PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !isTestPath(path))
    .sort();
}

function run(command: string, args: string[], cwd: string, input?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr || result.stdout).slice(-4000)}`);
  }
  return String(result.stdout ?? "").trim();
}

function parseRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must be owner/name");
  return { owner, repo };
}

async function githubJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`);
  return await response.json() as T;
}

async function failedRunLog(repository: string, runId: string, token: string): Promise<string> {
  const { owner, repo } = parseRepository(repository);
  const jobs = await githubJson<{ jobs: Array<{ id: number; name: string; conclusion: string | null }> }>(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`,
    token,
  );
  const failed = jobs.jobs.filter((job) => job.conclusion === "failure").slice(0, 4);
  const chunks: string[] = [];
  for (const job of failed) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) continue;
    chunks.push(`## ${job.name}\n${await response.text()}`);
  }
  return sanitizeFailureLog(chunks.join("\n\n"));
}
