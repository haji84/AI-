import assert from "node:assert/strict";
import test from "node:test";

import {
  createImageEditingRequest,
  type ImageEditingProvider,
} from "../src/providers/image-editing.ts";
import type { ProviderContext } from "../src/providers/provider.ts";

test("creates a minimal image editing request", () => {
  const source = {
    mediaType: "image/png" as const,
    data: new Uint8Array([1, 2, 3]),
  };

  const result = createImageEditingRequest("remove the background", source);

  assert.deepEqual(result, {
    ok: true,
    value: {
      instruction: "remove the background",
      source,
    },
  });
});

test("rejects an empty image editing instruction", () => {
  const result = createImageEditingRequest("   ", {
    mediaType: "image/jpeg",
    data: new Uint8Array([1]),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_INSTRUCTION");
  }
});

test("rejects an empty source image", () => {
  const result = createImageEditingRequest("increase contrast", {
    mediaType: "image/webp",
    data: new Uint8Array(),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "EMPTY_SOURCE_IMAGE");
  }
});

test("image editing provider preserves the generic provider boundary", async () => {
  const provider: ImageEditingProvider = {
    async execute(_context, input) {
      return {
        ok: true,
        value: {
          mediaType: input.source.mediaType,
          data: input.source.data,
        },
      };
    },
  };

  const context = {
    jobId: "job-1",
    projectId: "project-1",
  } as unknown as ProviderContext;

  const request = createImageEditingRequest("keep unchanged", {
    mediaType: "image/png",
    data: new Uint8Array([9]),
  });
  assert.equal(request.ok, true);
  if (!request.ok) return;

  const result = await provider.execute(context, request.value);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.mediaType, "image/png");
    assert.deepEqual(result.value.data, new Uint8Array([9]));
  }
});
