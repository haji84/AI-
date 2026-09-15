# Phase 20 observability

Each persisted production run records the run id, immutable goal payload, current coordinator state, cycle count, latest Goal Loop report, accumulated verifier evidence and update timestamp. Existing Goal Loop write-back and subsystem ledgers retain detailed per-action evidence; the coordinator record is the top-level run index rather than a replacement telemetry store.
