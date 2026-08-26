import type { ProviderContext } from "../providers/provider.ts";
import {
  createImageGenerationRequest,
  type ImageGenerationOutput,
  type ImageGenerationProvider,
} from "../providers/image-generation.ts";

export type ImageGenerationServiceError =
  | { readonly code: "INVALID_REQUEST"; readonly message: string }
  | { readonly code: "PROVIDER_FAILURE"; readonly message: string };

export type ImageGenerationServiceResult =
  | { readonly ok: true; readonly value: ImageGenerationOutput }
  | { readonly ok: false; readonly error: ImageGenerationServiceError };

export interface ImageGenerationService {
  generate(
    context: ProviderContext,
    prompt: string,
  ): Promise<ImageGenerationServiceResult>;
}

export function createImageGenerationService(
  provider: ImageGenerationProvider,
): ImageGenerationService {
  return {
    async generate(context, prompt) {
      const request = createImageGenerationRequest(prompt);
      if (!request.ok) {
        return {
          ok: false,
          error: {
            code: "INVALID_REQUEST",
            message: request.error.message,
          },
        };
      }

      const result = await provider.execute(context, request.value);
      if (!result.ok) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message: result.error.message,
          },
        };
      }

      return result;
    },
  };
}
