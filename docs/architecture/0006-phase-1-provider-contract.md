# ADR 0006: Phase 1 Provider Contract

## Status

Accepted for Phase 1

## Context

Phase 1 needs a provider boundary after the Project, Storage, and Job contracts are established. The boundary must allow later image, video, voice, and other provider-backed capabilities without coupling the application foundation to a vendor SDK, model identifier, network transport, credential scheme, or concrete media payload.

## Decision

Define a generic `Provider<TInput, TOutput>` interface with one asynchronous `execute` operation.

Every execution receives a provider-independent `ProviderContext` containing the existing `JobId` and `ProjectId`. Capability-specific input and output shapes remain generic type parameters and therefore belong to later feature Issues rather than Phase 1.

Expected provider execution outcomes use a discriminated `ProviderResult<T>` union. Phase 1 defines one stable provider-independent error code, `PROVIDER_FAILURE`, plus a human-readable message. Concrete implementations may translate SDK, transport, timeout, or service failures into this boundary later, but those implementation details are not part of the Phase 1 contract.

## Boundaries

- No concrete provider implementation is introduced.
- No vendor, SDK, model, endpoint, credential, API key, billing, retry, timeout, streaming, queue, worker, or persistence behavior is defined.
- No concrete image, video, audio, text, or metadata payload is defined.
- `JobId` and `ProjectId` provide execution correlation only. Provider execution does not mutate Job or Project lifecycle state.
- Capability-specific interfaces may specialize the generic provider contract in later phases when their requirements are known.

## Alternatives considered

- A vendor-specific interface was rejected because it would make the application foundation depend on an external provider before any provider is selected.
- A single untyped `unknown` request/response contract was rejected because it would move type safety out of the boundary.
- Capability enums and concrete media request shapes were deferred because Phase 1 does not yet define image, video, voice, or editing requirements.
- Provider-specific error codes were deferred because their semantics depend on concrete implementations.

## Consequences

The application now has a minimal typed seam for provider-backed work while keeping Phase 1 independent of vendors and future media-specific contracts. Later phases can introduce capability-specific input/output types without changing the basic execution and result model unless a concrete requirement proves the contract insufficient.

## Rollback

Before merge, close the pull request. After merge, revert the provider contract commit through a new pull request without rewriting history.
