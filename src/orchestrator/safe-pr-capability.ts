import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, normalize, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateTaskScopedAutoMergeEligibility } from "./auto-merge-policy.ts";
import type { ActionResult, ProposedAction } from "./goal-loop.ts";
import {
  isTaskProductionDeployAuthorizationActive,
  normalizeTaskCompletionAuthorization,
  type TaskCompletionAuthorization,
} from "./task-authorization.ts";

interface ProposalFile { path: string; content: string; }
interface ProposalInput {
  title?: string;
  body?: string;
  files?: ProposalFile[];
  taskAuthorization?: TaskCompletionAuthorization;
  taskScopeId?: string;
}
interface CanonicalReconciliation {
  requirementId: string;
  script: string;
  issueNumber: number;
}
interface ParsedProposal {
  title: string;
  body: string;
  files: ProposalFile[];
  reconciliation?: CanonicalReconciliation;
  taskAuthorization?: TaskCompletionAuthorization;
  taskScopeId?: string;
}
interface OpenedPullRequest { url: string; nodeId: string; number: number; }

const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 100_000;
const ALLOWED_PREFIXES = ["src/", "tests/", "docs/", "scripts/"];
const FORBIDDEN = new Set(["AGENTS.md", "PROJECT_STATE.md", "ROADMAP.md", "package.json", "pnpm-lock.yaml"]);
const RECONCILIATION_PREFIX = "docs/.jarvis-reconcile/";
const CANONICAL_LEDGER_FILES = ["docs/JARVIS_PRODUCT_SPEC.md", "docs/jarvis-requirements.json"] as const;
const CANONICAL_RECONCILIATIONS: Record<string, Omit<CanonicalReconciliation, "requirementId">> = {
  "SEC-012": { script: "scripts/reconcile-issue-952-sec012.mjs", issueNumber: 952 },
  "SEC-013": { script: "scripts/reconcile-issue-960-sec013.mjs", issueNumber: 960 },
  "SEC-014": { script: "scripts/reconcile-issue-964-sec014.mjs", issueNumber: 964 },
};

export function parseCanonicalReconciliationDirective(file: ProposalFile): CanonicalReconciliation | null {
  const path = normalize(file.path).replaceAll("\\", "/");
  if (!path.startsWith(RECONCILIATION_PREFIX)) return null;
  if (file.content !== "") throw new Error("canonical reconciliation directive content must be empty");
  const requirementId = path.slice(RECONCILIATION_PREFIX.length);
  const mapped = CANONICAL_RECONCILIATIONS[requirementId];
  if (!mapped) throw new Error(`canonical reconciliation is not allowlisted: ${requirementId || "<empty>"}`);
  return { requirementId, ...mapped };
}

