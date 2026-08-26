import assert from "node:assert/strict";
import test from "node:test";

import {
  createImageGenerationPostHandler,
} from "../src/app/api/image-generation/handler.ts";
import type { ImageGenerationService } from "../src/application/image-generation-service.ts";

test("image generation API rejects malformed JSON", async () => {
  const service: ImageGenerationService = {
    async generate() {
      throw new Error("service must not be called");
    },
  };
  const POST = createImageGenerationPostHandler(service);

  const response = await POST(
    new Request("http://localhost/api/image-generation", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INVALID_REQUEST",
      message: "Request body must be valid JSON.",
    },
  });
});

test("image generation API rejects an empty prompt", async () => {
  const service: ImageGenerationService = {
    async generate() {
      throw new Error("service must not be called");
    },
  };
  const POST = createImageGenerationPostHandler(service);

  const response = await POST(
    new Request("http://localhost/api/image-generation", {
      method: "POST",
      body: JSON.stringify({
        jobId: "job-1",
        projectId: "project-1",
        prompt: "   ",
      }),
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INVALID_PROMPT",
      message: "Image generation prompt must not be empty.",
    },
  });
});

test("image generation API delegates explicit context and returns JSON output", async () => {
  let received: unknown;
  const service: ImageGenerationService = {
    async generate(context, request) {
      received = { context, request };
      return {
        ok: true,
        value: {
          mediaType: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
      };
    },
  };
  const POST = createImageGenerationPostHandler(service);

  const response = await POST(
    new Request("http://localhost/api/image-generation", {
      method: "POST",
      body: JSON.stringify({
        jobId: "job-1",
        projectId: "project-1",
        prompt: "draw a lighthouse",
      }),
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    context: { jobId: "job-1", projectId: "project-1" },
    request: { prompt: "draw a lighthouse" },
  });
  assert.deepEqual(await response.json(), {
    mediaType: "image/png",
    data: [1, 2, 3],
  });
});

test("image generation API maps provider failure to bad gateway", async () => {
  const service: ImageGenerationService = {
    async generate() {
      return {
        ok: false,
        error: {
          code: "PROVIDER_FAILURE",
          message: "provider unavailable",
        },
      };
    },
  };
  const POST = createImageGenerationPostHandler(service);

  const response = await POST(
    new Request("http://localhost/api/image-generation", {
      method: "POST",
      body: JSON.stringify({
        jobId: "job-1",
        projectId: "project-1",
        prompt: "draw a lighthouse",
      }),
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: {
      code: "PROVIDER_FAILURE",
      message: "provider unavailable",
    },
  });
});
