import assert from "node:assert/strict";
import test from "node:test";

import { createImageGenerationService } from "../src/application/image-generation-service.ts";
import type { ProviderContext } from "../src/providers/provider.ts";
import type { ImageGenerationProvider } from "../src/providers/image-generation.ts";

const context: ProviderContext = {
  jobId: "job-image-service-1",
  projectId: "project-1",
};

const request = { prompt: "A moonlit forest" } as const;

test("image generation service delegates context and request to the provider", async () => {
  const expected = {
    ok: true as const,
    value: {
      mediaType: "image/png" as const,
      data: new Uint8Array([1, 2, 3]),
    },
  };

  const provider: ImageGenerationProvider = {
    async execute(receivedContext, receivedRequest) {
      assert.deepEqual(receivedContext, context);
      assert.deepEqual(receivedRequest, request);
      return expected;
    },
  };

  const service = createImageGenerationService(provider);
  const result = await service.generate(context, request);

  assert.equal(result, expected);
});

test("image generation service preserves provider failures", async () => {
  const expected = {
    ok: false as const,
    error: {
      code: "PROVIDER_FAILURE" as const,
      message: "provider unavailable",
    },
  };

  const provider: ImageGenerationProvider = {
    async execute() {
      return expected;
    },
  };

  const service = createImageGenerationService(provider);
  const result = await service.generate(context, request);

  assert.equal(result, expected);
});
