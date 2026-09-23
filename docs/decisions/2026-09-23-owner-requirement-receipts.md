# Owner requirements as durable completion conditions (#1205)

Status: Candidate on PR #1213; not deployed.
Date: 2026-09-23

## Context
Accepted owner requirements must survive Broker restart and stale Goal/worker write-back. A model-authored specSynced boolean cannot prove canonical synchronization. The repository ledger exceeds the generic PR capability payload bound.

## Decision
Use the existing authenticated Broker owner intake. Save exact owner receipts in a reserved Compass active envelope before Goal mutation; bind to the authoritative Goal afterward. Dedicated transactional updates own this envelope. Generic state writers preserve it. No database schema, credentials, permissions or enrollment changes.

The trusted local repository ledger, JSON mirror and decision history jointly prove synchronization. Goal completion, WorkState and Work Run revalidate those artifacts. A rollback or conflicting canonical history reopens the block. Questions, examples, lexical similarity and external sourceContext do not confer owner acceptance.

Generate review artifacts for explicit existing-ID bindings. Reconcile correction/withdrawal using stored authenticated history; remove only the exact previous receipt addition. Preserve original rows, evidence/status, reciprocal history and stable IDs. A text/base mismatch requires conflict review. Unsynced chains are retained as superseded history without inventing evidence.

This contract does not authorize protected changes, publication, merge or deployment. Do not bypass the generic PR payload bound. The subsequent additive-ID/conversation contract below supplies the reviewed next stage. A subsequent candidate implements the explicitly invoked typed Draft publisher below.

## Consequences and rollback
Missing/corrupt receipt or canonical state fails visibly. Archive policy remains required at the bounded 500-record capacity; no automatic eviction.

Rollback code and its dependent contract together. Preserve Compass SQLite and the receipt envelope; never delete receipts to clear completion blockers. Before returning to a runtime without enforcement, stop dependent work until completion checks are restored. Production/devices are untouched by candidate validation.

## Typed Draft publisher addition

An explicit owner-authenticated publish request is distinct from adoption or proposal generation. It uses existing GitHub authorization without provisioning or increasing permissions. Scope is now four internally generated canonical files, reviewed existing/additional-ID amendments and Draft PR only. Generic PR limits remain unchanged. Larger full-file output (2MiB) is required because canonical originals total about1MiB; changed-line budget remains100KB. Input, time, response and request counts are independently bounded. No automatic merge/reviewer/deploy assertion.

Publication journal uses the already protected Compass envelope, not a schema migration. Base/artifact/review/branch are immutable; head/PR are monotonic metadata. Retry keeps original base when main advances without canonical changes. All current canonical content must still match. Sensitive patterns fail before network, including classic/fine-grained GitHub tokens. Known-pattern scanning is not a universal secret detector.

This does not authorize unattended review/merge.

## Additive IDs, saved context and visible workflow

The next stage adds an independent append-only OWN-ID registry without changing the frozen340; all new rows carry conservative evidence floors and start MISSING. Withdrawn IDs/history remain. An unpublished correction may allocate once; a published chain must retain its previous bindings. Four generated canonical files are reviewed as one atomic artifact.

Authenticated owner input supports bounded Japanese adoption/correction/withdrawal and same-Goal saved references. Unknown or multiple references require visible selection; similarity is candidate ranking only. Existing control-plane reasoning and authorization remain authoritative, with no new paid/model provider. Client per-turn retry identity survives uncertain network delivery.

Tasks/Work now expose request intake, reference selection, preview, explicit Draft publication and actual canonical state. This is the software contract described in docs/architecture/jarvis-requirement-traceability.md, not an arbitrary-language or production-activation claim.
