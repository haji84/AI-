import { resolve } from "node:path";
import type { CognitiveRuntimeOptions } from "../orchestrator/compass-goal-execution-adapter.ts";

/** Host configuration only. HTTP and model proposals cannot expand this scope. */
export function cognitiveHostOptions(env: Record<string, string | undefined>): Pick<CognitiveRuntimeOptions, "localWork" | "localOutcomes"> {
  const steps = env.GORIQ_LOCAL_WORK_MANIFEST?.trim();
  const outcomes = env.GORIQ_LOCAL_OUTCOMES?.trim();
  const dataRoot = env.GORIQ_LOCAL_DATA_ROOT?.trim();
  if (steps && outcomes) throw Error("Choose one local work contract");
  if (Boolean(steps || outcomes) !== Boolean(dataRoot)) throw Error("Both local contract and isolated data root are required");
  if (!dataRoot) return {};
  const config = { manifestPath: resolve((steps || outcomes)!), dataRoot: resolve(dataRoot) };
  return outcomes ? { localOutcomes: config } : { localWork: config };
}
