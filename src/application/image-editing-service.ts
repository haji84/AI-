import type {
  ProviderContext,
  ProviderResult,
} from "../providers/provider.ts";
import type {
  ImageEditingOutput,
  ImageEditingProvider,
  ImageEditingRequest,
} from "../providers/image-editing.ts";

export interface ImageEditingService {
  edit(
    context: ProviderContext,
    request: ImageEditingRequest,
  ): Promise<ProviderResult<ImageEditingOutput>>;
}

export function createImageEditingService(
  provider: ImageEditingProvider,
): ImageEditingService {
  return {
    edit(context, request) {
      return provider.execute(context, request);
    },
  };
}
