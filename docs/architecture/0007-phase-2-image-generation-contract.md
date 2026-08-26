# ADR 0007: Phase 2 image generation contract

## Status
Accepted

## Context
Phase 2 begins image generation on top of the provider-independent execution boundary established in Phase 1. The first contract must be useful without coupling the application to a vendor, model, SDK, transport, persistence layer, or UI.

## Decision
Define a minimal `ImageGenerationRequest` containing only a non-empty prompt and an `ImageGenerationOutput` containing an image media type plus raw bytes.

The supported contract media types are PNG, JPEG, and WebP. These are application-level output representations, not provider capabilities or preferences.

Expose `ImageGenerationProvider` only as a specialization of the existing generic `Provider<ImageGenerationRequest, ImageGenerationOutput>` boundary. Provider failures continue to use the existing provider-independent error contract.

Validate only the invariant owned by this contract: a prompt may not be empty or whitespace-only. Do not add dimensions, quality, style, seed, negative prompts, model identifiers, provider metadata, URLs, storage references, retry behavior, or moderation/provider policy fields until a later Issue demonstrates they are required.

## Consequences
- Phase 2 can describe a single image-generation operation without selecting a provider.
- Concrete integrations can adapt their SDK responses to this contract later.
- Output bytes remain independent of storage or URL lifetime semantics.
- Future options can be added deliberately rather than becoming accidental Phase 2 requirements.
