# ADR 0008: Select ComfyUI as the first local image generation runtime

## Status
Accepted for Phase 2 implementation.

## Context
Phase 2 now has a provider-independent image generation contract, application service, HTTP adapter, and a local backend seam. The next step is to connect one real free/local runtime without coupling the TypeScript application to a specific model or paid provider.

## Decision
Use ComfyUI as the first concrete local image-generation runtime.

The repository integrates with the ComfyUI local HTTP API only. It queues an injected API workflow through `/prompt`, polls `/history/{prompt_id}` until an image output is available, and downloads the first image through `/view`.

Workflow and model selection remain outside the backend and are injected by the caller. No checkpoint name, model download, ComfyUI installation, process lifecycle, credential, or paid service is owned by this repository in this decision.

## Rationale
- ComfyUI can run locally and does not require per-image API billing.
- Its HTTP API can be called with the platform `fetch` implementation, avoiding a new application dependency.
- Workflow injection keeps model choice replaceable and preserves the existing `ImageGenerationProvider` and `LocalImageGenerationBackend` boundaries.
- Direct Diffusers integration would add Python/PyTorch/runtime ownership to this TypeScript application before that complexity is required.

## Consequences
- A local ComfyUI server and a valid API-format workflow must be supplied at runtime before real image generation can succeed.
- Tests mock the HTTP boundary and do not require a GPU, model download, or running ComfyUI instance.
- Later runtimes remain possible behind the existing provider and local backend abstractions.
