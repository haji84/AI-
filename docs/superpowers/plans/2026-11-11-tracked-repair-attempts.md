# Issue #1219: bounded, evidence-preserving model repair

Base: PR #1907, `ec5f5d24f311ac577c17e29d25cab85d81539372`.
Owner request: perform the necessary work toward the existing autonomous Goal.
Binding requirements: Issue #1219, AGENTS.md, PROJECT_STATE.md and the existing
resident execution architecture. No new controller, Goal, authority or PR.

## Verified gap and selected implementation

The canonical resident host persists a complete independent verification FAIL
and enters RECOVERING. The tracked source factory nevertheless reuses its one
prepared record and `:tracked-candidate` identity. Thus a second actual inference
cannot produce a separately verified candidate. The existing Python sequence
profile is an exact-output fixture; extending that fixture would not implement
real source repair.

Implement the repair in the existing tracked source profile. Add an optional
host-pinned `recoveryAttempts` array of at most eight `{workspace, receiptFile}`
entries. Each entry names a distinct pre-provisioned baseline worktree and an
independent receipt path. The first attempt keeps its existing workspace, IDs
and file layout. Without the opt-in, no additional inference is authorized.
Using distinct worktrees preserves rejected source bytes and avoids resetting
or overwriting a predecessor. The existing controller's recovery limits, signed
manifest expiry, scope, model, frozen probe, verifier key and admission remain.

An attempt derives only from canonical Job failure history, never from a new
counter. Validate each predecessor's rejected Change Set, exact controller
failure transition and archived independently signed receipt. Validate already
consumed receipts at their persisted consumption time; current manifest and
execution authority must still be valid. Save each receipt immutably when it is
consumed. Give each attempt its own prepared/intent/response records, Change Set,
request and receipt. Supply the model with the previous candidate, failed check
names and recorded hypothesis; never invent missing test output from a digest.

## Tasks and verification

1. Add failing behavioral tests to `tests/autonomous-tracked-repair-runtime.test.ts` for
   signed FAIL -> changed second inference -> independent PASS, restart without
   duplicate inference, immutable first-attempt evidence, finite opt-in bounds,
   stale/forged receipt refusal, interrupted inference and path collisions.
   Add exporter refusal coverage in `tests/tracked-repair-actions.test.mjs`.
   Run the new tests before implementation and retain RED output.
2. Implement the opt-in in `tracked-repair-resident-runtime.ts`; reuse canonical
   Job/Change Set stores and signed verification. Extend
   `resident-receipt-wakes.ts` to watch only the predeclared receipt paths.
   Keep the legacy fixed checkpoint exporter explicitly one-attempt-only until
   a transport contract can preserve the complete recovery history.
3. Run affected runtime/receipt/export tests, lint, TypeScript, the full suite,
   security suite, traceability checks and build. Reconcile existing source
   fingerprints without changing requirement classifications. Obtain an
   independent code review, fix material findings and verify them.
4. Publish to the existing PR using an unchanged-parent check; read back the
   exact commit and its CI. Record what is implemented and what production
   evidence remains absent. Do not claim actual model or signer operation from
   fixture tests, and do not merge a failed/incomplete candidate.

## Review focus

- A stale, forged, incomplete or unrelated FAIL must not authorize inference.
- A copied previous PASS cannot validate the next candidate.
- A restart after prepared output or partial materialization must not reinfer.
- Receipt/request/workspace aliases and overlap must fail before model calls.
- An equivalent failed candidate and exhausted or absent opt-in must stop.

## Production boundaries and rollback

This patch creates no credentials, trust roots, hosted trigger, deployment or
distributed state service. The existing Actions checkpoint transport cannot
represent multi-attempt history and must refuse this explicit opt-in. A real
hosted intake, off-run authority, separately controlled signer, actual model
execution and artifact delivery remain separate acceptance conditions.

Rollback: revert this source change while retaining all existing Goal/Job data,
failed source worktrees, prepared records and receipts. Do not reset attempts or
delete rejected evidence to obtain a successful run.
