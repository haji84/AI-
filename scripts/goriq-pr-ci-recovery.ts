import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { autoReconcileTraceability } from "../src/orchestrator/safe-pr-capability.ts";
import {
  REPAIR_ENGINE_ESCALATION_ORDER,
  type RepairEngineId,
} from "../src/orchestrator/repair-engine-router.ts";

export const MAX_AUTOMATIC_ATTEMPTS_PER_STRATEGY = 3;
export const MAX_AUTOMATIC_STRATEGIES = 3;
export const MAX_AUTOMATIC_ATTEMPTS = MAX_AUTOMATIC_ATTEMPTS_PER_STRATEGY * MAX_AUTOMATIC_STRATEGIES;
export const SAME_FAILURE_SWITCH_THRESHOLD = 2;
export const MAX_LOCAL_VERIFICATION_ATTEMPTS = 3;

export type RecoveryStrategy = 1 | 2 | 3;

export interface RecoveryHistoryEntry {
  strategy: RecoveryStrategy;
  strategyAttempt: number;
  totalAttempt: number;
  failureFingerprint: string;
}

export type RecoveryDecision =
  | {
      action: "attempt";
      strategy: RecoveryStrategy;
      strategyAttempt: number;
      totalAttempt: number;
      failureFingerprint: string;
      sameFailureOccurrences: number;
      reason: "initial" | "progress-continue" | "same-failure-escalation" | "strategy-budget-escalation";
    }
  | {
      action: "human-gate";
      totalAttempt: number;
      failureFingerprint: string;
      sameFailureOccurrences: number;
      reason: "strategies-exhausted";
    };

export interface PullRequestInfo {
  number: number;
  state: string;
  head: { ref: string; sha: string; repo?: { full_name?: string } | null };
  base: { ref: string; repo?: { full_name?: string } | null };
}

export function isSameRepositoryOpenPullRequest(pr: PullRequestInfo, repository: string): boolean {
  return pr.state === "open"
    && pr.head.repo?.full_name === repository
    && pr.base.repo?.full_name === repository
    && pr.head.ref !== "main"
    && pr.head.ref !== pr.base.ref;
}

export function recoveryAttemptCount(subjects: string[]): number {
  return subjects.filter((subject) =>
    subject.startsWith("fix(ci): goriq recovery attempt ")
      || subject.startsWith("fix(ci): goriq recovery strategy ")
  ).length;
}

export function failureFingerprint(value: string): string {
  const sanitized = sanitizeFailureLog(value);
  const signalLines = sanitized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /(?:error|failed|failure|exception|assert|typeerror|referenceerror|cannot|not found|expected|actual|elifecycle|err_)/i.test(line));

  const source = (signalLines.length ? signalLines.slice(-80).join("\n") : sanitized.slice(-12_000))
    .replace(/\b[0-9a-f]{40}\b/gi, "<sha>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<timestamp>")
    .replace(/:\d+(?::\d+)?\b/g, ":<line>")
    .replace(/\b(run|job|attempt)[-_ ]?\d+\b/gi, "$1-<n>")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|sec|seconds|minutes|min)\b/gi, "<duration>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

export function parseRecoveryHistory(messages: string[]): RecoveryHistoryEntry[] {
  const entries: RecoveryHistoryEntry[] = [];
  for (const message of messages) {
    const strategyMatch = message.match(/^GORIQ-Recovery-Strategy:\s*([1-3])$/mi);
    const strategyAttemptMatch = message.match(/^GORIQ-Recovery-Strategy-Attempt:\s*(\d+)$/mi);
    const totalAttemptMatch = message.match(/^GORIQ-Recovery-Total-Attempt:\s*(\d+)$/mi);
    const fingerprintMatch = message.match(/^GORIQ-Recovery-Failure-Fingerprint:\s*([a-f0-9]{8,64})$/mi);
    if (strategyMatch && strategyAttemptMatch && totalAttemptMatch && fingerprintMatch) {
      entries.push({
        strategy: Number(strategyMatch[1]) as RecoveryStrategy,
        strategyAttempt: Number(strategyAttemptMatch[1]),
        totalAttempt: Number(totalAttemptMatch[1]),
        failureFingerprint: fingerprintMatch[1].toLowerCase(),
      });
      continue;
    }

    const legacy = message.match(/^fix\(ci\): goriq recovery attempt (\d+)/mi);
    if (legacy) {
      const attempt = Number(legacy[1]);
      entries.push({
        strategy: 1,
        strategyAttempt: Math.min(attempt, MAX_AUTOMATIC_ATTEMPTS_PER_STRATEGY),
        totalAttempt: attempt,
        failureFingerprint: "legacy-unknown",
      });
    }
  }
  return entries;
}

