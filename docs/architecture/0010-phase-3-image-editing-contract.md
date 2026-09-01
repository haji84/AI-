# ADR 0010: Phase 3 image editing contract

## Status
Proposed for Phase 3 implementation.

## Context
Phase 3 introduces image editing after Phase 2 established provider-independent image generation. The first editing contract should express only the invariants required for one edit operation and preserve the existing generic `Provider<TInput, TOutput>` boundary.

## Decision
Define `ImageEditingRequest` with:
- a non-empty edit instruction
- one source image represented by an existing supported image media type plus raw bytes

Define `ImageEditingOutput` as one edited image represented by a supported image media type plus raw bytes.

Supported media types remain PNG, JPEG, and WebP. Reuse the existing `ImageMediaType` definition from the image-generation contract rather than creating a competing media-type vocabulary.

Expose `ImageEditingProvider` only as `Provider<ImageEditingRequest, ImageEditingOutput>`.

Validate only contract-owned invariants:
- instruction must not be empty or whitespace-only
- source image bytes must not be empty

Do not add masks, coordinates, strength, dimensions, seed, negative prompts, model identifiers, workflow metadata, storage references, URLs, retry behavior, or runtime-specific fields until a later issue proves they are required.

## Phase 3 acceptance path
Phase 3 technical acceptance will require all of the following before phase completion:
1. the provider-independent image-editing contract is implemented and tested
2. an application-level edit operation can invoke an `ImageEditingProvider`
3. at least one concrete local editing runtime path is integrated behind the provider/backend boundary
4. one real local image-editing smoke test successfully writes a valid PNG, JPEG, or WebP output
5. repository CI remains green and the accepted path does not require a paid API, credentials/secrets, production deployment, or application-level model lock-in

## Consequences
- Phase 3 starts with the smallest useful edit operation: source image + instruction -> edited image
- generation and editing share the same image media vocabulary without coupling their provider interfaces
- runtime/model/workflow details remain outside the application contract
- advanced editing controls can be added deliberately in later issues
