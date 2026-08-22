# ADR 0004: Phase 1 Project Storage Contract

## Status

Accepted

## Context

Phase 1 needs a minimal boundary for saving and retrieving `Project` snapshots without selecting a database, filesystem, cloud service, or storage driver.

## Decision

- `ProjectStorage` is asynchronous so future adapters can perform I/O without changing callers.
- `save(project)` upserts the complete `Project` snapshot. Partial updates are not supported.
- `getById(id)` returns the stored `Project`, or a successful result with `null` when no project exists.
- Expected storage failures return a `ProjectStorageResult` with the single public error code `STORAGE_FAILURE`. Driver-specific errors do not cross the contract and expected failures do not throw.
- Storage preserves the supplied values and does not validate lifecycle transitions, correct fields, or mutate a `Project`. Lifecycle rules remain in the project domain.
- `list` and `delete` are excluded until a concrete requirement exists.

## Boundaries

This decision defines only the storage contract. It does not select or implement persistence. A future Job model owns job lifecycle concerns, while Provider interfaces own external service integration; neither concern belongs in `ProjectStorage`.

## Alternatives considered

- A synchronous interface was rejected because real persistence adapters commonly require asynchronous I/O.
- Throwing expected failures was rejected in favor of an explicit result contract.
- A `NOT_FOUND` error was rejected because absence is an expected query outcome.
- Repository, service, list, delete, transaction, and caching abstractions were deferred because Phase 1 has no requirement for them yet.

## Consequences

Callers handle absence and storage failure explicitly. Future adapters can be added behind the interface without changing the Project domain contract.
