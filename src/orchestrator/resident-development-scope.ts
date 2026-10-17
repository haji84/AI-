import { isAbsolute, resolve } from "node:path";
import { localOllamaFixtureSourcePath, localOllamaFixtureTestPath } from "./local-ollama-tdd.ts";

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
  // Only the special bounded fixture may add a second path for its trusted
  // RED test. All other Goals retain the original exact one-file contract.
  const profile = env.GORIQ_LOCAL_OLLAMA_TDD_PROFILE?.trim();
  if (profile && profile !== "python_add_v1") throw new Error("Unsupported local Ollama TDD profile");
  const fixture = profile === "python_add_v1";
  const target = fixture ? localOllamaFixtureSourcePath : paths[0];
  if (fixture && (paths.length !== 2 || !paths.includes(localOllamaFixtureSourcePath) ||
      !paths.includes(localOllamaFixtureTestPath))) {
    throw new Error("TDD Goal requires exactly two known fixture paths");
  }
  if (!fixture && (paths.length !== 1 || !/^(?:src|scripts|tests|docs)\/[A-Za-z0-9_./-]+$/.test(paths[0])
    || paths[0].split("/").some(part => !part || part === "." || part === ".."))) {
    throw new Error("Resident local Ollama Goal requires exactly one safe pinned target file");
  }
  if (configuredFiles.length > 0 && (configuredFiles.length !== 1 || configuredFiles[0] !== target)) {
    throw new Error("Resident local Ollama target conflicts with owner-pinned development scope");
  }
  if (!env.GAI_LOCAL_MODEL_NAME?.trim() || env.GORIQ_SELF_DEVELOPMENT_LOCAL_ONLY === "0") {
    throw new Error("Resident local Ollama requires a named model and local-only policy");
  }
  return { repositoryRoot: resolve(workspace), targetFiles: [target], localOnly: true, localOllama: true };
}