export function chooseRecoveryStrategy(
  history: RecoveryHistoryEntry[],
  currentFingerprint: string,
): RecoveryDecision {
  if (!history.length) {
    return {
      action: "attempt",
      strategy: 1,
      strategyAttempt: 1,
      totalAttempt: 1,
      failureFingerprint: currentFingerprint,
      sameFailureOccurrences: 1,
      reason: "initial",
    };
  }

  const latest = history[0];
  let strategyAttempts = 0;
  for (const entry of history) {
    if (entry.strategy !== latest.strategy) break;
    strategyAttempts += 1;
  }

  let sameFailureOccurrences = 1;
  for (const entry of history) {
    if (entry.strategy !== latest.strategy || entry.failureFingerprint !== currentFingerprint) break;
    sameFailureOccurrences += 1;
  }

  const repeatedSameFailure = sameFailureOccurrences >= SAME_FAILURE_SWITCH_THRESHOLD;
  const strategyBudgetExhausted = strategyAttempts >= MAX_AUTOMATIC_ATTEMPTS_PER_STRATEGY;
  if (repeatedSameFailure || strategyBudgetExhausted) {
    if (latest.strategy >= MAX_AUTOMATIC_STRATEGIES) {
      return {
        action: "human-gate",
        totalAttempt: latest.totalAttempt,
        failureFingerprint: currentFingerprint,
        sameFailureOccurrences,
        reason: "strategies-exhausted",
      };
    }
    return {
      action: "attempt",
      strategy: (latest.strategy + 1) as RecoveryStrategy,
      strategyAttempt: 1,
      totalAttempt: latest.totalAttempt + 1,
      failureFingerprint: currentFingerprint,
      sameFailureOccurrences,
      reason: repeatedSameFailure ? "same-failure-escalation" : "strategy-budget-escalation",
    };
  }

  return {
    action: "attempt",
    strategy: latest.strategy,
    strategyAttempt: strategyAttempts + 1,
    totalAttempt: latest.totalAttempt + 1,
    failureFingerprint: currentFingerprint,
    sameFailureOccurrences,
    reason: "progress-continue",
  };
}

export function sanitizeFailureLog(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(token|secret|password)=([^\s&]+)/gi, "$1=[REDACTED]")
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
  "docs/jarvis-reverse-traceability.json",
  "docs/jarvis-additional-requirements.json",
  "package.json",
  "pnpm-lock.yaml",
]);

function isTestPath(path: string): boolean {
  return path.startsWith("tests/") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

const PROTECTED_PATH_PATTERN = /(?:^|[-_./])(?:auth|security|secret|credential|permission|billing|payment|enroll(?:ment)?|migration|token)(?:[-_./]|$)/i;

function isProtectedRepairPath(path: string): boolean {
  return PROTECTED_PATH_PATTERN.test(path);
}

export function allowedRepairPaths(prPaths: string[]): string[] {
  return [...new Set(prPaths)]
    .filter((path) => !PROTECTED_FILES.has(path))
    .filter((path) => !PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !isTestPath(path))
    .filter((path) => !isProtectedRepairPath(path))
    .sort();
}

export function commandInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string = process.env.ComSpec || "cmd.exe",
): { command: string; args: string[] } {
  const extension = extname(command).toLowerCase();
  if (platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    return { command: comSpec, args: ["/d", "/s", "/c", command, ...args] };
  }
  return { command, args };
}

