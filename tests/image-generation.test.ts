import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderContext } from "../src/providers/provider.ts";
import {
  createImageGenerationRequest,
  type ImageGenerationProvider,
} from "../src/providers/image-generation.ts";

const context: ProviderContext = {
  jobId: "job-image-1",
  projectId: "project-1",
};

test("image generation request accepts a non-empty provider-independent prompt", () => {
  assert.deepEqual(createImageGenerationRequest("A moonlit forest"), {
    ok: true,
    value: { prompt: "A moonlit forest" },
  });
});

test("image generation request rejects an empty or whitespace-only prompt", () => {
  assert.deepEqual(createImageGenerationRequest("   "), {
    ok: false,
    error: {
      code: "INVALID_PROMPT",
      message: "Image generation prompt must not be empty.",
    },
  });
});

test("image generation contract composes with the generic Provider boundary", async () => {
  const provider: ImageGenerationProvider = {
    async execute(_providerContext, input) {
      assert.equal(input.prompt, "A moonlit forest");
      return {
        ok: true,
        value: {
          mediaType: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
      };
    },
  };

  const result = await provider.execute(context, {
    prompt: "A moonlit forest",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.mediaType, "image/png");
    assert.deepEqual([...result.value.data], [1, 2, 3]);
  }
});
