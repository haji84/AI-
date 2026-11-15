# GORIQ original-state recovery continuation

> Agent execution: use test-driven implementation and verification before completion. Continue the owner-approved Issue #1219 plan; do not create another Goal or authority.

**Goal:** Identify why the existing G1 scan could not inspect the original state, search the additional source-defined Compass surfaces, and use actual observations to select the next recovery action.

**Architecture:** Extend the existing read-only inventory reached by the protected-main workflow. Keep the current Broker, Controller, runtime stores, security checks and production data unchanged. G3 implementation must bind control, scheduling and progress to the same authority; replacing only the Job store is insufficient.

**Tech stack:** Existing Node.js 24, native read-only SQLite, Node test runner, existing GitHub protected PR and CI.

**Spec:** Issue #1219 owner plan, comment 6857508059; current handoff comment 6886977769. Baseline main `33eb098df543fc7331414a02a717c28c98b37853`, exact-main CI `43624825229` succeeded. Original Goal `goal-fcc81c97e09153f7`, original Job `rotation-recovery-37`.

## Global constraints

- Original Goal remains NOT_ACHIEVED and Issue #1219 remains OPEN until actual acceptance is demonstrated.
- Do not recreate the original Goal, initialize empty Jobs, fabricate history, provision credentials/keys, or alter existing permissions.
- Public output contains only bounded labels, fixed reason codes, counts and boolean findings; no original text, private paths, raw exceptions, DB bytes or credentials.
- Preserve owner/private-file, symlink, size, time and read-only safeguards. No recursive home scan or inferred backup naming.
- No separate reviewer account or mandatory AI09 review. Genuine tests, result integrity, protected checks and Human Gates remain.
- A historical identifier match is a recovery lead, not proof of an authenticated original or complete recovery.
- No source test is reported as original-Goal, actual-model or production execution evidence.

## Review focus

1. Missing file, refused file and malformed data must remain distinguishable without exposing private information.
2. An empty current Goal must not hide retained historical evidence.
3. Exact identifier matching must reject partial strings and unrelated records.
4. Oversized, changed, malformed, aliased and unsafe files must not produce trusted matches.
5. A scan must not mutate SQLite/files or double-count backup generations shared by multiple Compass layouts.

## Task 1: Read-only recovery evidence

**Files:** `scripts/goriq-g1-backup-inventory.mjs`; `tests/goriq-g1-backup-inventory.test.mjs`; a focused history test module if needed.

**Interfaces:** Preserve existing `inspectCandidate`, `candidates`, and `scan` entry points and observation-only fields. Add fixed diagnostic classifications for unsuccessful reads. Add the source-defined standalone Compass layout under the current and canonical checkouts. Report bounded historical ID matches separately from active Goal/WorkRun and verified managed-generation counts.

- [x] Add failing fixtures for missing versus unsafe versus malformed Compass/sidecars; run and record RED.
- [x] Add read-only, bounded fixtures for original identifiers in supported Compass history/verification/state columns while current Goal is absent. Assert exact IDs, private-content redaction and file hashes.
- [x] Implement the smallest diagnostic projection and named-surface extension. Keep `productionGoalRecovered: false`.
- [x] Run the focused inventory tests and existing coordinator/checkpoint/journal regressions. Final related set: 116 PASS / 0 FAIL / 0 SKIP; full local suite has 2 reproduced baseline network-environment failures, documented separately.
- [x] Review diff for output privacy, scope, boundedness and read-only behavior. Independent review reproduced and closed a managed-source reopen race; the final focused set has 27 passing tests.

## Task 2: Protected delivery and actual G1 observation

**Files:** Evidence and current handoff documentation only, plus Task 1 source/tests.

- [x] Record changes, tests, source-only limits, rollback and remaining original-state gaps.
- [ ] Open a PR tied to the existing Issue #1219; use non-closing references.
- [ ] Verify current-base protection, all required checks on the exact new HEAD, unresolved reviews and the task scope.
- [ ] Merge through the protected path within the owner completion instruction; verify exact merged-main CI.
- [ ] Inspect the existing inventory workflow's actual Mac job and sanitized output. Do not rerun the unchanged old scanner.
- [ ] Decide the next permitted recovery action from observed reason codes and history matches. Retain G1 HOLD unless the complete original is genuinely authenticated.

## Task 3: G3 authority boundary

The source audit found that `jarvis-goal-executor`, `CompassGoalExecutionAdapter`, hosted admission and Broker scheduling all depend on local Compass control/WorkState in addition to Job and Change Set storage. Existing encrypted checkpoints do not yet carry this complete control projection. A partial store swap would split authority.

- [x] Trace all actual runtime and scheduling consumers, including sequence/tracked-repair factories and their recovery closure.
- [ ] Select an implementation only after its canonical control import can be specified without inventing original state or authorization.
- [ ] Require one selected authority for pause, blockers, requirements, WorkRun, WorkState, events, budgets and lease fencing. Existing local path remains default; explicit shared failure cannot fall back locally.
- [ ] Verify through the existing execution bridge and Resident host across reconstructed stores, including retained failed candidates and next-Job selection. Fixture data remains fixture evidence.
- [ ] Activate only against a recovered authenticated original and already-authorized store/key/claim; no bootstrap or new secret is implied by this plan.

## Decisions and rollback

The first patch deliberately excludes arbitrary `.bak` discovery and unverified manifest/receipt paths. The pre-fleet backup confirmed in source contains Broker fleet data, not an established original Compass, so it is not counted as a Goal source. Extend only if actual evidence makes that useful.

Reverting Task 1 restores the previous observer; it requires no data migration or restoration because all operations are read-only. Preserve evidence and handoff history even if source is reverted.
