import type { ImageGenerationRequest } from "./image-generation.ts";
import type { ComfyUiWorkflow } from "./comfyui-image-generation-backend.ts";

export interface FluxSchnellComfyUiWorkflowOptions {
  readonly checkpoint: string;
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  readonly filenamePrefix?: string;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export function createFluxSchnellComfyUiWorkflow(
  options: FluxSchnellComfyUiWorkflowOptions,
): (request: ImageGenerationRequest) => ComfyUiWorkflow {
  const checkpoint = options.checkpoint.trim();
  if (checkpoint.length === 0) {
    throw new Error("FLUX schnell checkpoint must not be empty.");
  }

  const width = requirePositiveInteger(options.width ?? 1024, "FLUX schnell width");
  const height = requirePositiveInteger(options.height ?? 1024, "FLUX schnell height");
  const seed = options.seed ?? 0;
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("FLUX schnell seed must be a non-negative safe integer.");
  }

  const filenamePrefix = options.filenamePrefix?.trim() || "AI-Creator-Studio";

  return (request) => ({
    "30": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpoint },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: request.prompt, clip: ["30", 1] },
    },
    "33": {
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["30", 1] },
    },
    "27": {
      class_type: "EmptySD3LatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "31": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 4,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
        model: ["30", 0],
        positive: ["6", 0],
        negative: ["33", 0],
        latent_image: ["27", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["31", 0], vae: ["30", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { images: ["8", 0], filename_prefix: filenamePrefix },
    },
  });
}
