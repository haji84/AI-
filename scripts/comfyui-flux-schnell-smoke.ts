import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createComfyUiImageGenerationBackend } from "../src/providers/comfyui-image-generation-backend.ts";
import { parseComfyUiFluxSchnellRuntimeConfig } from "../src/providers/comfyui-flux-schnell-runtime-config.ts";
import { createFluxSchnellComfyUiWorkflow } from "../src/providers/flux-schnell-comfyui-workflow.ts";

async function main(): Promise<void> {
  const config = parseComfyUiFluxSchnellRuntimeConfig(process.env);
  const backend = createComfyUiImageGenerationBackend({
    baseUrl: config.baseUrl,
    createWorkflow: createFluxSchnellComfyUiWorkflow({
      checkpoint: config.checkpoint,
      width: config.width,
      height: config.height,
      seed: config.seed,
      filenamePrefix: "AI-Creator-Studio-Smoke",
    }),
    maxHistoryPolls: config.maxHistoryPolls,
    pollDelayMs: config.pollDelayMs,
  });

  const output = await backend.generate(
    { jobId: "local-smoke-job", projectId: "local-smoke-project" },
    { prompt: config.prompt },
  );

  await mkdir(dirname(config.outputPath), { recursive: true });
  await writeFile(config.outputPath, output.data);
  console.log(`ComfyUI FLUX schnell smoke test succeeded: ${config.outputPath} (${output.mediaType}, ${output.data.length} bytes)`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ComfyUI FLUX schnell smoke test failed: ${message}`);
  process.exitCode = 1;
});
