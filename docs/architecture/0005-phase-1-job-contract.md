# ADR 0005: Phase 1 Job Contract

## Status

Accepted for Phase 1

## Context

Phase 1 needs a minimal Job domain contract before Provider interfaces are designed. Jobs must represent provider-independent processing state without introducing persistence, queues, workers, network concerns, or provider-specific types.

## Decision

A Job is an immutable value with a caller-supplied opaque string `id`, a referenced `ProjectId`, a provider-independent lifecycle `status`, and canonical ISO 8601 UTC `createdAt` and `updatedAt` strings.

Job IDs and referenced Project IDs are non-empty, contain no surrounding whitespace, and are not restricted to UUIDs.

Jobs are created as `pending`, with matching creation and update timestamps. The only valid transitions are:

```text
pending -> running
running -> succeeded
running -> failed
```

Every other transition is invalid. A transition preserves `id`, `projectId`, and `createdAt`, returns a new frozen Job value, and requires an `updatedAt` that is canonical and not earlier than the current value.

Domain operations return a discriminated result union rather than throwing expected failures. Stable error codes are `INVALID_ID`, `INVALID_PROJECT_ID`, `INVALID_TIMESTAMP`, and `INVALID_TRANSITION`.

## Boundaries

- `ProjectId` is referenced from the Project domain contract, but Job processing state never changes `ProjectStatus`.
- Job persistence is not defined. A Job storage abstraction may be introduced only when required by a later Issue.
- Queue and worker behavior are not part of the Job domain contract. `pending` describes lifecycle state and does not mandate a queue implementation.
- Provider interfaces remain a later boundary. Provider SDK types, request/response payloads, network failures, metadata, model identifiers, and retry policy do not belong in the Job domain model.
- Cancellation, progress percentage, retry/reset transitions, and orchestration are deferred until a concrete requirement exists.
- ID and clock generation remain outside the domain functions.

## Alternatives considered

- `queued` was rejected as the initial status because it would imply a queue architecture that Phase 1 has not selected.
- Provider-specific statuses were rejected because they would couple the domain contract to external services.
- Cancellation and retry states were deferred because no current requirement defines their semantics.
- Exceptions and validation dependencies were rejected in favor of an explicit dependency-free result union.

## Consequences

The Job contract is deterministic, provider-independent, and testable without infrastructure. Provider interfaces can be designed against this stable lifecycle without importing network or SDK concerns into the domain.

## Rollback

Before merge, close the pull request. After merge, revert the Job contract commit through a new pull request without rewriting history.
