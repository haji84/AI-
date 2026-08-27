export interface ComfyUiFluxSchnellRuntimeConfig {
  readonly baseUrl: string;
  readonly checkpoint: string;
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly outputPath: string;
  readonly maxHistoryPolls: number;
  readonly pollDelayMs: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function nonNegativeSafeInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative safe integer.`);
  return parsed;
}

export function parseComfyUiFluxSchnellRuntimeConfig(
  env: NodeJS.ProcessEnv,
): ComfyUiFluxSchnellRuntimeConfig {
  const baseUrl = required(env, "COMFYUI_BASE_URL").replace(/\/+$/, "");
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("COMFYUI_BASE_URL must use http or https.");
  }

  const checkpoint = required(env, "FLUX_SCHNELL_CHECKPOINT");
  const prompt = env.FLUX_SCHNELL_PROMPT?.trim() || "A small red fox in a quiet forest clearing";
  const outputPath = env.FLUX_SCHNELL_OUTPUT?.trim() || "./tmp/flux-schnell-smoke.png";

  return {
    baseUrl,
    checkpoint,
    prompt,
    width: positiveInteger(env.FLUX_SCHNELL_WIDTH, 1024, "FLUX_SCHNELL_WIDTH"),
    height: positiveInteger(env.FLUX_SCHNELL_HEIGHT, 1024, "FLUX_SCHNELL_HEIGHT"),
    seed: nonNegativeSafeInteger(env.FLUX_SCHNELL_SEED, 0, "FLUX_SCHNELL_SEED"),
    outputPath,
    maxHistoryPolls: positiveInteger(env.COMFYUI_MAX_HISTORY_POLLS, 120, "COMFYUI_MAX_HISTORY_POLLS"),
    pollDelayMs: positiveInteger(env.COMFYUI_POLL_DELAY_MS, 500, "COMFYUI_POLL_DELAY_MS"),
  };
}