function resolveCommandForPlatform(command: string): string {
  if (process.platform !== "win32" || extname(command)) return command;
  const probe = spawnSync("where.exe", [command], { encoding: "utf8", windowsHide: true });
  if (probe.status !== 0) return command;
  const first = String(probe.stdout ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return first ? normalizeConfiguredEnginePath(first) : command;
}

function runRaw(command: string, args: string[], cwd: string, input?: string): string {
  const resolvedCommand = resolveCommandForPlatform(command);
  const invocation = commandInvocation(resolvedCommand, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} failed to launch: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = commandFailureOutput(result.stdout, result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with exit ${String(result.status)}: ${output}`);
  }
  return String(result.stdout ?? "");
}

export function commandFailureOutput(stdout: string | Buffer | null | undefined, stderr: string | Buffer | null | undefined): string {
  const chunks = [String(stdout ?? "").trim(), String(stderr ?? "").trim()].filter(Boolean);
  return sanitizeFailureLog(chunks.join("\n")).slice(-12_000) || "no command output";
}

type VerificationResult =
  | { ok: true; checks: string[] }
  | { ok: false; checks: string[]; failedCheck: string; failure: string };

const RECOVERY_VERIFICATION_STEPS: Array<{ label: string; command: string; args: string[] }> = [
  { label: "pnpm lint", command: "pnpm", args: ["lint"] },
  { label: "pnpm test", command: "pnpm", args: ["test"] },
  { label: "pnpm test:p8-security", command: "pnpm", args: ["test:p8-security"] },
  { label: "pnpm build", command: "pnpm", args: ["build"] },
];

function verifyRecoveryCandidate(workspace: string): VerificationResult {
  const checks: string[] = [];
  for (const step of RECOVERY_VERIFICATION_STEPS) {
    try {
      run(step.command, step.args, workspace);
      checks.push(step.label);
    } catch (error) {
      const failure = sanitizeFailureLog(error instanceof Error ? error.message : String(error));
      return { ok: false, checks, failedCheck: step.label, failure };
    }
  }
  return { ok: true, checks };
}

function run(command: string, args: string[], cwd: string, input?: string): string {
  return runRaw(command, args, cwd, input).trim();
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

export function normalizeConfiguredEnginePath(
  engine: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const trimmed = engine.trim();
  if (!trimmed || platform !== "win32" || extname(trimmed)) return trimmed;
  for (const suffix of [".cmd", ".bat", ".exe"]) {
    const candidate = `${trimmed}${suffix}`;
    if (fileExists(candidate)) return candidate;
  }
  return trimmed;
}

function resolveConfiguredEngine(): string {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    const statusPath = join(localAppData, "GAIWorker", "code-builder", "install-status.json");
    if (existsSync(statusPath)) {
      try {
        const parsed = JSON.parse(readFileSync(statusPath, "utf8")) as { configuredEngine?: unknown };
        if (typeof parsed.configuredEngine === "string" && parsed.configuredEngine.trim()) {
          return normalizeConfiguredEnginePath(parsed.configuredEngine);
        }
      } catch (error) { void error; }
    }
  }
  const probe = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(probe, ["codex"], { encoding: "utf8", windowsHide: true });
  if (result.status === 0) {
    const first = String(result.stdout ?? "").split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (first) return normalizeConfiguredEnginePath(first);
  }
  throw new Error("CODING_ENGINE_UNAVAILABLE");
}

export function sanitizedBuilderEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "ACTIONS_RUNTIME_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "CODE_BUILDER_TOKEN",
  ]) delete next[key];
  return next;
}

type RepairEngineRunner = {
  id: Exclude<RepairEngineId, "human-gate">;
  run(prompt: string): void;
};

export const REPAIR_ENGINE_COMMAND_ENV: Readonly<Partial<Record<Exclude<RepairEngineId, "human-gate" | "goriq-deterministic" | "codex">, string>>> = Object.freeze({
  "goriq-learned": "GORIQ_LEARNED_REPAIR_COMMAND",
  "goriq-local-code": "GORIQ_LOCAL_CODE_REPAIR_COMMAND",
  "goriq-local-capability": "GORIQ_LOCAL_CAPABILITY_REPAIR_COMMAND",
  chat: "GORIQ_CHAT_REPAIR_COMMAND",
  work: "GORIQ_WORK_REPAIR_COMMAND",
  "free-external": "GORIQ_FREE_EXTERNAL_REPAIR_COMMAND",
});

function runConfiguredRepairCommand(command: string, workspace: string, prompt: string): void {
  const resolved = normalizeConfiguredEnginePath(command.trim());
  if (!resolved) throw new Error("REPAIR_ENGINE_COMMAND_UNAVAILABLE");
  const invocation = commandInvocation(resolved, []);
  const env = sanitizedBuilderEnvironment();
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "never";
  env.GH_CONFIG_DIR = join(workspace, ".goriq-gh-disabled");
  env.GIT_CONFIG_COUNT = "2";
  env.GIT_CONFIG_KEY_0 = "credential.helper";
  env.GIT_CONFIG_VALUE_0 = "";
  env.GIT_CONFIG_KEY_1 = "remote.origin.pushurl";
  env.GIT_CONFIG_VALUE_1 = "https://127.0.0.1/goriq-push-disabled";
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: workspace,
    encoding: "utf8",
    input: prompt,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 12 * 60_000,
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`repair engine command failed: ${commandFailureOutput(result.stdout, result.stderr)}`);
  }
}

function runDeterministicRepair(workspace: string, prompt: string, allowedPaths: string[]): void {
  if (!/(?:eslint|prettier|lint|format(?:ting)?)/i.test(prompt)) return;
  const sourcePaths = allowedPaths.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
  if (!sourcePaths.length) return;
  try {
    run("pnpm", ["exec", "eslint", "--fix", "--", ...sourcePaths], workspace);
  } catch {
    // A deterministic fixer may still leave a useful bounded edit. Scope and verification decide whether it survives.
  }
}

function resolveCodexEngineOrNull(): string | null {
  try {
    return resolveConfiguredEngine();
  } catch {
    return null;
  }
}

export function configuredRepairEngineIds(
  env: Record<string, string | undefined> = process.env,
  codexAvailable = resolveCodexEngineOrNull() !== null,
): Array<Exclude<RepairEngineId, "human-gate">> {
  const available = new Set<Exclude<RepairEngineId, "human-gate">>(["goriq-deterministic"]);
  for (const [id, key] of Object.entries(REPAIR_ENGINE_COMMAND_ENV) as Array<[
    Exclude<RepairEngineId, "human-gate" | "goriq-deterministic" | "codex">,
    string,
  ]>) {
    if (env[key]?.trim()) available.add(id);
  }
  if (codexAvailable) available.add("codex");
  return REPAIR_ENGINE_ESCALATION_ORDER
    .map((stage) => stage.id)
    .filter((id): id is Exclude<RepairEngineId, "human-gate"> => id !== "human-gate" && available.has(id));
}

function createRepairEngineRunners(
  workspace: string,
  allowedPaths: string[],
  env: Record<string, string | undefined> = process.env,
): RepairEngineRunner[] {
  const codexEngine = resolveCodexEngineOrNull();
  const runners = new Map<Exclude<RepairEngineId, "human-gate">, RepairEngineRunner>();

  runners.set("goriq-deterministic", {
    id: "goriq-deterministic",
    run(prompt) {
      runDeterministicRepair(workspace, prompt, allowedPaths);
    },
  });

  for (const [id, key] of Object.entries(REPAIR_ENGINE_COMMAND_ENV) as Array<[
    Exclude<RepairEngineId, "human-gate" | "goriq-deterministic" | "codex">,
    string,
  ]>) {
    const command = env[key]?.trim();
    if (!command) continue;
    runners.set(id, {
      id,
      run(prompt) {
        runConfiguredRepairCommand(command, workspace, prompt);
      },
    });
  }

  if (codexEngine) {
    runners.set("codex", {
      id: "codex",
      run(prompt) {
        runCodex(codexEngine, workspace, prompt);
      },
    });
  }

  return REPAIR_ENGINE_ESCALATION_ORDER
    .map((stage) => stage.id)
    .filter((id): id is Exclude<RepairEngineId, "human-gate"> => id !== "human-gate")
    .flatMap((id) => {
      const runner = runners.get(id);
      return runner ? [runner] : [];
    });
}

function runCodex(engine: string, workspace: string, prompt: string): void {
  const extension = extname(engine).toLowerCase();
  const args = [
    ...(process.platform === "win32" ? ["-c", 'windows.sandbox="unelevated"'] : []),
    "exec",
    "--sandbox", "workspace-write",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "-",
  ];
  const command = process.platform === "win32" && (extension === ".cmd" || extension === ".bat")
    ? (process.env.ComSpec || "cmd.exe")
    : engine;
  const commandArgs = command === engine ? args : ["/d", "/s", "/c", engine, ...args];
  const builderEnv = sanitizedBuilderEnvironment();
  builderEnv.GIT_TERMINAL_PROMPT = "0";
  builderEnv.GCM_INTERACTIVE = "never";
  builderEnv.GH_CONFIG_DIR = join(workspace, ".goriq-gh-disabled");
  builderEnv.GIT_CONFIG_COUNT = "2";
  builderEnv.GIT_CONFIG_KEY_0 = "credential.helper";
  builderEnv.GIT_CONFIG_VALUE_0 = "";
  builderEnv.GIT_CONFIG_KEY_1 = "remote.origin.pushurl";
  builderEnv.GIT_CONFIG_VALUE_1 = "https://127.0.0.1/goriq-push-disabled";
  const result = spawnSync(command, commandArgs, {
    cwd: workspace,
    encoding: "utf8",
    input: prompt,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 12 * 60_000,
    env: builderEnv,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Codex recovery failed: ${String(result.stderr || result.stdout).slice(-5000)}`);
  }
}

