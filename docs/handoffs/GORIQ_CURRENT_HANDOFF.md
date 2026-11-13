# 2026-11-13 GORIQ #1219 current continuation: Linux defunct-owner and shared Change Set version fence

**Active source candidate** follows protected merged main `0c5663fe8438ee2ce00610aeb809cac8d1e37deb`; this documentation creates a fresh branch SHA. Read exact HEAD and CI before claiming acceptance. Existing Issue #1219 remains OPEN. Original owner Goal `goal-fcc81c97e09153f7` / Job `rotation-recovery-37` remain unverified against live source, never recreate or reset them.

## GitHub evidence and observed failures

- PR #1910 is merged; main `0c5663fe8438ee2ce00610aeb809cac8d1e37deb` is still source integration only. Post-merge CI [#43347849350](https://github.com/haji84/AI-/actions/runs/43347849350) FAILED on exactly this SHA: Unit 3,907 tests, 3,880 pass, 1 failure, 26 existing skips; Integration 3,881 passed / 0 failed; Lint, Typecheck, P8 Security and Build passed. Unit failed in `tests/autonomous-tracked-repair-runtime.test.ts` around the Broker restart scenario with `execution_writer_busy_retry_budget_exhausted`, Job stuck VERIFYING. This is NOT a timeout or code-review prerequisite.
- Confirmed independent Linux OS edge case: `process.kill(zombiePid, 0)` reports success for a defunct unreaped process (state Z), but that process no longer owns the native SQLite arbiter. The old `src/gai/cognitive-lease.ts` denied a fresh same-host writer with EEXIST; a local original-vs-candidate real-zombie process test confirmed RED / GREEN. This alone does not prove the exact CI PID was a zombie. Live/foreign/invalid/unknown owner exclusion must remain fail-closed.
- Existing `scripts/goriq-github-change-set-journal.ts` allowed a stale read caller to overwrite newer Change Set state with a later timestamp. Prior offline package `GORIQ_verified_read_fence_candidate_20261113.zip` recorded RED: 19 failures out of 48, then GREEN: 48/48, Node22 source fixture tests. In this continuation the same 48 tests passed locally again, no synthetic Goal/secret/remote write.

## Bounded implementation in this source candidate

1. `src/gai/cognitive-lease.ts`: Linux-only /proc PID-and-state check after kill(pid,0) succeeds, recognizing only exact-identified Z/X/x defunct states; missing/malformed /proc or any live/foreign/unknown owner still rejects. Existing OS SQLite writer exclusion, 2s bound, metadata verification and lock release are unchanged.
2. `tests/cognitive-lease-defunct.test.ts`: proc-state parser and live/foreign owner refusal. Real Python-owned zombie fixture was also executed locally in a disposable directory; under old code EEXIST, under candidate recovery succeeds.
3. `scripts/goriq-github-change-set-journal.ts`: require a caller's get/list-observed exact candidate version before a status update. Snapshot identity, Goal contract digest, per-attempt previous record, current root CAS, role fencing and deterministic failure semantics remain. A failed conflict/unknown outcome requires a new successful read. New identities remain limited by the already-required canonical binding / controller authority.
4. `tests/github-change-set-read-fence.test.mjs` adds stale-read/overlap/concurrent/unknown-outcome cases; `tests/github-change-set-journal.test.ts` adds a benign read in one deliberate reconciliation regression without removing its assertions.

Local evidence applies ONLY to this source/partial Node22 environment: cognitive-lease three tests PASS, original real zombie denial reproduced, candidate real zombie accepted, shared-store 48/48 pass. Full pinned Node24 CI on the final branch HEAD remains required. No separate reviewer/account or AI09 code approval is required.

## Remaining owner Goal acceptance

1. New exact-source PR CI; if Unit fails, inspect logs and reconcile Broker child shutdown, native lock and actual PID lifecycle without manufacturing successes.
2. Source merge only after applicable checks/security/risk gates; protected-main CI for the exact merged SHA.
3. Authenticate original owner Goal/Job and actual active state store: prior targeted owner Broker read was HTTP404, which **does not prove original Goal deletion**. Verify canonical route/version/store, not GitHub comments alone.
4. Authorized existing key, controlled state branch/freshness floor and original-state import (no fabricated bootstrap); bind actual Broker/GoalController/Resident to the existing encrypted coordinator/WorkRun/DevelopmentJob/ChangeSet adapters with pause, budget, Human Gates and downstream side-effect fencing.
5. Demonstrate actual GitHub Actions A -> distinct run B restoration, old owner rejection and no double effects, genuine AI failed output -> new authorized repaired candidate -> checked result, automatic next Job, artifact digest and behavior verification. All are unproven until real runtime evidence exists.

No production service restart/deploy, credential, key, permission, state branch, owner Goal, billing or branch-rule changes in this patch. Rollback reverts exactly its four changed/new source/test files (handoff/evidence kept). Older reference records follow verbatim below.

---

# GORIQ #1219 current handoff: shared candidate persistence and selected-read diagnostics

