# ADR 0011: First local Phase 3 image editing runtime

## Status
Proposed for Phase 3 implementation.

## Decision
Use **ComfyUI + Qwen-Image-Edit** as the first concrete local image-editing runtime path behind the existing `ImageEditingProvider` boundary.

The application contract remains model- and runtime-independent. Qwen/ComfyUI details belong only in provider/backend implementation and runtime configuration.

## Why this path
- ComfyUI is already the proven local runtime for Phase 2 in this repository.
- ComfyUI publishes a native Qwen-Image-Edit workflow/template.
- Qwen-Image-Edit is published under Apache-2.0.
- The selected path is self-hosted and does not require a paid API, API credentials, production deployment, or a cloud GPU.
- Reusing ComfyUI minimizes operational surface and preserves the existing provider/backend architecture.

## Reference runtime assets
The first supported reference path uses the official ComfyUI Qwen-Image-Edit template and these local model assets:
- diffusion model: `qwen_image_edit_fp8_e4m3fn.safetensors`
- text encoder: `qwen_2.5_vl_7b_fp8_scaled.safetensors`
- VAE: `qwen_image_vae.safetensors`
- optional acceleration LoRA: `Qwen-Image-Edit-Lightning-4steps-V1.0-bf16.safetensors`

The upstream ComfyUI template is `image_qwen_image_edit.json` from `Comfy-Org/workflow_templates`.

## Integration boundary
Add a `LocalImageEditingBackend` with one operation:

`edit(context, request) -> ImageEditingOutput`

`createLocalImageEditingProvider` adapts this backend to the generic `ImageEditingProvider` contract and maps backend exceptions to the existing `PROVIDER_FAILURE` result.

No ComfyUI/Qwen fields are added to `ImageEditingRequest` or `ImageEditingOutput`.

## Follow-up implementation
The next runtime issue should:
1. export or construct the Qwen-Image-Edit ComfyUI workflow in API prompt format
2. upload the source image to the local ComfyUI instance
3. inject the uploaded filename and edit instruction into the workflow
4. submit `/prompt`, poll `/history/{prompt_id}`, and download the output through `/view`
5. add focused transport/workflow tests
6. run one real-machine local editing smoke test before Phase 3 acceptance can pass

## Hardware note
Runtime selection does not claim that every GPU configuration can execute the reference model. Real-machine viability remains an explicit smoke-test requirement. Lower-VRAM operation may require ComfyUI offloading or later optimization, but those choices must not leak into the application contract.

## Phase 3 acceptance impact
- criterion 1: complete
- criterion 2: complete after PR #73
- criterion 3: not yet complete; this ADR selects the runtime and establishes its backend seam
- criterion 4: pending real local smoke
- criterion 5: pending final verification
