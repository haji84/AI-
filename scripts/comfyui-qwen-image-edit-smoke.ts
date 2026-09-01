import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

import { createComfyUiImageEditingBackend } from "../src/providers/comfyui-image-editing-backend.ts";
import type { ImageMediaType } from "../src/providers/image-generation.ts";
import {
  createQwenImageEditWorkflow,
  type ComfyUiApiWorkflow,
} from "../src/providers/qwen-image-edit-comfyui-workflow.ts";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function sourceMediaType(path: string): ImageMediaType {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      throw new Error("QWEN_IMAGE_EDIT_SOURCE must be PNG, JPEG, or WebP.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractWorkflow(value: unknown): ComfyUiApiWorkflow {
  if (!isRecord(value)) throw new Error("Workflow JSON must be an object.");
  if (isRecord(value.prompt)) return value.prompt;
  return value;
}

async function main(): Promise<void> {
  const baseUrl = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
  const workflowPath = requiredEnv("QWEN_IMAGE_EDIT_WORKFLOW_PATH");
  const sourcePath = requiredEnv("QWEN_IMAGE_EDIT_SOURCE");
  const imageNodeId = requiredEnv("QWEN_IMAGE_EDIT_IMAGE_NODE_ID");
  const instructionNodeId = requiredEnv("QWEN_IMAGE_EDIT_INSTRUCTION_NODE_ID");
  const instruction = process.env.QWEN_IMAGE_EDIT_INSTRUCTION?.trim()
    || "Make the sky warmer while preserving the rest of the image.";
  const outputPath = process.env.QWEN_IMAGE_EDIT_OUTPUT?.trim()
    || "./tmp/qwen-image-edit-smoke.png";
  const imageInputName = process.env.QWEN_IMAGE_EDIT_IMAGE_INPUT?.trim() || "image";
  const instructionInputName = process.env.QWEN_IMAGE_EDIT_INSTRUCTION_INPUT?.trim() || "text";
  const maxHistoryPolls = positiveIntegerEnv("QWEN_IMAGE_EDIT_MAX_HISTORY_POLLS", 240);
  const pollDelayMs = positiveIntegerEnv("QWEN_IMAGE_EDIT_POLL_DELAY_MS", 1000);

  const workflowJson = JSON.parse(await readFile(workflowPath, "utf8")) as unknown;
  const workflowTemplate = extractWorkflow(workflowJson);
  const sourceData = new Uint8Array(await readFile(sourcePath));
  const mediaType = sourceMediaType(sourcePath);

  const backend = createComfyUiImageEditingBackend({
    baseUrl,
    maxHistoryPolls,
    pollDelayMs,
    createWorkflow(request, uploadedFilename) {
      return createQwenImageEditWorkflow(
        {
          workflow: workflowTemplate,
          imageNodeId,
          instructionNodeId,
          imageInputName,
          instructionInputName,
        },
        request,
        uploadedFilename,
      );
    },
  });

  const output = await backend.edit(
    { jobId: "qwen-image-edit-local-smoke", projectId: "phase-3-image-editing" },
    {
      instruction,
      source: {
        mediaType,
        data: sourceData,
      },
    },
  );

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output.data);
  console.log(
    `ComfyUI Qwen-Image-Edit smoke test succeeded: ${outputPath} (${output.mediaType}, ${output.data.length} bytes)`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ComfyUI Qwen-Image-Edit smoke test failed: ${message}`);
  process.exitCode = 1;
});
