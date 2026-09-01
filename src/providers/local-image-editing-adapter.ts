import type {
  ImageEditingOutput,
  ImageEditingProvider,
  ImageEditingRequest,
} from "./image-editing.ts";
import type { ProviderContext } from "./provider.ts";

export interface LocalImageEditingBackend {
  edit(
    context: ProviderContext,
    request: ImageEditingRequest,
  ): Promise<ImageEditingOutput>;
}

export function createLocalImageEditingProvider(
  backend: LocalImageEditingBackend,
): ImageEditingProvider {
  return {
    async execute(context, input) {
      try {
        const value = await backend.edit(context, input);
        return { ok: true, value };
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Local image editing backend failed.";

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
