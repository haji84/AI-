# 2026-11-12 GORIQ checkpoint continuation (Issue #1219 / PR #1910)

New source checkpoint: parent d753986226de25c874333f6ca1e152ae8ed54570; this new commit changes the HEAD. Re-read PR #1910 and its own exact-HEAD CI before claiming acceptance. Previous parent CI #43214463220 4/4 SUCCESS applies ONLY to d753986226de25c874333f6ca1e152ae8ed54570.

## Owner north star
No permanent MacBook for GitHub-eligible Goals; no second GitHub account or mandatory independent code review; reuse existing authenticated Goal Controller, coordinator, Builder, Verifier, Human Gates, records and the existing Issue #1219. Original Goal goal-fcc81c97e09153f7 / Job rotation-recovery-37 not authenticated from live canonical state and never recreated.

## This source change
Extend the optional GitHubCoordinatorStore in the same PR so encrypted version-2 plaintext binds lease, Goal/digest, WorkRun, durable Job snapshots (including per-task histories), append-only attempt records and events to ONE Git blob SHA CAS update. Legacy version-1 lease-only state remains valid for lease use but cannot be silently upgraded to Goal authority; loadCheckpoint returns CHECKPOINT_MISSING. A claimed current lease, valid Goal/Job linkage, no history deletion/rewrites, and independent encrypted readback are enforced. In-process same-epoch history rollback is rejected. No new controller, scheduler, secret, state branch, workflow, prod migration or deployed permission.

Local fixture validation: eight new source-checkpoint cases initially RED due to missing method; additional same-epoch replay case RED, then existing41 + new9 = 50 PASS, strict focused typecheck exit0 using partial Node22 snapshot. GitHub transport replies MOCKED; not real production GitHub acceptance. New source SHA256 73280474628710d0578148980e332d585407c20b221880efcc15c12520a6159f; test SHA256 1a55ca35e653a9b0d39bbb3e677dfeb16ab09b8269b1a7a133d83f9c009ebf61. Details: docs/superpowers/plans/2026-11-12-goal-checkpoint-atomic.md and docs/evidence/1219-20261112-goal-checkpoint-atomic.json.

## Required continuation
1. Check exact PR HEAD and all CI jobs, inspect any failure and fix its concrete cause. A green previous main/parent cannot accept this HEAD.
2. Current checkpoint is bounded to 6,500 bytes and FAILS CLOSED on overflow; complete unbounded immutable history archiving remains unfinished. Never truncate records or claim all possible future history fits.
3. Owner-authorized original Goal import/authenticated readback and controlled state-branch/key/freshness anchor remain HOLD; live WorkRun and actual real task state have NOT been moved to GitHub. Do not auto-bootstrap a new Goal, weaken security or request Mac as routine prerequisite.
4. Wire existing broker/GoalController/Resident intake and task state to the same CAS/fencing update with stop/pause/approval/budget checks. Side-effect fencing and old-owner rejection across hosts need real proof.
5. Demonstrate actual separate GitHub Actions run readback/recovery, real AI code repair with genuine verification, automatic next Job and independently checked artifact. Keep Issue #1219 OPEN until that real full E2E.

## Preserved earlier checkpoint

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