export function buildRecoveryPrompt(input: {
  prNumber: number;
  strategy: RecoveryStrategy;
  strategyAttempt: number;
  totalAttempt: number;
  decisionReason: "initial" | "progress-continue" | "same-failure-escalation" | "strategy-budget-escalation";
  failureFingerprint: string;
  allowedPaths: string[];
  failureLog: string;
}): string {
  const strategyInstruction = input.strategy === 1
    ? "Strategy 1: use the smallest evidence-backed localized implementation correction."
    : input.strategy === 2
      ? "Strategy 2: use a materially different implementation path. Re-check call sites, data flow, invariants and assumptions; do not repeat the prior correction pattern."
      : "Strategy 3: use a bounded structural or architectural correction inside AllowedPaths only. Refactor the implementation shape if needed, but do not expand authority or modify tests, dependencies, workflows or governance.";

  return [
    "You are the bounded GORIQ CI recovery worker.",
    "Read AGENTS.md and PROJECT_STATE.md before editing.",
    `Fix the concrete CI failure for PR #${input.prNumber}.`,
    `Recovery strategy ${input.strategy} of ${MAX_AUTOMATIC_STRATEGIES}; strategy attempt ${input.strategyAttempt} of ${MAX_AUTOMATIC_ATTEMPTS_PER_STRATEGY}; total attempt ${input.totalAttempt} of at most ${MAX_AUTOMATIC_ATTEMPTS}.`,
    `RecoveryDecision=${input.decisionReason}; FailureFingerprint=${input.failureFingerprint}`,
    strategyInstruction,
    input.totalAttempt > 1 ? "Inspect prior recovery commits and do not repeat a materially equivalent failed correction." : "Use the first evidence-backed correction.",
    "Treat a changed failure mode as progress evidence, not permission to broaden scope.",
    "Do not commit, push, merge, deploy, change workflows, permissions, credentials, secrets, dependencies, requirements, governance, or existing tests.",
    "Do not weaken or delete tests. Do not edit files outside AllowedPaths.",
    `AllowedPaths=${input.allowedPaths.join(",")}`,
    "If the failure requires work outside AllowedPaths, make no changes.",
    "FailureEvidence:",
    input.failureLog,
  ].join("\n");
}

