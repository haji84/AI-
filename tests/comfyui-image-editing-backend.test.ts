import assert from "node:assert/strict";
import test from "node:test";

import { createComfyUiImageEditingBackend } from "../src/providers/comfyui-image-editing-backend.ts";
import type { ProviderContext } from "../src/providers/provider.ts";

const context: ProviderContext = {
  jobId: "job-edit-1",
  projectId: "project-1",
};

const request = {
  instruction: "Turn the sky orange",
  source: {
    mediaType: "image/png" as const,
    data: new Uint8Array([1, 2, 3]),
  },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("ComfyUI image editing backend uploads, submits, polls, and downloads", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let workflowArgs: { filename: string; instruction: string } | undefined;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/upload/image")) {
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof FormData);
      const image = init.body.get("image");
      assert.ok(image instanceof Blob);
      assert.equal(image.type, "image/png");
      assert.equal(init.body.get("type"), "input");
      assert.equal(init.body.get("overwrite"), "true");
      return jsonResponse({ name: "uploaded-source.png" });
    }

    if (url.endsWith("/prompt")) {
      const body = JSON.parse(String(init?.body)) as {
        prompt: Record<string, unknown>;
        client_id: string;
      };
      assert.equal(body.client_id, String(context.jobId));
      assert.deepEqual(body.prompt, { workflow: "ok" });
      return jsonResponse({ prompt_id: "prompt-1" });
    }

    if (url.endsWith("/history/prompt-1")) {
      return jsonResponse({
        "prompt-1": {
          outputs: {
            "99": {
              images: [{ filename: "edited.png", subfolder: "", type: "output" }],
            },
          },
        },
      });
    }

    if (url.includes("/view?")) {
      assert.match(url, /filename=edited.png/);
      assert.match(url, /type=output/);
      return new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const backend = createComfyUiImageEditingBackend({
    baseUrl: "http://127.0.0.1:8188/",
    fetchImpl,
    createWorkflow(receivedRequest, uploadedFilename) {
      workflowArgs = {
        filename: uploadedFilename,
        instruction: receivedRequest.instruction,
      };
      return { workflow: "ok" };
    },
  });

  const output = await backend.edit(context, request);

  assert.deepEqual(workflowArgs, {
    filename: "uploaded-source.png",
    instruction: request.instruction,
  });
  assert.equal(output.mediaType, "image/png");
  assert.deepEqual([...output.data], [9, 8, 7]);
  assert.equal(calls.length, 4);
});

test("ComfyUI image editing backend polls until an image exists", async () => {
  let historyCalls = 0;
  let sleepCalls = 0;

  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/upload/image")) return jsonResponse({ name: "source.png" });
    if (url.endsWith("/prompt")) return jsonResponse({ prompt_id: "prompt-2" });
    if (url.endsWith("/history/prompt-2")) {
      historyCalls += 1;
      if (historyCalls === 1) return jsonResponse({ "prompt-2": { outputs: {} } });
      return jsonResponse({
        "prompt-2": { outputs: { out: { images: [{ filename: "done.webp" }] } } },
      });
    }
    return new Response(new Uint8Array([4]), {
      headers: { "content-type": "image/webp" },
    });
  };

  const backend = createComfyUiImageEditingBackend({
    baseUrl: "http://localhost:8188",
    fetchImpl,
    createWorkflow: () => ({}),
    maxHistoryPolls: 2,
    pollDelayMs: 1,
    sleep: async () => {
      sleepCalls += 1;
    },
  });

  const output = await backend.edit(context, request);
  assert.equal(historyCalls, 2);
  assert.equal(sleepCalls, 1);
  assert.equal(output.mediaType, "image/webp");
});

test("ComfyUI image editing backend rejects unsupported output media types", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/upload/image")) return jsonResponse({ name: "source.png" });
    if (url.endsWith("/prompt")) return jsonResponse({ prompt_id: "prompt-3" });
    if (url.endsWith("/history/prompt-3")) {
      return jsonResponse({
        "prompt-3": { outputs: { out: { images: [{ filename: "bad.gif" }] } } },
      });
    }
    return new Response(new Uint8Array([1]), {
      headers: { "content-type": "image/gif" },
    });
  };

  const backend = createComfyUiImageEditingBackend({
    baseUrl: "http://localhost:8188",
    fetchImpl,
    createWorkflow: () => ({}),
  });

  await assert.rejects(
    () => backend.edit(context, request),
    /unsupported image media type/,
  );
});
