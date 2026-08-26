import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalImageGenerationProvider,
  type LocalImageGenerationBackend,
} from "../src/providers/local-image-generation-adapter.ts";

test("local image generation provider forwards explicit context and request", async () => {
  let received: unknown;
  const backend: LocalImageGenerationBackend = {
    async generate(context, request) {
      received = { context, request };
      return {
        mediaType: "image/webp",
        data: new Uint8Array([4, 5, 6]),
      };
    },
  };
  const provider = createLocalImageGenerationProvider(backend);

  const result = await provider.execute(
    { jobId: "job-1", projectId: "project-1" },
    { prompt: "draw an island" },
  );

  assert.deepEqual(received, {
    context: { jobId: "job-1", projectId: "project-1" },
    request: { prompt: "draw an island" },
  });
  assert.deepEqual(result, {
    ok: true,
    value: {
      mediaType: "image/webp",
      data: new Uint8Array([4, 5, 6]),
    },
  });
});

test("local image generation provider maps backend errors to provider failure", async () => {
  const backend: LocalImageGenerationBackend = {
    async generate() {
      throw new Error("local runtime unavailable");
    },
  };
  const provider = createLocalImageGenerationProvider(backend);

  const result = await provider.execute(
    { jobId: "job-1", projectId: "project-1" },
    { prompt: "draw an island" },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "local runtime unavailable",
    },
  });
});

test("local image generation provider uses a deterministic fallback error message", async () => {
  const backend: LocalImageGenerationBackend = {
    async generate() {
      throw "failure";
    },
  };
  const provider = createLocalImageGenerationProvider(backend);

  const result = await provider.execute(
    { jobId: "job-1", projectId: "project-1" },
    { prompt: "draw an island" },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "Local image generation backend failed.",
    },
  });
});