export function buildVerificationRepairPrompt(input: {
  prNumber: number;
  strategy: RecoveryStrategy;
  localAttempt: number;
  allowedPaths: string[];
  originalFailureFingerprint: string;
  verificationCheck: string;
  verificationFailure: string;
}): string {
  return [
    "You are correcting an uncommitted GORIQ recovery candidate that failed local verification.",
    "Read AGENTS.md and PROJECT_STATE.md before editing.",
    `PR #${input.prNumber}; strategy ${input.strategy}; local candidate attempt ${input.localAttempt} of ${MAX_LOCAL_VERIFICATION_ATTEMPTS}.`,
    `OriginalFailureFingerprint=${input.originalFailureFingerprint}`,
    `FailedVerificationCheck=${input.verificationCheck}`,
    "Keep the original CI objective. Inspect the current uncommitted diff and repair the candidate rather than starting unrelated work.",
    "Use the verification failure below as new evidence. Do not repeat a materially equivalent failed correction.",
    "Do not commit, push, merge, deploy, change workflows, permissions, credentials, secrets, dependencies, requirements, governance, or existing tests.",
    "Do not weaken or delete tests. Do not edit files outside AllowedPaths.",
    `AllowedPaths=${input.allowedPaths.join(",")}`,
    "VerificationFailureEvidence:",
    sanitizeFailureLog(input.verificationFailure),
  ].join("\n");
}

export function porcelainPaths(output: string): string[] {
  return [...new Set(output.split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean))]
    .sort();
}

export function outOfScopeUntrackedPaths(output: string, allowedPaths: Iterable<string>): string[] {
  const allowed = new Set(allowedPaths);
  return [...new Set(output.split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter((path) => path && !allowed.has(path)))]
    .sort();
}


const GENERATED_WORKSPACE_NOISE = new Set(["next-env.d.ts"]);

