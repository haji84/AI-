import type { ImageMediaType } from "./image-generation.ts";
import type { Provider } from "./provider.ts";

export interface ImageEditingSource {
  readonly mediaType: ImageMediaType;
  readonly data: Uint8Array;
}

export interface ImageEditingRequest {
  readonly instruction: string;
  readonly source: ImageEditingSource;
}

export interface ImageEditingOutput {
  readonly mediaType: ImageMediaType;
  readonly data: Uint8Array;
}

export type ImageEditingContractErrorCode =
  | "INVALID_INSTRUCTION"
  | "EMPTY_SOURCE_IMAGE";

export interface ImageEditingContractError {
  readonly code: ImageEditingContractErrorCode;
  readonly message: string;
}

export type ImageEditingRequestResult =
  | { readonly ok: true; readonly value: ImageEditingRequest }
  | { readonly ok: false; readonly error: ImageEditingContractError };

export function createImageEditingRequest(
  instruction: string,
  source: ImageEditingSource,
): ImageEditingRequestResult {
  if (instruction.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_INSTRUCTION",
        message: "Image editing instruction must not be empty.",
      },
    };
  }

  if (source.data.byteLength === 0) {
    return {
      ok: false,
      error: {
        code: "EMPTY_SOURCE_IMAGE",
        message: "Image editing source image must not be empty.",
      },
    };
  }

  return { ok: true, value: { instruction, source } };
}

export type ImageEditingProvider = Provider<
  ImageEditingRequest,
  ImageEditingOutput
>;
