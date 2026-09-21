import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { ActionResult, ProposedAction } from "./goal-loop.ts";
import { createSafePrProposalCapability } from "./safe-pr-capability.ts";
import type { TaskCompletionAuthorization } from "./task-authorization.ts";

interface PromoteInput {
  title?: string;
  body?: string;
  taskAuthorization?: TaskCompletionAuthorization;
  taskScopeId?: string;
}

const ALLOWED_PREFIXES = ["src/", "tests/", "docs/", "scripts/"];
const FORBIDDEN = new Set(["AGENTS.md", "PROJECT_STATE.md", "ROADMAP.md", "package.json", "pnpm-lock.yaml"]);
const MAX_FILES = 3;
const MAX_BYTES = 100_000;

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).slice(-4000)}`);
  return result.stdout.trim();
}

function parseChangedFiles(status: string): string[] {
  const files = status
    .split(/\r?\n/)
    .filter((line) => line.length >= 4)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3).trim() }))
    .filter((entry) => entry.path.length > 0);

  for (const entry of files) {
    if (/D|R|C/.test(entry.code)) throw new Error(`unsupported local diff status ${entry.code.trim() || "??"} for ${entry.path}`);
    const normalized = entry.path.replaceAll("\\", "/");
    if (normalized.startsWith("../") || normalized.startsWith("/") || normalized.includes("/../")) {
      throw new Error(`unsafe changed path: ${entry.path}`);
    }
    if (FORBIDDEN.has(normalized) || normalized.startsWith(".github/") || !ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      throw new Error(`changed path is outside bounded autonomous scope: ${entry.path}`);
    }
  }

  const unique = [...new Set(files.map((entry) => entry.path.replaceAll("\\", "/")))];
  if (unique.length < 1) throw new Error("no local Builder changes are available for PR promotion");
  if (unique.length > MAX_FILES) throw new Error(`local Builder change set exceeds ${MAX_FILES} files`);
  return unique;
}

export function createRuntimeBuilderPrPromotionCapability(options: {
  cwd?: string;
  token?: string | null;
  repository?: string;
} = {}) {
  return {
    name: "repository.promote_builder_changes",
    async execute(action: ProposedAction): Promise<ActionResult> {
      try {
        const cwd = resolve(options.cwd ?? process.env.AUTONOMY_REPOSITORY_WORKSPACE?.trim() || process.cwd());
        const gitRoot = resolve(run("git", ["rev-parse", "--show-toplevel"], cwd));
        if (gitRoot !== cwd) {
          return {
            actionId: action.id,
            ok: false,
            summary: "Builder PR promotion requires execution at the repository root",
            blocker: "repository_workspace_mismatch",
            evidence: { cwd, gitRoot },
          };
        }

        const changedFiles = parseChangedFiles(run("git", ["status", "--porcelain"], cwd));
        let totalBytes = 0;
        const files = changedFiles.map((path) => {
          const content = readFileSync(resolve(cwd, path), "utf8");
          totalBytes += Buffer.byteLength(content, "utf8");
          return { path, content };
        });
        if (totalBytes > MAX_BYTES) throw new Error("local Builder change set exceeds maximum autonomous PR size");

        const input = (action.input ?? {}) as PromoteInput;
        const safePr = createSafePrProposalCapability({
          cwd,
          token: options.token ?? process.env.GITHUB_TOKEN ?? null,
          repository: options.repository ?? process.env.GITHUB_REPOSITORY ?? "",
        });

        const result = await safePr.execute({
          id: action.id,
          description: action.description,
          capability: "repository.propose_pr",
          risk: action.risk,
          irreversible: false,
          externalSideEffect: true,
          input: {
            title: input.title?.trim() || `JARVIS: ${action.description}`,
            body: input.body?.trim() || "Promoted from a verified local real-Builder change set.",
            files,
            taskAuthorization: input.taskAuthorization,
            taskScopeId: input.taskScopeId,
          },
        });

        return {
          ...result,
          actionId: action.id,
          evidence: {
            ...(result.evidence && typeof result.evidence === "object" ? result.evidence as Record<string, unknown> : {}),
            promotionSource: "real_builder_local_diff",
            promotedFiles: changedFiles,
          },
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return {
          actionId: action.id,
          ok: false,
          summary: `Builder PR promotion failed: ${message}`,
          blocker: "builder_pr_promotion_failed",
        };
      }
    },
  };
}