export function generatedWorkspaceNoisePaths(paths: string[], allowedPaths: Iterable<string>): string[] {
  const allowed = new Set(allowedPaths);
  return paths.filter((path) => GENERATED_WORKSPACE_NOISE.has(path) && !allowed.has(path));
}

function restoreGeneratedWorkspaceNoise(workspace: string, paths: string[], allowedPaths: Iterable<string>): void {
  const generated = generatedWorkspaceNoisePaths(paths, allowedPaths);
  if (generated.length) run("git", ["restore", "--", ...generated], workspace);
}

function discardOutOfScopeUntracked(workspace: string, statusOutput: string, allowedPaths: Iterable<string>): string[] {
  const discarded = outOfScopeUntrackedPaths(statusOutput, allowedPaths);
  for (const path of discarded) {
    run("git", ["clean", "-fd", "--", path], workspace);
  }
  return discarded;
}

function restoreWorkspace(workspace: string): void {
  run("git", ["reset", "--hard", "HEAD"], workspace);
  run("git", ["clean", "-fd"], workspace);
}

function pushWithGithubToken(workspace: string, branch: string, token: string): void {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
  const result = spawnSync("git", ["push", "origin", `HEAD:${branch}`], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`authenticated git push failed: ${String(result.stderr || result.stdout).slice(-3000)}`);
  }
}

