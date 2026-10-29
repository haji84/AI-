/** Codex-free, opt-in development Builder. Never commits, publishes or edits an existing file. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { LocalDevelopmentBuilder } from "./local-development-builder.ts";
import type { BuilderCapability, BuilderRequest } from "./builder-router.ts";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 8000, windowsHide: true }).trim();
const validPath = (p: string) => /^(?:src|scripts|tests|docs)\/[a-zA-Z0-9_./-]+$/.test(p)
  && !p.split("/").some(v => v === "." || v === ".." || v === "") && !p.includes("//");

export interface LocalOllamaBuilderOptions {
  workspace: string;
  model: string;
  allowedPaths: string[];
  /** Explicitly approved, already installed loopback-only alternatives; no model pulling. */
  fallbackModels?: string[];
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

function isolatedWorkspace(workspace: string): string {
  if (!isAbsolute(workspace) || !existsSync(workspace)) throw new Error("Ollama Builder requires an existing absolute workspace");
  const root = realpathSync(workspace);
  if (git(root, "rev-parse", "--show-toplevel").replaceAll("\\", "/").toLowerCase() !== root.replaceAll("\\", "/").toLowerCase()) {
    throw new Error("Ollama Builder workspace must be the exact Git worktree root");
  }
  // A linked worktree has a .git FILE. A primary/main checkout has a .git DIRECTORY.
  if (!lstatSync(resolve(root, ".git")).isFile() || git(root, "branch", "--show-current") !== "") {
    throw new Error("Ollama Builder requires a detached linked worktree; main is prohibited");
  }
  return root;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Local Ollama HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 64_000) throw new Error("Local Ollama response exceeded limit");
  return JSON.parse(text) as unknown;
}

