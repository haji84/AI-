# Bounded local deliverable continuation

> **For agentic workers:** Use superpowers:executing-plans; continue inline from this existing handoff.

**Goal:** Finish authorized local material deliverables through the existing GORIQ runtime without another manual instruction after each three-cycle chunk.

**Architecture:** Keep Unified Intake / Goal Resolver, Compass, CognitiveService, Core, bounded runner and independent artifact verifier. Expose the existing 1–100 cycle allowance as an explicit local CLI option; retain the three-cycle default and the unchanged HTTP contract. No additional scheduler, controller or production activation.

**Tech Stack:** Existing Node 24 TypeScript, SQLite Compass and local Office codecs.

**Spec:** #1944 comment 7170101968, MASTER.md G0–G2 and docs/architecture/goriq-cognitive-core.md. The owner instructed implementation and isolated verification; simple conversion is not autonomous market research.

## Global constraints

- Preserve 341 requirements, 17 cognition components, R1–R20, Creator plans and staged assets.
- Original #1219 Goal/Job stays NOT_ACHIEVED / G1 HOLD. Do not recreate or mutate it.
- No production/service/configuration/permission/schema changes or external publication.
- No new delegation, control plane, dependency or inference provider. Existing default remains three cycles.

## Task 1: Connect the existing bounded cycle budget

Files: scripts/goriq-cognitive-run.ts; src/gai/cognitive-service.ts; tests/goriq-cognitive-cli-continuation.test.ts; existing reverse-traceability surface hash only.

Interface: CognitiveService.continue(goalId, {maxCycles?: number} = {}); local CLI continue [--max-cycles=1..100]. Validate before execution; HTTP/model inputs cannot select the allowance.

- [x] RED: real subprocess CLI continuation after a one-cycle checkpoint must finish two Office deliverables in one subsequent invocation; invalid budgets fail before DB creation.
- [x] Implement only the optional budget connection and strict local flag parsing.
- [x] GREEN: verify same Goal, independently decoded Office content, exact hashes, no replay, default budget compatibility, pause and contract boundaries.
- [ ] Run focused cognitive tests, canonical validator/reverse audit/inheritance guard, lint/types and required CI. Do not repeat successful unchanged old-head CI.
- [x] Run an isolated non-fixture delivery using supplied public/hypothetical business preparation material; save generated artifacts, process restart evidence, limitations and next work. Do not claim market research or native production acceptance.
- [ ] Save verified results and next action in GitHub and Compass history without overwriting unrelated diagnostic state.

## Review focus

Malformed/unbounded budgets; a paused Goal; changed bound source/contract; real process reconstruction; idempotent verified writes. Preserve all pre-existing gates and result-verification paths. No automatic deployment approval marker.

## Progress

G0: 717c268d exact CI45667164611 all four jobs SUCCESS. Native Node24.19.0: validators341/626, inheritance341/17/20/35 and guard tests12/12 PASS. Git clean before edits; main ea02180e unchanged. Existing PR1945 reused. Native worktree tool did not return; verified no new checkout, then used a Git linked checkout on the same existing PR branch. Compass accessible but points to unrelated stopped #1845 diagnostics; do not replace its state/next action.

G1: PR1764 automatic continuation remains staged/conflicting, PR1832 Remote Lite staged/conflicting and native/permission gates pending, PR1759 shared authority staged/incomplete. No blanket merge. Main already contains local Office conversion, material intake, durable Core resume and independent artifact verification. #1858 execution integration remains exclusive with Core; do not combine controllers.

Baseline/rollback: source HEAD717c268d; source-only changes, existing saved histories and material files retained. Revert this task's service/CLI/test/hash changes together; no data restore or configuration change required.

Task 1 progress: budget regression RED (3 !== 1), invalid budgets RED; minimal connection GREEN. Actual artifact run then exposed Windows SQLite native open failure at a261-character state arbiter path. Ruling: include same-target native path normalization in `src/gai/cognitive-lease.ts` and its existing surface hash — required for actual delivery in this workspace, with no authority or locking relaxation. Regression RED ERR_SQLITE_ERROR -> GREEN, native lease contention retained. Focused runtime/Office/recovery/lease26/26PASS. Separate .NET readback42cells/15texts PASS. Supplied-content conversion and harness-driven process reconstruction are not semantic business autonomy or an unattended scheduler. See docs/evidence/1944-local-delivery for artifact hashes and retained failure.
