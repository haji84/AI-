import { existsSync, readFileSync } from "node:fs";
import { join, win32, posix } from "node:path";
import { homedir } from "node:os";
import type { CapabilityHandler } from "./capabilities.ts";
import { BuilderRouter, type BuilderCapability } from "./builder-router.ts";
import { HttpWorkerBuilderCapability, createEnvHttpWorkerBuilders } from "../gai/http-worker-builder-capability.ts";

function localBuilderConfig(env: Record<string, string | undefined>): { url: string; token: string } | null {
  const explicitUrl = env.CODE_BUILDER_LOCAL_URL?.trim();
  const explicitToken = env.CODE_BUILDER_LOCAL_TOKEN?.trim();
  if (explicitUrl || explicitToken) {
    if (!explicitUrl || !explicitToken) {
      throw new Error("CODE_BUILDER_LOCAL_URL and CODE_BUILDER_LOCAL_TOKEN must be configured together");
    }
    return { url: explicitUrl, token: explicitToken };
  }

  let tokenPath: string | null = null;
  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) tokenPath = join(localAppData, "GAIWorker", "code-builder", "token.txt");
  } else if (process.platform === "darwin") {
    tokenPath = join(homedir(), "Library", "Application Support", "GAIWorker", "code-builder", "token.txt");
  }
  if (!tokenPath || !existsSync(tokenPath)) return null;
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!token) return null;
  return { url: "http://127.0.0.1:8796", token };
}

function assertLocalLoopback(urlString: string): void {
  const url = new URL(urlString);
  const loopback = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!loopback) throw new Error("Local code Builder must use loopback HTTP only");
}

/**
 * Plan-included Codex has a loopback TRANSPORT, but is not a device-local
 * inference model. It requires a separately scoped owner opt-in; merely
 * detecting an installed Codex CLI does not grant usage/billing authority.
 */
function planCodexBuilder(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
): BuilderCapability | null {
  const keys = [
    env.CODE_BUILDER_PLAN_CODEX_APPROVED?.trim(),
    env.CODE_BUILDER_PLAN_CODEX_URL?.trim(),
    env.CODE_BUILDER_PLAN_CODEX_TOKEN?.trim(),
    env.CODE_BUILDER_PLAN_CODEX_WORKSPACE?.trim(),
  ];
  if (keys.every((value) => !value)) return null;
  if (keys.some((value) => !value) || keys[0] !== "1") {
    throw new Error("Plan-included Codex Builder requires explicit owner approval, URL, token and pinned workspace");
  }
  const [, urlString, token, expectedWorkspace] = keys as [string, string, string, string];
  let url: URL;
  try { url = new URL(urlString); }
  catch { throw new Error("Plan-included Codex Builder URL must be exact loopback HTTP"); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
      url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("Plan-included Codex Builder URL must be exact loopback HTTP");
  }
  // The owner pins a real, non-root absolute worktree; never accept an
  // ambiguous relative path, traversal, root, or Windows UNC share.
  const actualHostPath = (value: string) => {
    const windowsPath = /^[a-zA-Z]:[\\/]/.test(value);
    const dialect = windowsPath ? win32 : posix;
    if (!value || [...value].some((ch) => ch.charCodeAt(0) < 32).test(value) ||
        value.split(/[\\/]/).includes("..") ||
        (!windowsPath && value.startsWith("//")) ||
        !dialect.isAbsolute(value)) {
      throw new Error("Plan-included Codex workspace must be an absolute non-root path");
    }
    const normalized = dialect.normalize(value);
    if (normalized === dialect.parse(normalized).root) {
      throw new Error("Plan-included Codex workspace must not be a filesystem root");
    }
    return windowsPath ? normalized.toLowerCase() : normalized;
  };
  const expectedPath = actualHostPath(expectedWorkspace);
  const delegate = new HttpWorkerBuilderCapability(
    "owner-plan-codex-builder", { url: url.origin, token }, fetchImpl, "external",
  );
  return {
    id: delegate.id,
    kind: "external",
    async available() {
      try {
        const response = await fetchImpl(`${url.origin}/health`, {
          headers: { Authorization: `Bearer ${token}` },
          // A dead or stalled Builder must never hang the Goal Controller.
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        });
        if (!response.ok) return false;
        const payload = await response.json() as {
          ok?: unknown; service?: unknown; engine?: unknown; workspace?: unknown;
          capabilities?: unknown;
        };
        return payload?.ok === true && payload.service === "code-builder-worker" &&
          payload.engine === "codex" &&
          Array.isArray(payload.capabilities) && payload.capabilities.includes("code-builder") &&
          typeof payload.workspace === "string" && actualHostPath(payload.workspace) === expectedPath;
      } catch {
        return false;
      }
    },
    build(request) { return delegate.build(request); },
  };
}

export function createRuntimeBuilderRouter(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): BuilderRouter {
  const builders: BuilderCapability[] = [...createEnvHttpWorkerBuilders(env)];
  const scopedCodex = planCodexBuilder(env, fetchImpl);
  if (scopedCodex) builders.unshift(scopedCodex);
  const local = localBuilderConfig(env);
  if (local) {
    assertLocalLoopback(local.url);
    builders.unshift(new HttpWorkerBuilderCapability("local-code-builder", local, fetchImpl, "local"));
  }
  return new BuilderRouter(builders);
}

export function createCodeBuilderCapability(router: BuilderRouter): CapabilityHandler {
  return {
    name: "code.builder",
    execute(action, context) {
      return router.execute(action, context);
    },
  };
}
