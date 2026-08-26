import type {
  ProviderContext,
  ProviderResult,
} from "../providers/provider.ts";
import type {
  ImageGenerationOutput,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "../providers/image-generation.ts";

export interface ImageGenerationService {
  generate(
    context: ProviderContext,
    request: ImageGenerationRequest,
  ): Promise<ProviderResult<ImageGenerationOutput>>;
}

export function createImageGenerationService(
  provider: ImageGenerationProvider,
): ImageGenerationService {
  return {
    generate(context, request) {
      return provider.execute(context, request);
    },
  };
}
