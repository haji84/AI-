import type { Provider } from "./provider.ts";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageGenerationRequest {
  readonly prompt: string;
}

export interface ImageGenerationOutput {
  readonly mediaType: ImageMediaType;
  readonly data: Uint8Array;
}

export type ImageGenerationContractErrorCode = "INVALID_PROMPT";

export interface ImageGenerationContractError {
  readonly code: ImageGenerationContractErrorCode;
  readonly message: string;
}

export type ImageGenerationRequestResult =
  | { readonly ok: true; readonly value: ImageGenerationRequest }
  | { readonly ok: false; readonly error: ImageGenerationContractError };

export function createImageGenerationRequest(
  prompt: string,
): ImageGenerationRequestResult {
  if (prompt.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_PROMPT",
        message: "Image generation prompt must not be empty.",
      },
    };
  }

  return { ok: true, value: { prompt } };
}

export type ImageGenerationProvider = Provider<
  ImageGenerationRequest,
  ImageGenerationOutput
>;
