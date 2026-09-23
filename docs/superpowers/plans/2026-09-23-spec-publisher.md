# Reviewed specification publisher implementation plan (#1205)

**Goal:** Authenticated saved owner requirements produce a resumable Draft PR with exact source/base proof, no merge/deploy authority.
**Spec:** Issue #1205; docs/architecture/jarvis-requirement-traceability.md.
**Baseline:** c132b0c; main9cbf6ac. Existing identities, runtime settings and physical-facing PR holds preserved.

## Design / ruling
Generic repository.propose_pr stays at 3 complete files / 100000 bytes and is untouched. A separate typed specification operation accepts only decision ID + reviewed existing-ID fingerprints + repository issue URL. It regenerates the three canonical files internally, caps serialized review input at 32KB, changed lines at 100KB, generated output at 2MiB and fixed-host GitHub requests at 24 / 45s / 2MiB per response. This is not an arbitrary larger file writer. It creates only Draft PRs; CI/review/main/deploy remain separate.

Use existing already-authorized GITHUB_TOKEN only. Missing token fails visibly. No new token, permission, workflow, paid API or secrets operation. Read/write requests go only to api.github.com/repos/haji84/AI-; no redirects. Validate source issue and canonical base content before remote writes. Secret audit before egress. Persist publication plan in the protected receipt envelope, retain deterministic branch, never force/update main, and verify retry branch/PR metadata. Successful publication is not canonical sync.

## Tasks and tests
- [ ] Test RED typed publisher contract: strict input, no credential route, successful draft, stale base, timeout/response cap, retries and conflicting branch.
- [ ] Implement scripts/jarvis-spec-publisher.mjs + .d.mts; dedicated OwnerRequirementIntake publication metadata; real Broker owner-auth POST publish and browser-owner proxy route. No request-supplied token/host/files.
- [ ] Test actual HTTP missing auth/missing existing GitHub token; exercise GitHub adapter with deterministic fake transport and persisted Compass restart. No external test PRs.
- [ ] Update requirement refs, ADR, reverse mapping and state-only bookkeeping. Run focused/full/P8/lint/type/build; independent review.
- [ ] Update existing PR #1213, exact-head CI and GitHub/Compass write-back. Preserve missing free-form/new-ID integration and physical holds accurately.

## Review focus
1. Timeout after branch/PR write must resume without force push or duplicate.
2. Remote canonical base differs even when requirement ID matches: refuse.
3. Superseded receipt while publishing: refuse further mutations, preserve attempt.
4. Arbitrary files/repository/credentials/redirects cannot expand scope.
5. PR creation and job success must not satisfy specification sync or functional evidence.

Rollback code and its dependent contract together; preserve receipt/publication history. Stop dependent execution before returning to an unenforced runtime. No live production mutation in this development cycle.
