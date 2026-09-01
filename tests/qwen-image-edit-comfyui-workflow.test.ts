import assert from "node:assert/strict";
import test from "node:test";

import { createQwenImageEditWorkflow } from "../src/providers/qwen-image-edit-comfyui-workflow.ts";

const request = {
  instruction: "Make the sky orange",
  source: {
    mediaType: "image/png" as const,
    data: new Uint8Array([1, 2, 3]),
  },
};

test("Qwen Image Edit workflow injects uploaded filename and instruction without mutating template", () => {
  const template = {
    workflow: {
      "10": { class_type: "LoadImage", inputs: { image: "placeholder.png" } },
      "20": { class_type: "CLIPTextEncode", inputs: { text: "placeholder" } },
    },
    imageNodeId: "10",
    instructionNodeId: "20",
  };

  const workflow = createQwenImageEditWorkflow(template, request, "uploaded.png");

  assert.equal((workflow["10"] as { inputs: { image: string } }).inputs.image, "uploaded.png");
  assert.equal((workflow["20"] as { inputs: { text: string } }).inputs.text, request.instruction);
  assert.equal((template.workflow["10"] as { inputs: { image: string } }).inputs.image, "placeholder.png");
});

test("Qwen Image Edit workflow supports custom input names", () => {
  const workflow = createQwenImageEditWorkflow(
    {
      workflow: {
        image: { inputs: { source_name: "old" } },
        prompt: { inputs: { prompt_text: "old" } },
      },
      imageNodeId: "image",
      instructionNodeId: "prompt",
      imageInputName: "source_name",
      instructionInputName: "prompt_text",
    },
    request,
    "source.webp",
  );

  assert.equal((workflow.image as { inputs: { source_name: string } }).inputs.source_name, "source.webp");
  assert.equal((workflow.prompt as { inputs: { prompt_text: string } }).inputs.prompt_text, request.instruction);
});

test("Qwen Image Edit workflow rejects missing configured nodes", () => {
  assert.throws(
    () => createQwenImageEditWorkflow(
      { workflow: {}, imageNodeId: "missing", instructionNodeId: "prompt" },
      request,
      "source.png",
    ),
    /node missing is missing/,
  );
});
