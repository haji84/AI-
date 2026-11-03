import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, normalize, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateTaskScopedAutoMergeEligibility } from "./auto-merge-policy.ts";
import type { DevelopmentReleaseGateDecision } from "./development-release-gate.ts";
import type { ActionResult, ContextItem, ProposedAction } from "./goal-loop.ts";
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
interface ParsedProposal {
  title: string;
  body: string;
  files: ProposalFile[];
  taskAuthorization?: TaskCompletionAuthorization;
  taskScopeId?: string;
}
interface OpenedPullRequest { url: string; nodeId: string; number: number; }
export interface RequirementSurfaceBinding {
  path: string;
  requirementIds: string[];
  classification: "COVERED_BY_REQUIREMENT" | "INTERNAL_IMPLEMENTATION_DETAIL";
  reason: string;
  verified: true;
  verifierId: string;
}

function extractVerifiedRequirementBindings(context: ContextItem[]): RequirementSurfaceBinding[] {
  const bindings: RequirementSurfaceBinding[] = [];
  for (const item of context) {
    if (item.source !== "development.requirement_binding" || !item.data || typeof item.data !== "object" || Array.isArray(item.data)) continue;
    const data = item.data as Partial<RequirementSurfaceBinding>;
    if (data.verified !== true || typeof data.path !== "string" || !data.path.trim()
      || !Array.isArray(data.requirementIds) || data.requirementIds.length === 0
      || data.requirementIds.some((id) => typeof id !== "string" || !/^[-A-Z]+-\d{3}$/.test(id))
      || new Set(data.requirementIds).size !== data.requirementIds.length
      || !["COVERED_BY_REQUIREMENT", "INTERNAL_IMPLEMENTATION_DETAIL"].includes(data.classification ?? "")
      || typeof data.reason !== "string" || !data.reason.trim()
      || typeof data.verifierId !== "string" || !data.verifierId.trim()) continue;
    bindings.push({
      path: normalize(data.path).replaceAll("\\", "/"),
      requirementIds: [...data.requirementIds],
      classification: data.classification as RequirementSurfaceBinding["classification"],
      reason: data.reason.trim(),
      verified: true,
      verifierId: data.verifierId.trim(),
    });
  }
  return bindings;
}

export function canEnableSafePrAutoMerge(decision: DevelopmentReleaseGateDecision | undefined): boolean {
  return decision?.action === "ENABLE_AUTO_MERGE" && decision.reasons.length === 0;
}

const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 100_000;
const ALLOWED_PREFIXES = ["src/", "tests/", "docs/", "scripts/"];
const FORBIDDEN = new Set(["AGENTS.md", "PROJECT_STATE.md", "ROADMAP.md", "package.json", "pnpm-lock.yaml"]);
const TRACEABILITY_PATH = "docs/jarvis-reverse-traceability.json";
const AUDIT_IMPLEMENTATION_PATH = "scripts/jarvis-requirement-audit.mjs";
const AUTO_RECONCILE_BLOCKED_PREFIXES = [".github/", "src/app/api/owner-login/", "src/app/api/owner-logout/"];
const AUTO_RECONCILE_BLOCKED_PATHS = new Set([TRACEABILITY_PATH, AUDIT_IMPLEMENTATION_PATH, "docs/jarvis-requirements.json", "docs/JARVIS_PRODUCT_SPEC.md", "docs/jarvis-owner-decisions.json"]);

function surfaceFingerprint(bytes: Buffer): string {
  if (bytes.includes(0)) return createHash("sha256").update(bytes).digest("hex");
  try {
    const normalized = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\r\n/g, "\n");
    return createHash("sha256").update(normalized).digest("hex");
  } catch {
    return createHash("sha256").update(bytes).digest("hex");
  }
}

