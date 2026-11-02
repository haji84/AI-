import { isAbsolute, resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";

/**
 * Repository discovery for the resident Goal Executor.
 * An explicit Ollama Goal is bound to the owner's new isolated workspace and
 * a single pinned target, never to paths inferred from untrusted intake text.
 * Filesystem safety, clean detached worktree and HEAD are additionally enforced
 * by the Builder immediately before each attempted write.
 */
export function resolveResidentDevelopmentScope(
  env: Record<string, string | undefined>,
  processRoot: string,
  configuredFiles: string[],
  inferredFiles: string[],
): { repositoryRoot: string; targetFiles: string[]; localOnly: boolean; localOllama: boolean } {
  const optIn = env.GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED?.trim();
  if (optIn && optIn !== "1") throw new Error("Invalid resident local Ollama opt-in");

  if (optIn !== "1") return {
    repositoryRoot: resolve(processRoot),
    targetFiles: [...new Set([...configuredFiles, ...inferredFiles])],
    localOnly: env.GORIQ_SELF_DEVELOPMENT_LOCAL_ONLY === "1",
    localOllama: false,
  };

  const workspace = env.GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE?.trim();
  const paths = env.GORIQ_LOCAL_OLLAMA_ALLOWED_FILES?.split(",").map(p => p.trim()) ?? [];
  if (!workspace || !isAbsolute(workspace) || resolve(workspace) === resolve(processRoot)) {
    throw new Error("Local Ollama Goal must use a distinct absolute isolated workspace");
  }
  let sameRoot: boolean;
  try {
    const candidate = statSync(realpathSync(workspace), { bigint: true });
    const resident = statSync(realpathSync(processRoot), { bigint: true });
    if (!candidate.isDirectory() || !resident.isDirectory()) throw new Error("Directory required");
    sameRoot = candidate.dev === resident.dev && candidate.ino === resident.ino;
  } catch {
    throw new Error("Local Ollama Goal requires an existing isolated workspace and resident root");
  }
  if (sameRoot) throw new Error("Local Ollama Goal must use a distinct absolute isolated workspace");
  // The resident TDD host currently admits only one bounded file per Builder
  // call. It must not silently widen that scope using Goal text.
  if (paths.length !== 1 || !/^(?:src|scripts|tests|docs)\/[A-Za-z0-9_./-]+$/.test(paths[0])
    || paths[0].split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Resident local Ollama Goal requires exactly one safe pinned target file");
  }
  if (configuredFiles.length > 0 && (configuredFiles.length !== 1 || configuredFiles[0] !== paths[0])) {
    throw new Error("Resident local Ollama target conflicts with owner-pinned development scope");
  }
  if (!env.GAI_LOCAL_MODEL_NAME?.trim() || env.GORIQ_SELF_DEVELOPMENT_LOCAL_ONLY === "0") {
    throw new Error("Resident local Ollama requires a named model and local-only policy");
  }
  return { repositoryRoot: resolve(workspace), targetFiles: paths, localOnly: true, localOllama: true };
}
