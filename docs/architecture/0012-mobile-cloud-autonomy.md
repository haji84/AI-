# ADR 0012: Mobile-first cloud autonomy

## Status

Proposed by Issue #90.

## Context

A Windows-only scheduler conflicts with the goal of operating the system from iPhone and Android without keeping a personal PC online. Mobile operating systems are suitable control surfaces but are not reliable always-on background workers for this workload.

## Decision

Use GitHub Actions as the first remote bounded execution host. Mobile devices trigger and inspect runs through GitHub's mobile/web UI. Scheduled runs execute remotely. Compass SQLite remains the runtime state format, persisted between ephemeral runners through Actions cache. Local workstation Compass remains supported but is optional.

The workflow exposes `run`, `pause`, `resume`, and `status` controls, declares read-only repository permission, restores state before execution, saves state after execution, and publishes a workflow summary for mobile inspection.

## Consequences

No personal PC is required for repository-oriented autonomous cycles. GPU/local-only capabilities still require an available workstation or a future remote GPU provider. Actions cache is sufficient for operational continuity but is not treated as archival/audit-grade storage. High-risk or irreversible actions remain behind Human Gate and are not automated by this workflow.
