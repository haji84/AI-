import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CapabilityHandler } from "./capabilities.ts";
import { BuilderRouter } from "./builder-router.ts";
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

export function createRuntimeBuilderRouter(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): BuilderRouter {
  const builders = [...createEnvHttpWorkerBuilders(env)];
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