export function autoReconcileTraceability(
  cwd: string,
  changedPaths: string[],
  risk: ProposedAction["risk"],
  verifiedBindings: RequirementSurfaceBinding[] = [],
): string[] {
  if (!["low", "medium"].includes(risk)) return [];
  if (changedPaths.some((path) => AUTO_RECONCILE_BLOCKED_PATHS.has(path) || AUTO_RECONCILE_BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix)))) return [];
  const reportPath = resolve(cwd, TRACEABILITY_PATH);
  const report = JSON.parse(readFileSync(reportPath, "utf-8")) as { surfaces?: Array<{ path?: string; sha256?: string; classification?: string; requirement_ids?: string[]; reason?: string }> };
  if (!Array.isArray(report.surfaces)) throw new Error("invalid reverse traceability report");
  const requirements = JSON.parse(readFileSync(resolve(cwd, "docs/jarvis-requirements.json"), "utf-8")) as { requirements?: Array<{ id?: string }> };
  if (!Array.isArray(requirements.requirements)) throw new Error("invalid canonical requirement registry");
  const knownRequirementIds = new Set(requirements.requirements.flatMap((row) => typeof row.id === "string" ? [row.id] : []));
  let changed = false;
  for (const rawPath of changedPaths) {
    const path = normalize(rawPath).replaceAll("\\", "/");
    let row = report.surfaces.find((item) => item.path === path);
    if (!row) {
      const matches = verifiedBindings.filter((binding) => binding.verified === true && binding.path === path);
      if (matches.length === 0) continue;
      if (matches.length !== 1) throw new Error(`traceability auto-reconciliation requires one verified binding: ${path}`);
      const binding = matches[0]!;
      if (binding.requirementIds.some((id) => !knownRequirementIds.has(id))) {
        throw new Error(`unknown canonical requirement in verified binding: ${path}`);
      }
      if (!["COVERED_BY_REQUIREMENT", "INTERNAL_IMPLEMENTATION_DETAIL"].includes(binding.classification) || !binding.reason.trim() || !binding.verifierId.trim()) {
        throw new Error(`invalid verified requirement binding: ${path}`);
      }
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || path.startsWith("tests/")) continue;
      row = {
        path,
        sha256: surfaceFingerprint(readFileSync(resolve(cwd, path))),
        classification: binding.classification,
        requirement_ids: [...binding.requirementIds],
        reason: binding.reason,
      };
      report.surfaces.push(row);
      changed = true;
      continue;
    }
    if (!["COVERED_BY_REQUIREMENT", "INTERNAL_IMPLEMENTATION_DETAIL"].includes(row.classification ?? "") || !Array.isArray(row.requirement_ids) || row.requirement_ids.length === 0 || !row.reason?.trim()) {
      throw new Error(`traceability auto-reconciliation requires an existing canonical mapping: ${path}`);
    }
    const digest = surfaceFingerprint(readFileSync(resolve(cwd, path)));
    if (row.sha256 !== digest) { row.sha256 = digest; changed = true; }
  }
  if (!changed) return [];
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
  return [TRACEABILITY_PATH];
}

function parseInput(action: ProposedAction): ParsedProposal {
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
  return {
    body: metadata.length ? `${proposal.body}\n\n${metadata.join("\n")}` : proposal.body,
    productionDeployAuthorized,
  };
}

export function createSafePrProposalCapability(options: {
  cwd?: string;
  token?: string | null;
  repository?: string;
  releaseGateDecision?: DevelopmentReleaseGateDecision;
} = {}) {
  return {
    name: "repository.propose_pr",
    async execute(action: ProposedAction, context: ContextItem[] = []): Promise<ActionResult> {
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

        const proposalChangedFiles = proposal.files.map((file) => file.path);
        const reconciledFiles = autoReconcileTraceability(cwd, proposalChangedFiles, action.risk, extractVerifiedRequirementBindings(context));
        run("pnpm", ["lint"], cwd);
        run("pnpm", ["test"], cwd);
        run("pnpm", ["build"], cwd);

        const changedFiles = [...new Set([...proposalChangedFiles, ...reconciledFiles])];
        const releaseAllowsAutoMerge = canEnableSafePrAutoMerge(options.releaseGateDecision);
        const autoMergeDecision = evaluateTaskScopedAutoMergeEligibility({
          baseBranch: "main",
          changedFiles,
          lintPassed: true,
          testsPassed: true,
          buildPassed: true,
          qaPassed: releaseAllowsAutoMerge,
          reviewerPassed: releaseAllowsAutoMerge,
          unresolvedReviewThreads: 0,
          destructiveChangeAbsent: true,
          privilegedChangeAbsent: true,
          draft: false,
          taskAuthorization: proposal.taskAuthorization,
          taskScopeId: proposal.taskScopeId,
        });

        run("git", ["fetch", "origin", "main"], cwd);
        const currentHead = run("git", ["rev-parse", "HEAD"], cwd);
        const mainHead = run("git", ["rev-parse", "origin/main"], cwd);
        const mergeBase = run("git", ["merge-base", currentHead, mainHead], cwd);
        if (mergeBase !== mainHead) {
          throw new Error("autonomous proposal base is behind origin/main; refresh to current main before opening PR");
        }
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
        const prBody = buildTaskScopedPrBody(proposal);
        const pr = await openPullRequest({ token, repository, head: branch, title: proposal.title, body: prBody.body });

        const autoMerge = releaseAllowsAutoMerge && autoMergeDecision.eligible
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
            changedFiles,
            verification: ["pnpm lint", "pnpm test", "pnpm build"],
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
