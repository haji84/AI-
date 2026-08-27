import assert from "node:assert/strict";
import test from "node:test";

import { createFluxSchnellComfyUiWorkflow } from "../src/providers/flux-schnell-comfyui-workflow.ts";

test("builds the minimal FLUX schnell ComfyUI API workflow", () => {
  const createWorkflow = createFluxSchnellComfyUiWorkflow({
    checkpoint: "flux1-schnell-fp8.safetensors",
    width: 768,
    height: 1024,
    seed: 42,
    filenamePrefix: "phase-2",
  });

  const workflow = createWorkflow({ prompt: "draw an island at night" }) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >;

  assert.deepEqual(workflow["30"], {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "flux1-schnell-fp8.safetensors" },
  });
  assert.equal(workflow["6"].inputs.text, "draw an island at night");
  assert.deepEqual(workflow["27"].inputs, { width: 768, height: 1024, batch_size: 1 });
  assert.deepEqual(workflow["31"].inputs, {
    seed: 42,
    steps: 4,
    cfg: 1,
    sampler_name: "euler",
    scheduler: "simple",
    denoise: 1,
    model: ["30", 0],
    positive: ["6", 0],
    negative: ["33", 0],
    latent_image: ["27", 0],
  });
  assert.deepEqual(workflow["9"].inputs, {
    images: ["8", 0],
    filename_prefix: "phase-2",
  });
});

test("uses deterministic FLUX schnell defaults", () => {
  const workflow = createFluxSchnellComfyUiWorkflow({ checkpoint: "flux.safetensors" })(
    { prompt: "test" },
  ) as Record<string, { inputs: Record<string, unknown> }>;

  assert.deepEqual(workflow["27"].inputs, { width: 1024, height: 1024, batch_size: 1 });
  assert.equal(workflow["31"].inputs.seed, 0);
  assert.equal(workflow["31"].inputs.steps, 4);
  assert.equal(workflow["31"].inputs.cfg, 1);
  assert.equal(workflow["31"].inputs.sampler_name, "euler");
  assert.equal(workflow["31"].inputs.scheduler, "simple");
});

test("rejects missing checkpoint and invalid dimensions or seed", () => {
  assert.throws(
    () => createFluxSchnellComfyUiWorkflow({ checkpoint: "   " }),
    /checkpoint must not be empty/,
  );
  assert.throws(
    () => createFluxSchnellComfyUiWorkflow({ checkpoint: "x", width: 0 }),
    /width must be a positive integer/,
  );
  assert.throws(
    () => createFluxSchnellComfyUiWorkflow({ checkpoint: "x", height: 1.5 }),
    /height must be a positive integer/,
  );
  assert.throws(
    () => createFluxSchnellComfyUiWorkflow({ checkpoint: "x", seed: -1 }),
    /seed must be a non-negative safe integer/,
  );
});
