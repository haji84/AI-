import type {
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "./image-generation.ts";
import type { ProviderContext } from "./provider.ts";

export interface LocalImageGenerationBackend {
  generate(
    context: ProviderContext,
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationOutput>;
}

export function createLocalImageGenerationProvider(
  backend: LocalImageGenerationBackend,
): ImageGenerationProvider {
  return {
    async execute(context, input) {
      try {
        const value = await backend.generate(context, input);
        return { ok: true, value };
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Local image generation backend failed.";

        return {
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message,
          },
        };
      }
    },
  };
}