export function createLocalOllamaBuilder(input: LocalOllamaBuilderOptions): BuilderCapability {
  const workspace = isolatedWorkspace(input.workspace);
  const configuredModel = input.model.trim();
  if (!configuredModel || configuredModel.length > 128) throw new Error("Ollama model is required");
  const fallbackModels = input.fallbackModels ?? [];
  if (!Array.isArray(fallbackModels) || fallbackModels.length > 3 ||
      fallbackModels.some(m => typeof m !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(m)) ||
      new Set([configuredModel, ...fallbackModels]).size !== fallbackModels.length + 1) {
    throw new Error("Local Ollama fallback models must be up to three distinct explicit model names");
  }
  const candidates = [configuredModel, ...fallbackModels];
  const url = new URL(input.endpoint || "http://127.0.0.1:11434");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Local Ollama must use the exact 127.0.0.1 loopback origin");
  }
  if (!Array.isArray(input.allowedPaths) || input.allowedPaths.length === 0 || input.allowedPaths.length > 32
    || input.allowedPaths.some(p => !validPath(p)) || new Set(input.allowedPaths).size !== input.allowedPaths.length) {
    throw new Error("Ollama Builder requires explicit distinct relative allowlisted paths");
  }
  const allow = new Set(input.allowedPaths);
  const fetchImpl = input.fetchImpl || fetch;
  let selectedModel: string | null = null;

  const available = async () => {
    try {
      const reply = await fetchImpl(`${url.origin}/api/tags`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(5000) });
      const listing = await boundedJson(reply) as { models?: Array<{ name?: string; model?: string }> };
      selectedModel = Array.isArray(listing.models) ?
        (candidates.find(candidate => listing.models!.some(m => m.name === candidate || m.model === candidate)) ?? null) : null;
      return selectedModel !== null;
    } catch { selectedModel = null; return false; }
  };

  return new LocalDevelopmentBuilder({
    id: "local-ollama-builder", workspaceRoot: workspace, available,
    async run(request: BuilderRequest) {
      const activeModel = selectedModel;
      if (!activeModel) return { ok: false, summary: "Installed Ollama model not verified", blocker: "local_model_unavailable" };
      if (request.tddPhase === "red") return { ok: false, summary: "Independent failing test is required before TDD red evidence", blocker: "local_model_tdd_red_unproven" };
      if (!request.localOnly || !request.baseRevision || !/^[a-f0-9]{40}$/.test(request.baseRevision)
        || !Array.isArray(request.files) || request.files.length !== 1 || !allow.has(request.files[0])) {
        return { ok: false, summary: "Local model task scope is incomplete", blocker: "local_model_scope_unverified" };
      }
      const path = request.files[0];
      const target = resolve(workspace, path);
      const parent = realpathSync(dirname(target));
      if (!validPath(path) || relative(workspace, target).startsWith("..") || relative(workspace, target).startsWith(sep)
        || relative(workspace, parent).startsWith("..") || relative(workspace, parent).startsWith(sep)
        || existsSync(target)) {
        return { ok: false, summary: "Target must be a new scoped file with an existing safe parent", blocker: "local_model_target_unsafe" };
      }
      if (git(workspace, "rev-parse", "HEAD") !== request.baseRevision || git(workspace, "status", "--porcelain", "-uall") !== "") {
        return { ok: false, summary: "Isolated workspace is dirty or its revision changed", blocker: "local_model_workspace_not_clean" };
      }
      const prompt = `You are a local code-writing capability. Return one JSON object only with keys path and content. Path must be ${path}. Implement this bounded objective without other changes: ${request.objective.slice(0,3500)}. No credentials, permissions, commits or publishing.`;
      const answer = await boundedJson(await fetchImpl(`${url.origin}/api/generate`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000), headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: activeModel, stream: false, think: false, keep_alive: "0s",
          format: { type: "object", properties: { path: { const: path }, content: { type: "string", minLength: 1, maxLength: 8192 } },
            required: ["path", "content"], additionalProperties: false },
          options: { temperature: 0, num_predict: 2048 }, prompt }),
      })) as { response?: unknown; done?: unknown; model?: unknown };
      if (answer.done !== true || answer.model !== activeModel || typeof answer.response !== "string" || answer.response.length > 16384) {
        return { ok: false, summary: "Ollama generation did not complete within bounds", blocker: "local_model_generation_incomplete" };
      }
      const proposal = JSON.parse(answer.response) as Record<string, unknown>;
      if (!proposal || Array.isArray(proposal) || Object.keys(proposal).sort().join(",") !== "content,path"
        || proposal.path !== path || typeof proposal.content !== "string" || !proposal.content || Buffer.byteLength(proposal.content, "utf8") > 8192) {
        return { ok: false, summary: "Ollama output violated the scoped edit schema", blocker: "local_model_proposal_rejected" };
      }
      // Optimistic pre-write fence. No overwrite, no use of Codex, and no Git mutation.
      if (git(workspace, "rev-parse", "HEAD") !== request.baseRevision || git(workspace, "status", "--porcelain", "-uall") !== "") {
        return { ok: false, summary: "Workspace changed during inference", blocker: "local_model_workspace_changed" };
      }
      const content = proposal.content.endsWith("\n") ? proposal.content : `${proposal.content}\n`;
      writeFileSync(target, content, { flag: "wx" });
      const changed = git(workspace, "status", "--porcelain", "-uall");
      const actual = readFileSync(target);
      if (changed !== `?? ${path}` || actual.toString("utf8") !== content) {
        return { ok: false, summary: "Output verification or workspace isolation failed", blocker: "local_model_postwrite_unverified" };
      }
      const patchDigest = sha256(`create\0${path}\0${content}`);
      const artifactDigest = sha256(actual);
      return { ok: true, summary: "Local Ollama generated one bounded new file; independent verification still required",
        changedPaths: [path], patchDigest, artifactDigest, artifactRef: `sha256:${artifactDigest}`,
        evidence: { model: activeModel, inferenceLocality: "device", externalApiCalls: 0, releaseAuthorized: false } };
    },
  });
}

export function configuredLocalOllamaBuilder(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): BuilderCapability | null {
  const enabled = env.GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED?.trim();
  if (!enabled) return null;
  if (enabled !== "1") throw new Error("Local Ollama Builder opt-in is invalid");
  if (!env.GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE || !env.GAI_LOCAL_MODEL_NAME || !env.GORIQ_LOCAL_OLLAMA_ALLOWED_FILES) {
    throw new Error("Local Ollama requires pinned worktree, model, and explicit file allowlist");
  }
  return createLocalOllamaBuilder({ workspace: env.GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE,
    model: env.GAI_LOCAL_MODEL_NAME, allowedPaths: env.GORIQ_LOCAL_OLLAMA_ALLOWED_FILES.split(","),
    fallbackModels: env.GORIQ_LOCAL_OLLAMA_FALLBACK_MODELS ? env.GORIQ_LOCAL_OLLAMA_FALLBACK_MODELS.split(",") : [],
    endpoint: env.GAI_LOCAL_MODEL_ENDPOINT, fetchImpl });
}
