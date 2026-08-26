import assert from "node:assert/strict";
import test from "node:test";

import { createComfyUiImageGenerationBackend } from "../src/providers/comfyui-image-generation-backend.ts";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("ComfyUI backend queues injected workflow and downloads the first generated image", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    jsonResponse({ prompt_id: "prompt-1" }),
    jsonResponse({ "prompt-1": { outputs: {} } }),
    jsonResponse({
      "prompt-1": {
        outputs: {
          "9": {
            images: [{ filename: "result.webp", subfolder: "", type: "output" }],
          },
        },
      },
    }),
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/webp" },
    }),
  ];
  const sleeps: number[] = [];
  const backend = createComfyUiImageGenerationBackend({
    baseUrl: "http://127.0.0.1:8188/",
    createWorkflow(request) {
      return { node: { prompt: request.prompt } };
    },
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    maxHistoryPolls: 3,
    pollDelayMs: 5,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });

  const result = await backend.generate(
    { jobId: "job-42", projectId: "project-1" },
    { prompt: "draw an island" },
  );

  assert.deepEqual(result, {
    mediaType: "image/webp",
    data: new Uint8Array([1, 2, 3]),
  });
  assert.deepEqual(sleeps, [5]);
  assert.equal(calls[0]?.url, "http://127.0.0.1:8188/prompt");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    prompt: { node: { prompt: "draw an island" } },
    client_id: "job-42",
  });
  assert.equal(calls[1]?.url, "http://127.0.0.1:8188/history/prompt-1");
  assert.equal(calls[2]?.url, "http://127.0.0.1:8188/history/prompt-1");
  assert.equal(
    calls[3]?.url,
    "http://127.0.0.1:8188/view?filename=result.webp&type=output",
  );
});

test("ComfyUI backend rejects failed prompt submission", async () => {
  const backend = createComfyUiImageGenerationBackend({
    baseUrl: "http://127.0.0.1:8188",
    createWorkflow: () => ({}),
    fetchImpl: async () => new Response("bad request", { status: 400 }),
  });

  await assert.rejects(
    backend.generate(
      { jobId: "job-1", projectId: "project-1" },
      { prompt: "draw an island" },
    ),
    /prompt submission failed with HTTP 400/,
  );
});

test("ComfyUI backend rejects history polling that never produces an image", async () => {
  let call = 0;
  const backend = createComfyUiImageGenerationBackend({
    baseUrl: "http://127.0.0.1:8188",
    createWorkflow: () => ({}),
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return jsonResponse({ prompt_id: "prompt-1" });
      return jsonResponse({ "prompt-1": { outputs: {} } });
    },
    maxHistoryPolls: 2,
    pollDelayMs: 0,
    sleep: async () => undefined,
  });

  await assert.rejects(
    backend.generate(
      { jobId: "job-1", projectId: "project-1" },
      { prompt: "draw an island" },
    ),
    /did not produce an image before polling expired/,
  );
});

test("ComfyUI backend rejects unsupported image media type", async () => {
  const responses = [
    jsonResponse({ prompt_id: "prompt-1" }),
    jsonResponse({
      "prompt-1": {
        outputs: {
          "9": { images: [{ filename: "result.gif", type: "output" }] },
        },
      },
    }),
    new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "content-type": "image/gif" },
    }),
  ];
  const backend = createComfyUiImageGenerationBackend({
    baseUrl: "http://127.0.0.1:8188",
    createWorkflow: () => ({}),
    fetchImpl: async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  });

  await assert.rejects(
    backend.generate(
      { jobId: "job-1", projectId: "project-1" },
      { prompt: "draw an island" },
    ),
    /unsupported image media type/,
  );
});