2026-11-13 JST. Existing PR #1910, branch feature/1219-github-coordinator-store-20261112. Parent e870bc4b17f3fdc8e34ad04b63be0c92f09f8be3; main8ead188ffc374c0204f20798ac8258af07272bdc. This commit creates a new SHA and requires its own complete CI. Full previous handoff preserved byte-for-byte in GORIQ_HANDOFF_e870bc4_ARCHIVE.md, Git blob5233e9d7dce3760c147232ae024945aee440b487; older archives retained.

## Owner requirements
No permanent MacBook/ZBook for ordinary hosted work. No second account or mandatory independent CODE review/AI09 approval. Preserve actual tests, result authentication/integrity, scope and privileged Human Gates. Original Goal goal-fcc81c97e09153f7 and Job rotation-recovery-37 must not be fabricated/recreated or falsely completed. Keep Issue1219 open. Do not add a second controller, paid provider, Codex/Copilot/CodeRabbit requirement, key/token/scope or changed permission to bypass a gap.

## Delivered in this continuation
1. Shared Change Set journal and typed existing-resident persistence factory at e870bc4. It retains rejected/repaired candidate metadata in existing checkpoint events and uses the same fenced root CAS. No local fallback. Missing authenticated import marker is HOLD, not an empty original. Parent CI43339656600 completed SUCCESS. Exact source/test documentation: docs/evidence/1219-20261113-shared-changeset-journal.json. Local25PASS includes a fresh Node-process recovery of rejected metadata, not actual Actions or actual AI.
2. The already authorized read-only owner probe erased every selected-Goal fetch failure into GOAL_RUN_NOT_AUTHENTICATED_OR_FOUND, making the real user-dispatched run43187031257 ambiguous. Now retain only readFailure={kind:TRANSPORT|HTTP|BODY|SIZE|JSON,httpStatus:100..599|null} on that existing Goal read or repeated Job-read failure. No response text/header/URL/exception/credential is printed. Original HOLD reasons, exact loopback/GET-only endpoints, redirect rejection, request count, size bound, six-second request deadline, owner authentication and authority checks remain. Valid readback output stays unchanged. No additional request, retry, endpoint, state access or permission was added.

## Proof
Selected-read tests RED:18FAIL/3existingPASS, then21PASS/0FAIL/0SKIP. Combined with shared-journal25:46PASS/0FAIL/0SKIP on local Node22.16 partial snapshot. Full repo test/typecheck NOT claimed locally. Exact new HEAD CI is required. Transport responses and checkpoint storage are fixtures; no new actual production Goal read has yet happened. Probe source blob beb88b910144d162c88854d90f5ac74c14b3f5bd; test blob18f6a612a55e75ffb7c97ed624ae068e9c1c6074.

Earlier parent1ba7fa6 CI43331778190 all4PASS, artifact13996126643 SHA256ffaee8205672bf03f9ad5a0a54e2a3a1eb0a5d0ed3b37b87dfe5a0d9ef350650 independently downloaded/audited for source, signature, six hashes, exits and cleanup. Unit294339ms/Integration295444ms at unchanged300000ms with3835PASS/0FAIL/26existingSKIP. This is historical fixture evidence with little timing margin, not a proven permanent performance remedy or production permission.

## Verified production prerequisites and remaining execution
Connected GitHub GET git/matching-refs/heads/goriq-state/ returned [] on this continuation. Thus no branch matching this adapter's required prefix is currently observed; a different possible authorized store is not ruled out. No live key configuration or authenticated original snapshot has been demonstrated. Do not create keys, invent permissions or silently bootstrap a replacement original. Plugin discovery returned no direct GORIQ/Compass action in the available search, not proof that no external implementation exists.

After exact new-HEAD CI, perform ordinary source integration only through the existing protected PR path and check exact merged-main CI. Required GitHub ruleset21173944 has project-checks/repository-guard, strict base policy, zero required approvals and no bypass; do not fabricate a review or waive checks. New source remains optional; source integration alone does not activate the hosted backend.

The original targeted workflow_dispatch run43187031257 already contains the user's correct Goal/Job. Only after this bounded diagnostic is on a verified protected main may its failed owner-broker job be retried to inspect actual failure kind/status using existing credential scope. This is one-time recovery of existing original state, not a permanently required Mac or a request for new manual inputs. Do not retry unchanged generic checks or count health as Goal readback. Do not run the old read-only fleet DB inventory as a Goal lookup: it inspects fleet records, not Compass Goal.

Then resolve actual source/store binding, authenticate/import original complete Goal/WorkRun/Jobs/Change Sets/attempts/receipts and artifact BYTES, connect the approved shared state/key/freshness anchor and canonical runtime factory, and prove different Actions executions restore the same history and reject stale writers/duplicate effects. Real model failed candidate -> different authorized repair -> result validation -> automatic next Job -> verified artifact/behavior is still NOT_ACHIEVED. These must be proved separately from source CI.

No live Goal/Job state, service, secret, permission, workflow, state branch or paid service was modified in this diagnostic source change. Rollback reverts only the probe error projection and tests; no production data migration exists to reverse. GitHub documentation is handoff context, not runtime authority.
