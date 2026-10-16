# Verified continuation of existing GORIQ development

> For agentic workers: execute inline with superpowers:executing-plans and test-driven-development; request one separate whole-branch code review.

Goal: repair existing PR #1764 under Issue #1763 and parent #681, without creating another implementation or granting runtime authority.

Architecture: reuse Compass, WorkState, bounded runner, Builder router, existing locks and verification gates. A checkpoint is a hint bound to the exact persisted Goal and state; it never authorizes an effect. Persist a next action after actual verified DoD progress, and distinguish subsequent work from retrying a completed child.

Tech stack: Node 24.19.0, TypeScript, built-in test runner, pnpm 11.19.0.

Spec: Issue #1763; AGENTS.md; docs/architecture/gai-work-state-protocol.md; docs/autonomy-safe-takeover-acceptance.md; owner instruction of 2026-10-17 JST.

Constraints: preserve Human Gates, protection, independent verification, local lock and external-effect reconciliation holds. No new dependencies, credentials, production activation or physical fault injection. Reuse PR #1764. Compass MCP is unavailable here; repository/Issue/PR write-back is the fallback.

Review focus: changed Goal with the same title; lowercase terminal states; stale/corrupt hints; no verified progress; blocked or overlapping child scopes.

1. Reconcile latest main into the existing branch and run existing tests. Record baseline failures separately; do not weaken tests.
2. Write failing subprocess tests for exact Goal/state binding, terminal-state rejection, corrupt checkpoints and scheduled re-entry.
3. Write failing WorkState/Planner tests for persisting the remaining criterion only after verified progress and assigning subsequent work a distinct action identity.
4. Implement the smallest changes in scripts/autonomy-run.ts, src/orchestrator/work-state-integration.ts and runtime-development-planner.ts. Preserve bounds and all stop gates.
5. Run focused tests, full tests, P8, lint, typecheck/build and health. Reconcile only actually changed traceability rows against canonical requirements.
6. Address independently reproduced code-review findings, save the current audit/backlog and exact validation evidence, update the same PR with a compare-and-swap head check.
7. Require GitHub CI and outstanding acceptance/independent authority conditions before integration. If a gate remains, keep Draft and record the exact next action. No whole-product or speedup claim follows from repository tests.
