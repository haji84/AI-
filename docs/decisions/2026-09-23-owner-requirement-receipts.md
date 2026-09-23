# Owner requirements as durable completion conditions (#1205)

Status: Candidate on PR #1213; not deployed.
Date: 2026-09-23

## Context
Accepted owner requirements must survive Broker restart and stale Goal/worker write-back. A model-authored specSynced boolean cannot prove canonical synchronization. The repository ledger exceeds the generic PR capability payload bound.

## Decision
Use the existing authenticated Broker owner intake. Save exact owner receipts in a reserved Compass active envelope before Goal mutation; bind to the authoritative Goal afterward. Dedicated transactional updates own this envelope. Generic state writers preserve it. No database schema, credentials, permissions or enrollment changes.

The trusted local repository ledger, JSON mirror and decision history jointly prove synchronization. Goal completion, WorkState and Work Run revalidate those artifacts. A rollback or conflicting canonical history reopens the block. Questions, examples, lexical similarity and external sourceContext do not confer owner acceptance.

Generate review artifacts for explicit existing-ID bindings. Reconcile correction/withdrawal using stored authenticated history; remove only the exact previous receipt addition. Preserve original rows, evidence/status, reciprocal history and stable IDs. A text/base mismatch requires conflict review. Unsynced chains are retained as superseded history without inventing evidence.

This contract does not authorize protected changes, publication, merge or deployment. Do not bypass the generic PR payload bound. New IDs, broad semantic/coreference extraction and publishing need further implementation.

## Consequences and rollback
Missing/corrupt receipt or canonical state fails visibly. Archive policy remains required at the bounded 500-record capacity; no automatic eviction.

Rollback code and its dependent contract together. Preserve Compass SQLite and the receipt envelope; never delete receipts to clear completion blockers. Before returning to a runtime without enforcement, stop dependent work until completion checks are restored. Production/devices are untouched by candidate validation.
