# Bounded specification Draft publisher (#1205)

Candidate code: 10f684f664e1d8f9ee0932952e55091d6688a0f9.
Source main: 9cbf6accaec5eb1ec76359a6b88af6bf225eb51e.
PR #1213 remains Draft/unmerged; no Production or device changes.

## Verified software
- Saved owner receipt -> explicit reviewed existing-ID bindings -> generator -> fixed three canonical files -> Draft-only GitHub adapter.
- Existing owner-token Broker endpoint and owner-cookie browser proxy; no user-supplied token, host, file, permission or merge authority.
- Immutable durable publication plan; process restart / lost response returns the existing PR without duplication. Unrelated main advance retains original commit base; changed canonical contents still fail.
- Foreign branch, closed/altered PR, superseded receipt, plan retarget and arbitrary authority fields fail closed.
- Fixed GitHub repository/host, redirects rejected, 24 request / 45 second / 2MiB response bounds, 32KiB input, 2MiB generated files, 100000-byte changed-line budget.
- Secret pattern scan before network includes classic and fine-grained GitHub tokens. This is known-pattern detection, not a universal credential detector.
- Publication metadata cannot clear ACCEPTED_REQUIREMENT or the canonical completion gate.
- Generic arbitrary-file repository.propose_pr limits are unchanged.
- Reverse traceability473 declared surfaces; canonical340 IDs and statuses unchanged (3 VERIFIED,2 IMPLEMENTED_UNVERIFIED,232 PARTIAL,103 MISSING).

## Verification
Full1453, P8 321, focused35 tests PASS, zero failed/skipped. Lint, TypeScript, production build, ledger and reverse validators PASS.
Exact commands/log hashes: [publisher-verification.json](1205/publisher-verification.json).

Independent review found and reproduced two issues: fine-grained credential exclusion and lost-response retry after main advance. Both fixed with RED-to-GREEN regressions. Reviewer reran15 relevant tests and reports no remaining confirmed blocking finding in this delta.
Development RED failures are retained as history: missing initial module, monotonic journal retry, these two review findings. Type/Lint checks also found test globals/parameter annotations, corrected before PASS. No test disabled or weakened.
Existing Next build tracing warning in video-plan-store remains; no Production size/physical acceptance claim.

## Limits / next action
GitHub interactions use a deterministic transport test, not a live production PR from JARVIS. The current main lacks this candidate contract; a live publisher must refuse incompatible/missing canonical base. No existing token was read, created, rotated or configured.
Free-form semantic/coreference review, new canonical-ID allocation, additional intake routes, owner-visible proposal UI and broader reverse audit roots remain software gaps. #1205 and JARVIS remain incomplete.
Prior #1208/#1195/#883/#884 physical-facing merge holds remain. No PHYSICAL/RECOVERY evidence or AGI claim.

## Rollback
Revert the publisher/API candidate together, preserving original Compass receipt/publication metadata. Never delete history to clear a block. No mutable main ref or force push was introduced. Device identity/enrollment/queue/credentials and network policy unchanged.
