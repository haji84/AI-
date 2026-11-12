# GORIQ current handoff: Issue #1219, GitHub-first persistence

Checkpoint: 2026-11-12 JST. Source-development evidence only. Original production Goal NOT_ACHIEVED. Refresh actual main, candidate branch, PR and exact-HEAD CI before work.

## Owner decisions and corrected baseline

Independent code review, dedicated AI-09 approval and a separate GitHub account are OPTIONAL, not blockers. Do not reintroduce them as conditions for source delivery or completion. Actual tests, authentication, result integrity, branch protection and privileged Human Gates remain.

No permanent MacBook or ZBook prerequisite for ordinary GitHub-eligible work. Device-only work can wait without blocking independent hosted work. Do not ask the owner to run Mac diagnostics as a prerequisite for this hosted source work. No Codex/Copilot/CodeRabbit dependency, new controller, replacement Goal, secret scope, paid service or destructive migration.

PR #1907 is MERGED, not Draft. Refreshed main is 8ead188ffc374c0204f20798ac8258af07272bdc, tree 2320ec81599781b6dcc46b78b8bdf7acf2dba618. Existing Issue1219 stays open. Main CI43175566988 is historical baseline evidence, NOT acceptance for this new candidate.

The preceding handoff is preserved byte-for-byte as GORIQ_HANDOFF_8ead188_ARCHIVE.md (Git blob 6f01588c3eb203ba1a4f76c24b9e135509a32fe1). Its statements that PR1907 is Draft and an independent code review is mandatory are superseded by the explicit owner clarification and actual merge. Keep its technical and failure evidence, not its obsolete blockers.

Original identifiers goal-fcc81c97e09153f7 / rotation-recovery-37 are historical references, not permission to create/reset/resume them. Targeted read-only dispatch43187031257 confirmed owner authentication and correct inputs but the first Goal read returned a generic HOLD. That does not prove absence or deletion. No original Goal or live state was modified here.

## Actual source work in this checkpoint

Candidate branch: feature/1219-github-coordinator-store-20261112, based on the exact main above. PR1907 is already merged; this bounded successor belongs to the SAME Issue1219 and is not a parallel controller.

Existing DistributedCoordinatorRuntime already supports injected CoordinatorStore, epochs, fencing tokens, renewal and ownership checks. Its Memory/JSON implementations are local only. Add scripts/goriq-github-coordinator-store.ts as an optional GitHub transport implementation of that same interface. Existing domain runtime and local lock code remain byte-identical.

The adapter reads a pre-provisioned encrypted state/coordinator.enc.json on an explicitly supplied goriq-state/... branch, uses the observed Git blob SHA for conditional updates, and verifies ciphertext/lease readback. AES-256-GCM authenticates repository/branch/path/cluster context. Missing state, unknown write outcome, bad credentials, tampering, stale observation, epoch rollback and blind save do not become success or automatic bootstrap. Conflicts are not retried with a newer SHA. Credentials and raw response bodies are not emitted in errors.

This is coordinator LEASE persistence only. It is NOT the full Goal/Job/attempt store, NOT atomic fencing of arbitrary side effects, and NOT installed into the production executor. Fresh-process rollback protection requires a trusted minimum epoch and controlled state history. An encryption key alone cannot prove freshness.

## Verification

Local isolated partial snapshot: Node22.16.0, TypeScript5.8.3. Tests were written before implementation; initial explicit stub produced 32 failures of 33. Final focused test suite: 41 passed, 0 failed, 0 skipped, exit0. Strict focused typecheck: exit0. Eight added cases compose the new store with the actual existing DistributedCoordinatorRuntime, including renew, takeover, stale-owner rejection, concurrent election and restore into a fresh runtime instance.

The GitHub HTTP protocol is mocked; cryptography and the existing runtime are real code. This is not an actual GitHub backend, different-host or original-Goal production test. Local runtime is not the pinned Node24.19.0 repository environment. Full exact-candidate CI remains required. Never reuse the old main's successful CI for this candidate.

Initial local typecheck issues were corrected without weakening assertions; retained details and source/log digests are in docs/evidence/1219-20261112-hosted-coordinator-store.json. Plan: docs/superpowers/plans/2026-11-12-hosted-coordinator-store.md.

## Next implementation, in order

1. Inspect the successor candidate's exact SHA and all required CI. Fix actual failures, not the validation requirements. Do not wait for a separate reviewer/account.
2. Extend the existing state/export interfaces to preserve the COMPLETE authenticated Goal, WorkRun, Jobs, changes, failed attempts and receipts. Couple accepted writes atomically with current ownership; this lease-only adapter does not provide that coupling. Reuse existing schemas and integrity checks rather than inventing a new controller.
3. Identify already-authorized key/storage/authority inputs without printing secrets. Missing authorized bootstrap or original state is HOLD, not permission to generate a new identity or initialize an empty replacement. Any new credential or permission remains a separate Human Gate.
4. Connect bounded GitHub-hosted intake/execution and wakeup to the existing GoalController/Resident path. Preserve pause/cancel, scope, budgets, result verification and device-specific routing.
5. Prove actual save -> separate runner restore -> no duplicate effects -> genuine failure/different repair -> automatic next Job -> usable artifact, including stale-owner and interruption rejection. Source/CI success does not close Issue1219.

## Mutations and rollback

Only code/test/document source objects are proposed. No workflow, dependency, permission, secret, model service, runtime state branch, original Goal, local PC or production setting was changed. No production encryption key was generated. No force update, main direct commit or unapproved migration.

Rollback removes the unused adapter/tests and dependent documentation; retain all historical evidence and original runtime state. Compass MCP/live writeback is unavailable: repository documentation and issue comments are development context, not runtime authority or a wake event. Record final candidate SHA, PR/run outcomes and exact limits in Issue1219, and read that record back.
