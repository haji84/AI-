import type { ImageGenerationService } from "../../../application/image-generation-service.ts";
import { createImageGenerationRequest } from "../../../providers/image-generation.ts";
import type { ProviderContext } from "../../../providers/provider.ts";

export interface ImageGenerationApiRequestBody {
  readonly jobId: string;
  readonly projectId: string;
  readonly prompt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value === value.trim()
  );
}

function invalidRequest(message: string): Response {
  return Response.json(
    { error: { code: "INVALID_REQUEST", message } },
    { status: 400 },
  );
}

export function createImageGenerationPostHandler(
  service: ImageGenerationService,
): (request: Request) => Promise<Response> {
  return async function POST(request) {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return invalidRequest("Request body must be valid JSON.");
    }

    if (!isRecord(body)) {
      return invalidRequest("Request body must be a JSON object.");
    }

    if (!isOpaqueId(body.jobId) || !isOpaqueId(body.projectId)) {
      return invalidRequest(
        "jobId and projectId must be non-empty opaque strings without surrounding whitespace.",
      );
    }

    if (typeof body.prompt !== "string") {
      return invalidRequest("prompt must be a string.");
    }

    const imageRequest = createImageGenerationRequest(body.prompt);
    if (!imageRequest.ok) {
      return Response.json({ error: imageRequest.error }, { status: 400 });
    }

    const context: ProviderContext = {
      jobId: body.jobId,
      projectId: body.projectId,
    };
    const result = await service.generate(context, imageRequest.value);

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 502 });
    }

    return Response.json({
      mediaType: result.value.mediaType,
      data: Array.from(result.value.data),
    });
  };
}
