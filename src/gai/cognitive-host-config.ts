import { resolve } from "node:path";
import type { CognitiveRuntimeOptions } from "../orchestrator/compass-goal-execution-adapter.ts";

/** Host configuration only. HTTP and model proposals cannot expand this scope. */
export function cognitiveHostOptions(env: Record<string, string | undefined>): Pick<CognitiveRuntimeOptions, "localWork" | "localOutcomes" | "materialIntake" | "historyImport"> {
  const steps = env.GORIQ_LOCAL_WORK_MANIFEST?.trim();
  const outcomes = env.GORIQ_LOCAL_OUTCOMES?.trim();
  const intake = env.GORIQ_LOCAL_MATERIAL_INTAKE?.trim();
  const history = env.GORIQ_HISTORY_MANIFEST?.trim();
  const dataRoot = env.GORIQ_LOCAL_DATA_ROOT?.trim();
  if (intake && intake !== "1") throw Error("Invalid host material intake setting");
  if ([steps, outcomes, intake].filter(Boolean).length > 1) throw Error("Choose one local work contract");
  if (Boolean(steps || outcomes || intake || history) !== Boolean(dataRoot)) throw Error("Both local contract and isolated data root are required");
  if (!dataRoot) return {};
  const root = resolve(dataRoot);
  return { ...(steps ? { localWork: { manifestPath: resolve(steps), dataRoot: root } } : {}),
    ...(outcomes ? { localOutcomes: { manifestPath: resolve(outcomes), dataRoot: root } } : {}),
    ...(intake ? { materialIntake: { dataRoot: root } } : {}),
    ...(history ? { historyImport: { manifestPath: resolve(history), dataRoot: root } } : {}) };
}
