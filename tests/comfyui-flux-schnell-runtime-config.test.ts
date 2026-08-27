import assert from "node:assert/strict";
import test from "node:test";

import { parseComfyUiFluxSchnellRuntimeConfig } from "../src/providers/comfyui-flux-schnell-runtime-config.ts";

test("parses required local runtime values with deterministic defaults", () => {
  const config = parseComfyUiFluxSchnellRuntimeConfig({
    COMFYUI_BASE_URL: "http://127.0.0.1:8188/",
    FLUX_SCHNELL_CHECKPOINT: "flux1-schnell-fp8.safetensors",
  });

  assert.deepEqual(config, {
    baseUrl: "http://127.0.0.1:8188",
    checkpoint: "flux1-schnell-fp8.safetensors",
    prompt: "A small red fox in a quiet forest clearing",
    width: 1024,
    height: 1024,
    seed: 0,
    outputPath: "./tmp/flux-schnell-smoke.png",
    maxHistoryPolls: 120,
    pollDelayMs: 500,
  });
});

test("accepts explicit smoke-test overrides", () => {
  const config = parseComfyUiFluxSchnellRuntimeConfig({
    COMFYUI_BASE_URL: "http://localhost:8188",
    FLUX_SCHNELL_CHECKPOINT: "local.safetensors",
    FLUX_SCHNELL_PROMPT: "test prompt",
    FLUX_SCHNELL_WIDTH: "768",
    FLUX_SCHNELL_HEIGHT: "512",
    FLUX_SCHNELL_SEED: "42",
    FLUX_SCHNELL_OUTPUT: "./tmp/custom.webp",
    COMFYUI_MAX_HISTORY_POLLS: "10",
    COMFYUI_POLL_DELAY_MS: "25",
  });

  assert.equal(config.prompt, "test prompt");
  assert.equal(config.width, 768);
  assert.equal(config.height, 512);
  assert.equal(config.seed, 42);
  assert.equal(config.outputPath, "./tmp/custom.webp");
  assert.equal(config.maxHistoryPolls, 10);
  assert.equal(config.pollDelayMs, 25);
});

test("rejects missing required runtime values", () => {
  assert.throws(() => parseComfyUiFluxSchnellRuntimeConfig({}), /COMFYUI_BASE_URL is required/);
  assert.throws(
    () => parseComfyUiFluxSchnellRuntimeConfig({ COMFYUI_BASE_URL: "http://localhost:8188" }),
    /FLUX_SCHNELL_CHECKPOINT is required/,
  );
});

test("rejects invalid URL and numeric configuration", () => {
  assert.throws(
    () => parseComfyUiFluxSchnellRuntimeConfig({
      COMFYUI_BASE_URL: "file:///tmp/comfyui",
      FLUX_SCHNELL_CHECKPOINT: "model.safetensors",
    }),
    /must use http or https/,
  );
  assert.throws(
    () => parseComfyUiFluxSchnellRuntimeConfig({
      COMFYUI_BASE_URL: "http://localhost:8188",
      FLUX_SCHNELL_CHECKPOINT: "model.safetensors",
      FLUX_SCHNELL_WIDTH: "0",
    }),
    /FLUX_SCHNELL_WIDTH must be a positive integer/,
  );
  assert.throws(
    () => parseComfyUiFluxSchnellRuntimeConfig({
      COMFYUI_BASE_URL: "http://localhost:8188",
      FLUX_SCHNELL_CHECKPOINT: "model.safetensors",
      FLUX_SCHNELL_SEED: "-1",
    }),
    /FLUX_SCHNELL_SEED must be a non-negative safe integer/,
  );
});
