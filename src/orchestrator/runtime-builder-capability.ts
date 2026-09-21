import type { CapabilityHandler } from "./capabilities.ts";
import { BuilderRouter } from "./builder-router.ts";
import { HttpWorkerBuilderCapability, createEnvHttpWorkerBuilders } from "../gai/http-worker-builder-capability.ts";

export function createRuntimeBuilderRouter(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): BuilderRouter {
  const builders = [...createEnvHttpWorkerBuilders(env)];

  const localUrl = env.CODE_BUILDER_LOCAL_URL?.trim();
  const localToken = env.CODE_BUILDER_LOCAL_TOKEN?.trim();
  if (localUrl || localToken) {
    if (!localUrl || !localToken) {
      throw new Error("CODE_BUILDER_LOCAL_URL and CODE_BUILDER_LOCAL_TOKEN must be configured together");
    }
    const url = new URL(localUrl);
    const loopback = url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (!loopback) {
      throw new Error("Local code Builder must use loopback HTTP only");
    }
    builders.unshift(new HttpWorkerBuilderCapability("local-code-builder", { url: localUrl, token: localToken }, fetchImpl));
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
