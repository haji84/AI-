import type { ImageEditingOutput, ImageEditingRequest } from "./image-editing.ts";
import type { ImageMediaType } from "./image-generation.ts";
import type { LocalImageEditingBackend } from "./local-image-editing-adapter.ts";
import type { ProviderContext } from "./provider.ts";
import type { ComfyUiApiWorkflow } from "./qwen-image-edit-comfyui-workflow.ts";

export interface ComfyUiImageEditingBackendOptions {
  readonly baseUrl: string;
  readonly createWorkflow: (
    request: ImageEditingRequest,
    uploadedFilename: string,
  ) => ComfyUiApiWorkflow;
  readonly fetchImpl?: typeof fetch;
  readonly maxHistoryPolls?: number;
  readonly pollDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface ComfyUiImageReference {
  readonly filename: string;
  readonly subfolder?: string;
  readonly type?: string;
}

const SUPPORTED_MEDIA_TYPES = new Set<ImageMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireUploadedFilename(value: unknown): string {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("ComfyUI did not return an uploaded image name.");
  }
  return value.name;
}

function requirePromptId(value: unknown): string {
  if (!isRecord(value) || typeof value.prompt_id !== "string" || value.prompt_id.length === 0) {
    throw new Error("ComfyUI did not return a prompt_id.");
  }
  return value.prompt_id;
}

function findFirstImage(history: unknown, promptId: string): ComfyUiImageReference | null {
  if (!isRecord(history)) return null;
  const entry = history[promptId];
  if (!isRecord(entry) || !isRecord(entry.outputs)) return null;

  for (const output of Object.values(entry.outputs)) {
    if (!isRecord(output) || !Array.isArray(output.images)) continue;
    for (const image of output.images) {
      if (!isRecord(image) || typeof image.filename !== "string") continue;
      return {
        filename: image.filename,
        subfolder: typeof image.subfolder === "string" ? image.subfolder : undefined,
        type: typeof image.type === "string" ? image.type : undefined,
      };
    }
  }
  return null;
}

async function requireOk(response: Response, operation: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`ComfyUI ${operation} failed with HTTP ${response.status}.`);
  }
  return response;
}

function sourceFilename(context: ProviderContext, mediaType: ImageMediaType): string {
  const extension = mediaType === "image/png" ? "png" : mediaType === "image/jpeg" ? "jpg" : "webp";
  return `${String(context.jobId)}-source.${extension}`;
}

export function createComfyUiImageEditingBackend(
  options: ComfyUiImageEditingBackendOptions,
): LocalImageEditingBackend {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxHistoryPolls = options.maxHistoryPolls ?? 30;
  const pollDelayMs = options.pollDelayMs ?? 250;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  if (baseUrl.length === 0) throw new Error("ComfyUI baseUrl must not be empty.");
  if (!Number.isInteger(maxHistoryPolls) || maxHistoryPolls < 1) {
    throw new Error("ComfyUI maxHistoryPolls must be at least 1.");
  }

  return {
    async edit(context: ProviderContext, request: ImageEditingRequest): Promise<ImageEditingOutput> {
      const uploadBody = new FormData();
      uploadBody.append(
        "image",
        new Blob([request.source.data], { type: request.source.mediaType }),
        sourceFilename(context, request.source.mediaType),
      );
      uploadBody.append("type", "input");
      uploadBody.append("overwrite", "true");

      const uploadResponse = await requireOk(
        await fetchImpl(`${baseUrl}/upload/image`, {
          method: "POST",
          body: uploadBody,
        }),
        "image upload",
      );
      const uploadedFilename = requireUploadedFilename(await uploadResponse.json());
      const workflow = options.createWorkflow(request, uploadedFilename);

      const queuedResponse = await requireOk(
        await fetchImpl(`${baseUrl}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: workflow,
            client_id: String(context.jobId),
          }),
        }),
        "prompt submission",
      );
      const promptId = requirePromptId(await queuedResponse.json());

      let image: ComfyUiImageReference | null = null;
      for (let attempt = 0; attempt < maxHistoryPolls; attempt += 1) {
        const historyResponse = await requireOk(
          await fetchImpl(`${baseUrl}/history/${encodeURIComponent(promptId)}`),
          "history request",
        );
        image = findFirstImage(await historyResponse.json(), promptId);
        if (image) break;
        if (attempt + 1 < maxHistoryPolls) await sleep(pollDelayMs);
      }

      if (!image) throw new Error("ComfyUI editing did not produce an image before polling expired.");

      const params = new URLSearchParams({ filename: image.filename });
      if (image.subfolder) params.set("subfolder", image.subfolder);
      if (image.type) params.set("type", image.type);

      const imageResponse = await requireOk(
        await fetchImpl(`${baseUrl}/view?${params.toString()}`),
        "image download",
      );
      const mediaType = imageResponse.headers.get("content-type")?.split(";", 1)[0]?.trim() as ImageMediaType | undefined;
      if (!mediaType || !SUPPORTED_MEDIA_TYPES.has(mediaType)) {
        throw new Error("ComfyUI returned an unsupported image media type.");
      }

      return {
        mediaType,
        data: new Uint8Array(await imageResponse.arrayBuffer()),
      };
    },
  };
}
