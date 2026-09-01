import type { ImageEditingRequest } from "./image-editing.ts";

export type ComfyUiApiWorkflow = Record<string, unknown>;

export interface QwenImageEditWorkflowTemplate {
  readonly workflow: ComfyUiApiWorkflow;
  readonly imageNodeId: string;
  readonly instructionNodeId: string;
  readonly imageInputName?: string;
  readonly instructionInputName?: string;
}

function cloneWorkflow(workflow: ComfyUiApiWorkflow): ComfyUiApiWorkflow {
  return structuredClone(workflow);
}

function requireNode(
  workflow: ComfyUiApiWorkflow,
  nodeId: string,
): Record<string, unknown> {
  const node = workflow[nodeId];
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new Error(`ComfyUI workflow node ${nodeId} is missing.`);
  }
  return node as Record<string, unknown>;
}

function requireInputs(
  node: Record<string, unknown>,
  nodeId: string,
): Record<string, unknown> {
  const inputs = node.inputs;
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
    throw new Error(`ComfyUI workflow node ${nodeId} has no inputs object.`);
  }
  return inputs as Record<string, unknown>;
}

export function createQwenImageEditWorkflow(
  template: QwenImageEditWorkflowTemplate,
  request: ImageEditingRequest,
  uploadedFilename: string,
): ComfyUiApiWorkflow {
  if (uploadedFilename.trim().length === 0) {
    throw new Error("Uploaded ComfyUI image filename must not be empty.");
  }

  const workflow = cloneWorkflow(template.workflow);
  const imageInputName = template.imageInputName ?? "image";
  const instructionInputName = template.instructionInputName ?? "text";

  const imageInputs = requireInputs(
    requireNode(workflow, template.imageNodeId),
    template.imageNodeId,
  );
  imageInputs[imageInputName] = uploadedFilename;

  const instructionInputs = requireInputs(
    requireNode(workflow, template.instructionNodeId),
    template.instructionNodeId,
  );
  instructionInputs[instructionInputName] = request.instruction;

  return workflow;
}
