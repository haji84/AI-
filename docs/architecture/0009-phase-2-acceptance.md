# ADR 0009: Phase 2 image generation acceptance and completion verdict

## Status
Accepted for Phase 2 completion assessment.

## Purpose
Define the explicit acceptance criteria required before Phase 2 may be considered technically complete, then evaluate the already-recorded local ComfyUI + FLUX.1 [schnell] execution against those criteria.

This record does not advance the project to Phase 3. Phase advancement remains a Human Gate under `ROADMAP.md` and `AGENTS.md`.

## Acceptance criteria
Phase 2 Image generation is technically accepted only when all of the following are true:

1. A non-empty `ImageGenerationRequest` can initiate image generation through the provider-independent Phase 2 contract.
2. A concrete local image-generation runtime is integrated behind the existing provider/backend boundary without coupling the application contract to a vendor, model, checkpoint, SDK, transport, persistence layer, or UI.
3. A real local runtime successfully produces at least one valid PNG, JPEG, or WebP image through the implemented path.
4. Repository CI remains green, including repository guard, lint, tests, build, and production health verification.
5. The accepted Phase 2 path does not require a paid image API, credentials/secrets, production deployment, or application-level lock-in to a specific checkpoint/model.

## Evidence and verdict

### Criterion 1: PASS
ADR 0007 defines a minimal `ImageGenerationRequest` with a required non-empty prompt and an `ImageGenerationOutput` carrying image media type plus raw bytes. PNG, JPEG, and WebP are supported application-level output representations.

### Criterion 2: PASS
ADR 0008 selects ComfyUI as the first concrete local runtime while preserving the existing provider-independent `ImageGenerationProvider` and local backend boundaries. Workflow/model selection remains caller-injected and is not owned by the application contract.

### Criterion 3: PASS
Issue #50 records a real local execution against ComfyUI using FLUX.1 [schnell]. The observed command completed successfully and wrote one PNG output:

`ComfyUI FLUX schnell smoke test succeeded: ./tmp/flux-schnell-smoke.png (image/png, 1524639 bytes)`

The recorded evidence states that exactly one smoke run was executed, the output file was written, and no repository defect was observed.

### Criterion 4: PASS
Main CI run #95 completed successfully after PR #63. The Phase 2 implementation path had already passed repository guard, lint, tests, build, and health verification in the normal CI workflow.

### Criterion 5: PASS
The local smoke evidence records no credentials, paid API, cloud GPU, or live-runtime CI dependency. ADR 0008 keeps checkpoint/model selection outside the application contract and does not make the repository responsible for ComfyUI installation or model download.

## Technical completion verdict

`PHASE_2_TECHNICAL_ACCEPTANCE: PASS`

All five explicit Phase 2 Image generation acceptance criteria are satisfied by existing repository and real-machine evidence.

## Formal completion gate

`PHASE_2_FORMAL_COMPLETION: PENDING_HUMAN_GATE`

Technical acceptance does not itself authorize phase advancement. The owner must explicitly approve Phase 2 completion and advancement to Phase 3 before `CURRENT_PHASE`, epic, status, or next-phase priority is changed.

## Non-goals
This acceptance record does not require image editing, additional generation controls, UI polish, multi-provider/model management, remote hosting, persistence, or release readiness. Those belong to later phases unless separately approved.