async function pullRequestFiles(repository: string, prNumber: number, token: string): Promise<string[]> {
  const { owner, repo } = parseRepository(repository);
  const files: string[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await githubJson<Array<{ filename: string }>>(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      token,
    );
    files.push(...batch.map((item) => item.filename));
    if (batch.length < 100) break;
  }
  return [...new Set(files)];
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY?.trim() || "";
  const token = process.env.GITHUB_TOKEN?.trim() || "";
  const prNumber = Number(process.env.GORIQ_RECOVERY_PR_NUMBER || "");
  const failedRunId = process.env.GORIQ_RECOVERY_RUN_ID?.trim() || "";
  const expectedHead = process.env.GORIQ_RECOVERY_HEAD_SHA?.trim() || "";
  const workspace = resolve(process.env.GORIQ_RECOVERY_WORKSPACE?.trim() || process.cwd());
  const controlWorkspace = resolve(process.env.GORIQ_RECOVERY_CONTROL_WORKSPACE?.trim() || workspace);

  if (!repository || !token || !Number.isInteger(prNumber) || prNumber < 1 || !failedRunId || !expectedHead) {
    throw new Error("GORIQ recovery environment is incomplete");
  }
  if (existsSync(resolve(controlWorkspace, "AI_COMPANY_PAUSED"))) throw new Error("PAUSED");

  const { owner, repo } = parseRepository(repository);
  const pr = await githubJson<PullRequestInfo>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    token,
  );
  if (!isSameRepositoryOpenPullRequest(pr, repository)) throw new Error("PR_NOT_ELIGIBLE_FOR_AUTONOMOUS_RECOVERY");
  if (pr.head.sha !== expectedHead) throw new Error("PR_HEAD_MOVED_BEFORE_RECOVERY");

  const initialStatus = runRaw("git", ["status", "--porcelain"], workspace);
  if (initialStatus.trim()) throw new Error("RECOVERY_WORKSPACE_NOT_CLEAN");

  run("git", ["fetch", "origin", "main", pr.base.ref, pr.head.ref], workspace);
  const localHead = run("git", ["rev-parse", "HEAD"], workspace);
  if (localHead !== expectedHead) throw new Error("CHECKED_OUT_HEAD_MISMATCH");

  const recoveryMessages = run("git", ["log", "--format=%B%x1e", `origin/${pr.base.ref}..HEAD`], workspace)
    .split("\x1e")
    .map((message) => message.trim())
    .filter(Boolean);
  const history = parseRecoveryHistory(recoveryMessages);

  const prPaths = await pullRequestFiles(repository, prNumber, token);
  const allowed = allowedRepairPaths(prPaths);
  if (!allowed.length) throw new Error("NO_AUTONOMOUS_REPAIR_PATHS");

  const failureLog = await failedRunLog(repository, failedRunId, token);
  if (!failureLog.trim()) throw new Error("FAILED_RUN_LOG_UNAVAILABLE");
  const fingerprint = failureFingerprint(failureLog);
  const decision = chooseRecoveryStrategy(history, fingerprint);
  if (decision.action === "human-gate") {
    throw new Error(`AUTOMATIC_RECOVERY_STRATEGIES_EXHAUSTED: fingerprint=${fingerprint}; sameFailureOccurrences=${decision.sameFailureOccurrences}`);
  }

  const prompt = buildRecoveryPrompt({
    prNumber,
    strategy: decision.strategy,
    strategyAttempt: decision.strategyAttempt,
    totalAttempt: decision.totalAttempt,
    decisionReason: decision.reason,
    failureFingerprint: fingerprint,
    allowedPaths: allowed,
    failureLog,
  });

  const engine = resolveConfiguredEngine();
  runCodex(engine, workspace, prompt);

  const allowedSet = new Set(allowed);
  const statusAfterEngine = runRaw("git", ["status", "--porcelain"], workspace);
  const discardedUntracked = discardOutOfScopeUntracked(workspace, statusAfterEngine, allowedSet);
  let changedBeforeTrace = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
  restoreGeneratedWorkspaceNoise(workspace, changedBeforeTrace, allowedSet);
  changedBeforeTrace = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
  if (!changedBeforeTrace.length) throw new Error("RECOVERY_ENGINE_PRODUCED_NO_CHANGES");

  const nameStatus = run("git", ["diff", "--name-status", "--"], workspace);
  if (nameStatus.split(/\r?\n/).some((line) => /^(?:D|R\d*|C\d*)\t/.test(line))) {
    restoreWorkspace(workspace);
    throw new Error("RECOVERY_DESTRUCTIVE_CHANGE_REJECTED");
  }

  const unsafe = changedBeforeTrace.filter((path) => !allowedSet.has(path) || isTestPath(path));
  if (unsafe.length) {
    restoreWorkspace(workspace);
    throw new Error(`RECOVERY_SCOPE_VIOLATION: ${unsafe.join(",")}`);
  }

  const reconciled = autoReconcileTraceability(workspace, changedBeforeTrace, "low");
  let changed = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
  const allowedFinal = new Set([...allowed, ...reconciled]);
  restoreGeneratedWorkspaceNoise(workspace, changed, allowedFinal);
  changed = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
  const unsafeFinal = changed.filter((path) => !allowedFinal.has(path) || isTestPath(path));
  if (unsafeFinal.length) {
    restoreWorkspace(workspace);
    throw new Error(`RECOVERY_POST_RECONCILE_SCOPE_VIOLATION: ${unsafeFinal.join(",")}`);
  }

  let localVerificationAttempt = 1;
  const localVerificationFailures: Array<{ attempt: number; check: string; failure: string }> = [];
  let verification = verifyRecoveryCandidate(workspace);

  while (!verification.ok) {
    localVerificationFailures.push({
      attempt: localVerificationAttempt,
      check: verification.failedCheck,
      failure: verification.failure,
    });
    if (localVerificationAttempt >= MAX_LOCAL_VERIFICATION_ATTEMPTS) {
      throw new Error(
        `LOCAL_VERIFICATION_ATTEMPTS_EXHAUSTED: ${verification.failedCheck}: ${verification.failure}`,
      );
    }

    localVerificationAttempt += 1;
    const retryPrompt = buildVerificationRepairPrompt({
      prNumber,
      strategy: decision.strategy,
      localAttempt: localVerificationAttempt,
      allowedPaths: allowed,
      originalFailureFingerprint: fingerprint,
      verificationCheck: verification.failedCheck,
      verificationFailure: verification.failure,
    });
    runCodex(engine, workspace, retryPrompt);

    const retryStatus = runRaw("git", ["status", "--porcelain"], workspace);
    discardedUntracked.push(...discardOutOfScopeUntracked(workspace, retryStatus, allowedFinal));
    let retryChanged = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
    restoreGeneratedWorkspaceNoise(workspace, retryChanged, allowedFinal);
    retryChanged = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));

    const retryNameStatus = run("git", ["diff", "--name-status", "--"], workspace);
    if (retryNameStatus.split(/\r?\n/).some((line) => /^(?:D|R\d*|C\d*)\t/.test(line))) {
      restoreWorkspace(workspace);
      throw new Error("RECOVERY_DESTRUCTIVE_CHANGE_REJECTED");
    }

    const retryUnsafe = retryChanged.filter((path) => !allowedFinal.has(path) || isTestPath(path));
    if (retryUnsafe.length) {
      restoreWorkspace(workspace);
      throw new Error(`RECOVERY_LOCAL_RETRY_SCOPE_VIOLATION: ${retryUnsafe.join(",")}`);
    }

    const repairInputs = retryChanged.filter((path) => allowedSet.has(path));
    if (repairInputs.length) {
      const retryReconciled = autoReconcileTraceability(workspace, repairInputs, "low");
      for (const path of retryReconciled) allowedFinal.add(path);
    }

    const postRetryStatus = runRaw("git", ["status", "--porcelain"], workspace);
    discardedUntracked.push(...discardOutOfScopeUntracked(workspace, postRetryStatus, allowedFinal));
    let postRetryChanged = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
    restoreGeneratedWorkspaceNoise(workspace, postRetryChanged, allowedFinal);
    postRetryChanged = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
    const postRetryUnsafe = postRetryChanged.filter((path) => !allowedFinal.has(path) || isTestPath(path));
    if (postRetryUnsafe.length) {
      restoreWorkspace(workspace);
      throw new Error(`RECOVERY_LOCAL_RETRY_POST_RECONCILE_SCOPE_VIOLATION: ${postRetryUnsafe.join(",")}`);
    }

    verification = verifyRecoveryCandidate(workspace);
  }

  const statusAfterVerification = runRaw("git", ["status", "--porcelain"], workspace);
  discardedUntracked.push(...discardOutOfScopeUntracked(workspace, statusAfterVerification, allowedFinal));
  let postVerificationChanged = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
  restoreGeneratedWorkspaceNoise(workspace, postVerificationChanged, allowedFinal);
  postVerificationChanged = porcelainPaths(runRaw("git", ["status", "--porcelain"], workspace));
  const unsafeAfterVerification = postVerificationChanged.filter((path) => !allowedFinal.has(path) || isTestPath(path));
  if (unsafeAfterVerification.length) {
    restoreWorkspace(workspace);
    throw new Error(`RECOVERY_POST_VERIFY_SCOPE_VIOLATION: ${unsafeAfterVerification.join(",")}`);
  }
  changed = postVerificationChanged;
  if (!changed.length) throw new Error("RECOVERY_PATCH_EMPTY_AFTER_VERIFICATION");

  run("git", ["fetch", "origin", pr.head.ref], workspace);
  const remoteHead = run("git", ["rev-parse", `origin/${pr.head.ref}`], workspace);
  if (remoteHead !== expectedHead) {
    restoreWorkspace(workspace);
    throw new Error("PR_HEAD_MOVED_DURING_RECOVERY");
  }

  run("git", ["config", "user.name", "goriq-ci-recovery"], workspace);
  run("git", ["config", "user.email", "actions@users.noreply.github.com"], workspace);
  run("git", ["add", "--", ...changed], workspace);
  const staged = run("git", ["diff", "--cached", "--name-only"], workspace);
  if (!staged.trim()) throw new Error("RECOVERY_PATCH_EMPTY_AFTER_VERIFICATION");
  const recoveryCommitMessage = [
    `fix(ci): goriq recovery strategy ${decision.strategy} attempt ${decision.strategyAttempt}`,
    "",
    `GORIQ-Recovery-Strategy: ${decision.strategy}`,
    `GORIQ-Recovery-Strategy-Attempt: ${decision.strategyAttempt}`,
    `GORIQ-Recovery-Total-Attempt: ${decision.totalAttempt}`,
    `GORIQ-Recovery-Failure-Fingerprint: ${fingerprint}`,
    `GORIQ-Recovery-Decision: ${decision.reason}`,
  ].join("\n");
  run("git", ["commit", "-m", recoveryCommitMessage], workspace);
  pushWithGithubToken(workspace, pr.head.ref, token);

  const commit = run("git", ["rev-parse", "HEAD"], workspace);
  process.stdout.write(JSON.stringify({
    status: "FIXED",
    prNumber,
    strategy: decision.strategy,
    strategyAttempt: decision.strategyAttempt,
    totalAttempt: decision.totalAttempt,
    recoveryDecision: decision.reason,
    failureFingerprint: fingerprint,
    sameFailureOccurrences: decision.sameFailureOccurrences,
    discardedUntracked: [...new Set(discardedUntracked)].sort(),
    failedRunId,
    previousHead: expectedHead,
    commit,
    changed,
    checks: verification.checks,
    localVerificationAttempts: localVerificationAttempt,
    localVerificationFailures,
  }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`GORIQ_CI_RECOVERY_FAILED: ${message}\n`);
    process.exitCode = 1;
  });
}
