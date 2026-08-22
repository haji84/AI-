# ADR 0003: Phase 1 Project Contract

Status: Accepted for Phase 1

## Context

Phase 1 needs a minimal Project domain contract before storage, jobs, or
providers can be designed. The contract must remain independent of persistence,
HTTP, UI, and external integrations.

## Decision

A Project is an immutable value with a caller-supplied opaque string `id`, a
validated `name`, a lifecycle `status`, and canonical ISO 8601 UTC `createdAt`
and `updatedAt` strings. IDs are non-empty, contain no surrounding whitespace,
and are not restricted to UUIDs. Names are trimmed, contain 1 to 100 Unicode
code points, and cannot contain CR or LF characters.

Projects are created as `draft`, with matching creation and update timestamps.
The only valid transitions are:

```text
draft -> active
active -> archived
```

Every other transition is invalid. A transition preserves `createdAt`, returns
a new Project value, and requires an `updatedAt` that is canonical and not
earlier than the previous value.

Domain operations return a discriminated result union rather than throwing.
Errors use the stable codes `INVALID_ID`, `INVALID_NAME`, `INVALID_TIMESTAMP`,
and `INVALID_TRANSITION`.

## Boundaries

- Storage may persist and restore Project values but must not own lifecycle
  rules. No storage abstraction is introduced here.
- Jobs may reference a `ProjectId`, but processing states belong to the Job
  model rather than `ProjectStatus`.
- Providers do not change Project lifecycle directly and provider-specific
  state does not belong in the Project contract.
- ID and clock generation remain outside the domain functions.

## Alternatives considered

- UUID-only IDs were rejected because they would prematurely constrain a
  future storage strategy.
- JavaScript `Date` values were rejected because canonical strings are
  immutable and serialization-safe.
- Exceptions and validation libraries were rejected in favor of an explicit,
  dependency-free result union.
- Repository, service, and persistence interfaces were rejected as outside
  this Issue.

## Consequences

The Project contract and lifecycle are deterministic and testable without
framework or persistence dependencies. Additional statuses or transitions
require a separately scoped decision.

## Rollback

Before merge, close the pull request. After merge, revert the Project contract
commit through a new pull request without rewriting history.
