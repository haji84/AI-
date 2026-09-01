import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalImageEditingProvider,
  type LocalImageEditingBackend,
} from "../src/providers/local-image-editing-adapter.ts";
import type { ProviderContext } from "../src/providers/provider.ts";

const context: ProviderContext = {
  jobId: "job-local-image-edit-1",
  projectId: "project-1",
};

const request = {
  instruction: "Change the sky to sunset",
  source: {
    mediaType: "image/png" as const,
    data: new Uint8Array([1, 2, 3]),
  },
};

test("local image editing provider delegates to backend", async () => {
  const expected = {
    mediaType: "image/png" as const,
    data: new Uint8Array([4, 5, 6]),
  };

  const backend: LocalImageEditingBackend = {
    async edit(receivedContext, receivedRequest) {
      assert.deepEqual(receivedContext, context);
      assert.deepEqual(receivedRequest, request);
      return expected;
    },
  };

  const provider = createLocalImageEditingProvider(backend);
  const result = await provider.execute(context, request);

  assert.deepEqual(result, { ok: true, value: expected });
});

test("local image editing provider maps backend errors to provider failure", async () => {
  const backend: LocalImageEditingBackend = {
    async edit() {
      throw new Error("ComfyUI unavailable");
    },
  };

  const provider = createLocalImageEditingProvider(backend);
  const result = await provider.execute(context, request);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "ComfyUI unavailable",
    },
  });
});

test("local image editing provider uses a stable fallback error message", async () => {
  const backend: LocalImageEditingBackend = {
    async edit() {
      throw "failure";
    },
  };

  const provider = createLocalImageEditingProvider(backend);
  const result = await provider.execute(context, request);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "Local image editing backend failed.",
    },
  });
});
