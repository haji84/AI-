# #1858 Completion execution integration

Owner approved continuation after the concrete activation proposal on 2026-10-23. Baseline main a500c70d. Existing Issue1858; previous PR1859 is merged. No live activation, new credentials, permissions, billing or publication.

## Contract

Reuse the existing GoalDrivenLoop, WorkState adapter, DevelopmentOrchestrator work items, Verifier, risk/approval policy and Recovery. Host code supplies typed candidate/action/evidence bindings; HTTP/model context cannot install a catalog or grant authority. Default runtime remains unchanged until the host explicitly selects this integration. Unknown or stale bindings fail closed. A pending execution survives restart and blocks duplicate side effects until independently reconciled.

## Tasks

- [x] Add failing integrated-loop tests: useful action over gated/fluff, trusted verifier observations, physical evidence rejection, restart, stagnation, tampered action, unknown execution outcome.
- [x] Implement host-selected completion source and exact action guard through existing Planner/WorkState loop. Persist observations and execution checkpoint inside the existing envelope; no database schema change.
- [x] Add owner-authenticated status projection and idempotent notification display receipts to existing Work API/Tasks UI. A display receipt is never approval. Approval results only enter through trusted host adapters referencing existing authority.
- [x] Test HTTP auth/receipt rejection and UI output, real SQLite restart, isolated artifact execution/readback, and baseline-versus-enabled measurements under identical synthetic inputs.
- [ ] Reconcile only changed traceability rows; independent whole-branch review, CI, protected integration, main CI; write evidence and remaining live-activation limits to Issue1858.

## Pre-flight and rulings

The existing single-action Planner has no trusted candidate catalog. Add an optional host-source contract at the existing loop factory, not a second scheduler or free-form web configuration. Candidate metadata and executable actions must be bound together. Ordinary callers remain unchanged.

The existing WorkState accepts untyped executor DoD results. In the opted-in path, only independent verifier observations matching the evidence contract may update completion criteria. Keep the existing verifier and all risk/approval gates.

Existing Goal status API is an authenticated Broker proxy. Reuse it for bounded notification acknowledgement; do not introduce a new approval endpoint. GET cannot mark notices delivered. An explicit rendered-notice POST supplies IDs and the observed cycle ID, with server timestamps and immutable receipts.

## Rollback

Revert the integration commit(s) through review/CI; preserve Goal and journal/checkpoint data. A pending action must not be discarded or blindly retried. No live runtime has been activated by isolated validation.
