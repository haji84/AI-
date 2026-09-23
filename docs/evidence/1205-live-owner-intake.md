# Authenticated owner intake and specification completion gate (#1205)

Candidate code: e1c261173b7e808ec73e8f745bab732f31cc4753.
Base main: 9cbf6accaec5eb1ec76359a6b88af6bf225eb51e.
PR #1213 remains draft/unmerged. This supersedes the *scope/status assessment* of the earlier repository-only evidence; that historical evidence is retained.

## Verified software path
- Actual loopback HTTP Broker: existing owner auth -> one body read -> durable receipt -> authoritative Goal binding -> exact retry -> process restart -> receipt retrieval.
- Questions/examples remain unadopted. Strict decisions, scope checks, bounded statements/history and conflicting retry rejection.
- Generic Compass state/write-back cannot overwrite or erase authoritative owner receipts; dedicated transactional intake preserves concurrent state.
- Explicit reviewed bindings produce ledger/matrix/history candidates with base fingerprints. Correction/withdrawal, rapid unsynced chains and readoption preserve history and base requirements. Changed old text fails closed. Unadopted predecessor history cannot be rewritten into acceptance.
- Goal Loop, Compass write-back, WorkState and Work Run refuse completion until exact deployed canonical artifacts match owner source, Goal, hash, supersede and withdrawal intent. Canonical rollback reopens the block.
- Reverse audit now covers 469 surfaces including orchestrator/Compass/owner-auth/command routes. Canonical 340 IDs and evidence requirements retained; statuses 3 VERIFIED / 2 IMPLEMENTED_UNVERIFIED / 232 PARTIAL / 103 MISSING unchanged.

## Verification
24 focused, 1442 full and 310 P8 tests PASS, zero failed/skipped. Lint, production build, TypeScript and both ledger/reverse validators PASS. Exact commands, log hashes and timestamps: [live-intake-verification.json](1205/live-intake-verification.json).

Initial Windows full-test attempt failed because bash was absent from that process PATH. Rerun uses the existing Git Bash executable with process-local PATH; no test skipped or weakened. New regression tests initially failed as expected and were fixed. Lint/typecheck found test-only global/nullability issues, corrected before final PASS.

Independent reviewer reproduced lifecycle, stale writer, coercion, readoption and unadopted-history issues; all have regression coverage and the final review reports no remaining blocking finding for this candidate scope.

Existing build warning: src/jarvis/video-plan-store.ts dynamic filesystem tracing. Not introduced here; build succeeds, no deployment-size/production acceptance claim.

## Remaining software and physical work
- General free-form adoption/coreference/semantic conflict resolution (current matcher is suggestions only).
- New Requirement ID proposals integrated with frozen inventory and evidence policy.
- Bounded review-artifact publishing/PR workflow; current endpoint returns a candidate, does not create/merge a PR.
- Additional intake routes and owner-visible proposal workflow; runtime receipt state remains acceptance history, with canonical synchronization revalidated at completion rather than a model-set synced flag.
- Broader provider/media/application reverse inventory. 469 is the declared boundary, not whole-repository completion.
- Main/production activation and existing-device acceptance; all prior #1208/#1195/#883/#884 physical-facing holds remain.

No device enrollment, identity, credentials, permissions, firewall, paid API or schema change. No PHYSICAL/RECOVERY claim. JARVIS and #1205 remain incomplete.

## Rollback
Code and receipt/completion contract must roll back together. Preserve Compass SQLite and original owner history. Never delete receipt rows to make completion pass. Stop dependent execution before reverting to an old runtime without the completion gate. Production was not changed.
