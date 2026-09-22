# Reverse specification audit (#1205)

Repository-only candidate slice, not whole-issue completion.
Code: 0e55e4d7b84ee5bda505af7d35e22bb5ed445e99; source main: 1ba440a4daf1bc2e1ffb20088d42b07fc62d21fa.

## Scope and findings
- 346 declared surfaces: 299 canonical-owned implementations, 25 internal details, 12 historical documents, 10 separate Research Ops surfaces.
- New/changed/removed files, unknown requirement parents, unsafe or missing exclusion references fail the existing CI test path.
- Source hashes normalize Git UTF-8 CRLF/LF differences, retaining raw binary hashes. Representative hashes matched Git blobs in independent review.
- Product research routing/executor remain mapped to AUTO-010/CORE-012; scientific Research Ops evidence stays separate.
- Accepted owner decision from #1205 is source-linked and mirrored into existing CORE-015/GOV-025, without creating duplicate requirements or changing requirement statuses.
- Missing accepted-decision sync, deleted/demoted history, nonreciprocal/cyclic supersedes, excerpt hash mismatch, unsupported VERIFIED and protected changes fail visibly.
- This is a reviewed repository contract: a source URL/hash does not authenticate an arbitrary runtime caller.

## Verification
10/10 targeted tests; 1428/1428 full tests; 296/296 P8; lint/typecheck/build PASS. Canonical validator 340 PASS; reverse audit 346 PASS. Machine-readable commands/counts/log hashes are in [verification.json](1205/verification.json).

Independent review identified and resolved CRLF portability, accepted-history deletion/demotion, shared research classification, broad test-path exclusion and invalid exclusion reference defects. No unresolved blocker for this repository-only slice.

## Open work — #1205 remains open
Authenticated live conversation ingestion, semantic requirement matching/conflict resolution and automatic specification PR creation are still missing. The validator is integrated into node --test/CI; it is not a live chat synchronization engine. Extend reverse audit beyond the explicitly declared roots (remaining orchestrator/providers/owner-auth entry points) before claiming repository-wide coverage. Unmerged #1204/#1208/#1195/#884 content is not main implementation.

After incorporating parallel main PR #1212 (9cbf6accaec5eb1ec76359a6b88af6bf225eb51e), current ledger status is VERIFIED 3, IMPLEMENTED_UNVERIFIED 2, PARTIAL 232, MISSING 103. The UI-007 change belongs to that main PR; this audit does not promote statuses. Parent ownership of a file does not imply feature completion. No PHYSICAL/RECOVERY status promotion, fleet registration/configuration change, merge or production deployment.

## Next cycle
Finish #1205 live intake-to-reviewed-spec proposal integration with authenticated owner provenance, preserved Human Gates, durable supersede history and execution-completion gating. Reconcile staged specification additions separately and revalidate their exact combined base. Keep #1208 existing-device acceptance and all prior physical-facing merge holds.

## Rollback
Revert this candidate branch's checker/index/decision records together; runtime device data is untouched. Do not delete canonical requirements or original decision history as a shortcut to pass checks.

Latest-base validation: source main 9cbf6accaec5eb1ec76359a6b88af6bf225eb51e merged without losing either ledger. Targeted10/10 and reverse346/canonical340 validation passed; PR CI must cover the exact combined head.
