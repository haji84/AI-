# #1950 bounded Windows snapshot replacement

Current owner Goal: #1944 comments7188751595/7170101968, parent #681/body #921. Re-read GitHub before starting/resuming. This follows the real native `jobs.json` EPERM failure in #1948; it does not resume old #1219 or unrelated #1845 diagnostics. Existing linked worktree reused; parent PR1949 remains isolated at19c52074 while its exact CI finishes.

Use executing-plans inline and TDD. No approval menu for authorized LOW source work.

1. Preserve original86-case run (85PASS/1EPERM) and unchanged isolated rerun1PASS. The executor failed during atomic snapshot replacement before inference, with Job PLANNING/calls0. A rerun is not stable persistence proof.
2. RED real Job-store fault-injection regressions: transient Windows EPERM while a complete old snapshot remains visible and the write lease stays held; persistent EPERM bounded failure preserving old bytes; unrelated errors and non-Windows EPERM no retry.
3. Small shared replacement helper for Job and ChangeSet snapshots, whose existing rename paths are identical. Retry only Windows EPERM, same temporary/destination bytes, at most5calls and10/20/40/80ms delays. Keep the original write lease and all identity/history/stale validation. Never delete/truncate destination, change ACL/ownership/schema/deadlines or restart/re-infer anything. Persistent errors retain existing visible failure behavior.
4. GREEN store tests and relevant resident/stop contracts; native authenticated Broker profile+sequence restart with unchanged existing deadlines. Full exact-head CI, one fresh read-only branch review, protected merge/current-main CI. No repeat broad Windows suite absent a new reason.
5. Reconcile only affected fingerprints; preserve341/17/20/35. Save original failure, test/review/CI evidence and actual next body task on GitHub. No full product/model/physical completion claim.

Rollback source helper/call sites/fingerprints together; keep evidence. No canonical Goal/Job/attempt reset. Model experiments from#1948 remain consumed. New provider/quota/production activation is outside this fix.

Execution ledger: real Job-store fault injection reproduced transient EPERM and persistent-no-retry RED. The shared ChangeSet path exposed another concrete RED: its in-memory map published the new ChangeSet before the atomic rename, including after permanent failure. Delay that single cache update until successful commit; keep the complete old bytes and cached record visible during denial. This is part of atomic snapshot semantics, not a new state controller or storage migration.
