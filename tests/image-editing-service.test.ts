import assert from "node:assert/strict";
import test from "node:test";

import { createImageEditingService } from "../src/application/image-editing-service.ts";
import type { ImageEditingProvider } from "../src/providers/image-editing.ts";
import type { ProviderContext } from "../src/providers/provider.ts";

const context: ProviderContext = {
  jobId: "job-image-edit-service-1",
  projectId: "project-1",
};

const request = {
  instruction: "Make the sky warmer",
  source: {
    mediaType: "image/png" as const,
    data: new Uint8Array([1, 2, 3]),
  },
};

test("image editing service delegates context and request to the provider", async () => {
  const expected = {
    ok: true as const,
    value: {
      mediaType: "image/png" as const,
      data: new Uint8Array([4, 5, 6]),
    },
  };

  const provider: ImageEditingProvider = {
    async execute(receivedContext, receivedRequest) {
      assert.deepEqual(receivedContext, context);
      assert.deepEqual(receivedRequest, request);
      return expected;
    },
  };

  const service = createImageEditingService(provider);
  const result = await service.edit(context, request);

  assert.equal(result, expected);
});

test("image editing service preserves provider failures", async () => {
  const expected = {
    ok: false as const,
    error: {
      code: "PROVIDER_FAILURE" as const,
      message: "provider unavailable",
    },
  };

  const provider: ImageEditingProvider = {
    async execute() {
      return expected;
    },
  };

  const service = createImageEditingService(provider);
  const result = await service.edit(context, request);

  assert.equal(result, expected);
});