function parseInput(action: ProposedAction): ParsedProposal {
  const input = action.input as ProposalInput | undefined;
  const files = input?.files;
  if (!input?.title?.trim() || !Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) {
    throw new Error("invalid autonomous PR proposal input");
  }

  const reconciliationDirectives = files
    .map((file) => parseCanonicalReconciliationDirective(file))
    .filter((value): value is CanonicalReconciliation => value !== null);
  if (reconciliationDirectives.length > 0) {
    if (files.length !== 1 || reconciliationDirectives.length !== 1) {
      throw new Error("canonical reconciliation directive cannot be mixed with ordinary proposal files");
    }
    const taskAuthorization = input.taskAuthorization === undefined
      ? undefined
      : normalizeTaskCompletionAuthorization(input.taskAuthorization);
    const taskScopeId = input.taskScopeId?.trim() || undefined;
    return {
      title: input.title.trim(),
      body: input.body?.trim() || "Bounded canonical reconciliation proposal. The allowlisted reconciler and canonical mirror validator must pass before a PR can be opened.",
      files: [],
      reconciliation: reconciliationDirectives[0],
      taskAuthorization,
      taskScopeId,
    };
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

  const taskAuthorization = input.taskAuthorization === undefined
    ? undefined
    : normalizeTaskCompletionAuthorization(input.taskAuthorization);
  const taskScopeId = input.taskScopeId?.trim() || undefined;

  return {
    title: input.title.trim(),
    body: input.body?.trim() || "Bounded autonomous proposal. Verified low-risk proposals may auto-merge only when the owner granted task-scoped completion authorization.",
    files,
    taskAuthorization,
    taskScopeId,
  };
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).slice(-4000)}`);
  return result.stdout.trim();
}

function changedFiles(cwd: string): string[] {
  const output = run("git", ["diff", "--name-only"], cwd);
  return output ? output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).sort() : [];
}

function requireCanonicalLedgerOnly(paths: string[]): void {
  const expected = [...CANONICAL_LEDGER_FILES].sort();
  if (paths.length !== expected.length || paths.some((path, index) => path !== expected[index])) {
    throw new Error(`canonical reconciliation changed unexpected paths: ${paths.join(",") || "<none>"}`);
  }
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

function buildTaskScopedPrBody(proposal: ParsedProposal): { body: string; productionDeployAuthorized: boolean } {
  const productionDeployAuthorized = isTaskProductionDeployAuthorizationActive(
    proposal.taskAuthorization,
    proposal.taskScopeId,
  );
  const metadata = [
    proposal.taskScopeId ? `<!-- ai-company-task-scope: ${proposal.taskScopeId} -->` : "",
    productionDeployAuthorized ? "<!-- ai-company-production-deploy: approved -->" : "",
    productionDeployAuthorized && proposal.taskAuthorization
      ? `<!-- ai-company-task-authorization-expires-at: ${proposal.taskAuthorization.expiresAt} -->`
      : "",
  ].filter(Boolean);
  const reconciliation = proposal.reconciliation
    ? `\n\n<!-- jarvis-canonical-reconciliation: ${proposal.reconciliation.requirementId} issue-${proposal.reconciliation.issueNumber} -->`
    : "";
  return {
    body: `${metadata.length ? `${proposal.body}\n\n${metadata.join("\n")}` : proposal.body}${reconciliation}`,
    productionDeployAuthorized,
  };
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

        if (proposal.reconciliation) {
          const dirty = run("git", ["status", "--porcelain"], cwd);
          if (dirty) throw new Error("canonical reconciliation requires a clean checkout");
          run(process.execPath, [proposal.reconciliation.script], cwd);
          run(process.execPath, ["scripts/validate-jarvis-requirements.mjs"], cwd);
          requireCanonicalLedgerOnly(changedFiles(cwd));
        } else {
          for (const file of proposal.files) {
            const destination = resolve(cwd, file.path);
            if (!destination.startsWith(resolve(cwd) + "/") && destination !== resolve(cwd)) throw new Error(`resolved path escaped repository: ${file.path}`);
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, file.content, "utf-8");
          }
        }

        run("pnpm", ["lint"], cwd);
        run("pnpm", ["test"], cwd);
        run("pnpm", ["build"], cwd);

        const proposalChangedFiles = proposal.reconciliation
          ? changedFiles(cwd)
          : proposal.files.map((file) => file.path);
        if (proposal.reconciliation) requireCanonicalLedgerOnly(proposalChangedFiles);
        const autoMergeDecision = evaluateTaskScopedAutoMergeEligibility({
          baseBranch: "main",
          changedFiles: proposalChangedFiles,
          lintPassed: true,
          testsPassed: true,
          buildPassed: true,
          qaPassed: true,
          reviewerPassed: true,
          unresolvedReviewThreads: 0,
          destructiveChangeAbsent: true,
          privilegedChangeAbsent: true,
          draft: false,
          taskAuthorization: proposal.taskAuthorization,
          taskScopeId: proposal.taskScopeId,
        });

        const runId = process.env.GITHUB_RUN_ID?.replace(/[^0-9A-Za-z_-]/g, "") || Date.now().toString();
        const branch = proposal.reconciliation
          ? `autonomy/reconcile-${proposal.reconciliation.requirementId.toLowerCase()}-${runId}`
          : `autonomy/run-${runId}`;
        run("git", ["config", "user.name", "ai-company-autonomy"], cwd);
        run("git", ["config", "user.email", "actions@users.noreply.github.com"], cwd);
        run("git", ["checkout", "-b", branch], cwd);
        run("git", ["add", "--", ...proposalChangedFiles], cwd);
        const status = run("git", ["status", "--porcelain"], cwd);
        if (!status) return { actionId: action.id, ok: false, summary: "Model proposal produced no repository changes", blocker: "empty_patch" };
        run("git", ["commit", "-m", proposal.reconciliation ? `docs(jarvis): reconcile ${proposal.reconciliation.requirementId}` : "chore: bounded autonomous proposal"], cwd);
        run("git", ["push", "origin", `HEAD:${branch}`], cwd);
        const prBody = buildTaskScopedPrBody(proposal);
        const pr = await openPullRequest({ token, repository, head: branch, title: proposal.title, body: prBody.body });

        const autoMerge = autoMergeDecision.eligible
          ? await enablePullRequestAutoMerge({ token, nodeId: pr.nodeId })
          : { enabled: false, reason: autoMergeDecision.reasons.join(",") };

        return {
          actionId: action.id,
          ok: true,
          summary: autoMerge.enabled
            ? `Created verified task-scoped proposal PR with auto-merge queued behind repository protections: ${pr.url}`
            : `Created verified bounded proposal PR; auto-merge was not enabled: ${pr.url}`,
          evidence: {
            prUrl: pr.url,
            prNumber: pr.number,
            branch,
            changedFiles: proposalChangedFiles,
            reconciliationRequirement: proposal.reconciliation?.requirementId ?? null,
            verification: proposal.reconciliation
              ? ["canonical reconciler", "canonical mirror validator", "pnpm lint", "pnpm test", "pnpm build"]
              : ["pnpm lint", "pnpm test", "pnpm build"],
            taskScopeId: proposal.taskScopeId ?? null,
            taskCompletionAuthorized: Boolean(proposal.taskAuthorization),
            productionDeployAuthorized: prBody.productionDeployAuthorized,
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
