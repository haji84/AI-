# G1: read-only diagnostics, historical leads and stable verified snapshots

Issue: [#1219](https://github.com/haji84/AI-/issues/1219). Owner Goal `goal-fcc81c97e09153f7`; Job `rotation-recovery-37`. Baseline protected main: `33eb098df543fc7331414a02a717c28c98b37853`. Date: 2026-11-15 UTC.

## Acceptance boundary

This is an observer correction, not original-state recovery or production activation. G1 remains HOLD, the original Goal remains NOT_ACHIEVED, and Issue #1219 stays OPEN. Source tests, private fixture matches and historical identifier leads do not establish an authenticated original Goal/Job.

The latest owner handoff is [comment 6886977769](https://github.com/haji84/AI-/issues/1219#issuecomment-6886977769); the controlling completion plan is [comment 6857508059](https://github.com/haji84/AI-/issues/1219#issuecomment-6857508059).

## Previously observed runtime evidence

- Baseline exact-main [CI 43624825229](https://github.com/haji84/AI-/actions/runs/43624825229) succeeded in all four jobs. This certifies only that source revision.
- Existing [inventory run 43624825220](https://github.com/haji84/AI-/actions/runs/43624825220) was cancelled overall, while its [Mac job 132538213215](https://github.com/haji84/AI-/actions/runs/43624825220/job/132538213215) succeeded. The ZBook job was cancelled.
- Actual sanitized Mac output: 7 candidates, 0 checked managed generations, 0 matching Goal backups, 0 matching WorkRuns, `productionGoalRecovered:false`. Five candidates reported `NO_MANAGED_BACKUP_ROOT`; two reported `ALTERNATE_COMPASS_ONLY`. All active summaries were null and all Job/Change Set sidecars were unavailable.
- The old result erased missing, refused and malformed reads into the same absence of a summary. It did not inspect historical JSON records or the standalone Compass layout. That result therefore cannot prove that the original state is absent elsewhere.

## Implemented changes

1. Add fixed diagnostic reason codes for missing, unsafe, access-denied, malformed, unavailable-schema, changed, budget-exhausted and pending-journal observations. Preserve the existing successful result fields. Do not publish paths, raw errors, private text or bytes.
2. Inspect source-defined JSON columns in default state, history and verification records. Match only exact structured `goalId`/`jobId` properties; prose, partial identifiers and unrelated keys do not match. Mark every result `HISTORICAL_LEADS_ONLY` and `authenticatedOriginal:false`.
3. Bound each historical table to 100 rows and 1 MiB of selected JSON, each JSON traversal to depth 32 and 10,000 nodes, and retain the existing cooperative scan time budget. A row/byte/structure refusal is an unconfirmed range, not a complete zero-match result. The workflow timeout remains the outer execution bound.
4. Add the source-defined standalone Compass locations for the current and canonical checkouts. Do not enumerate managed generations again for those candidates. No recursive directory search is introduced.
5. Observe live SQLite only through bounded private temporary copies of stable DB/WAL files. Check owner, private mode, regular-file/single-link status, no aliases, size and before/after identity. Keep the source DB/WAL/SHM out of SQLite connections. Refuse a rollback journal or concurrent metadata change, without retries; remove temporary copies after observation.
6. Inspect a managed generation from the exact bytes whose manifest digest was verified. Produce its Compass summary in that same private snapshot and transaction. Never reopen its original source after verification and never incorporate unmanifested sidecars.

Managed-generation matching retains its prior meaning: current Goal and WorkRun projection from verified generation bytes. Historical findings inside generations are not added to the top-level historical-lead count by this patch.

## Reproduced defects and verification

The implementer first ran the previous source against the new diagnostic/history fixtures: 10 existing tests passed and 7 new assertions failed. Additional real SQLite fixtures reproduced source SHM read-mark changes despite read-only SQLite options, handling errors for empty WAL/pending rollback journal, and acceptance of unmanifested managed sidecars.

Independent review reproduced a further verification-to-inspection race: after the managed manifest was checked, inserting the selected Goal into a new unmanifested WAL left the main database digest unchanged but yielded `backupGoalMatches:1`. A committed regression first failed (`11 PASS / 1 FAIL`) against that implementation. The correction consumes the already verified bytes and returns their summary, so the later WAL contributes no match.

Fresh focused verification after the review correction:

```sh
node --test tests/goriq-g1-backup-inventory.test.mjs tests/goriq-g1-history-inventory.test.mjs
```

Result: 27 PASS, 0 FAIL, 0 SKIP. An independent reviewer repeated this command with the same result and closed the sole important finding. Tests include unchanged source DB/WAL/SHM hashes, committed WAL reads, private output redaction, exact-ID matching, unsafe/malformed inputs, bounded refusals, standalone candidates and the managed snapshot race.

Additional fresh local verification on Node 24.22.1 with the pinned pnpm 11.19.0 dependency install:

| Check | Actual result |
| --- | --- |
| Inventory plus coordinator, Change Set journal and read-fence regressions | 116 PASS / 0 FAIL / 0 SKIP |
| Repository ESLint | exit 0 |
| TypeScript `--noEmit` | exit 0 |
| Next production build | exit 0 |
| Full Node suite, concurrency 2 | 3,984 tests: 3,956 PASS / 2 FAIL / 26 SKIP; 239,017.748851 ms |
| Unmodified baseline network module | 1 PASS / the same 2 FAIL / 0 SKIP |

The two full-suite failures are `tests/jarvis-network-local-runtime.test.mjs`: the configured-LAN fixture encounters `uv_interface_addresses` system error 1, and the private-ingress fixture cannot observe retry-budget exhaustion. Running that unchanged module on baseline `33eb098` in the same workspace reproduces both failures. These local failures are not a green full-suite claim; the published exact new-HEAD hosted CI must pass without disabling either test.

The 116-test command is:

```sh
node --test tests/github-coordinator-store.test.ts tests/github-change-set-journal.test.ts tests/github-change-set-read-fence.test.mjs tests/goriq-g1-backup-inventory.test.mjs tests/goriq-g1-history-inventory.test.mjs
```

The initial exploratory all-tests run was not acceptance: PowerShell was absent and source work was still in progress. PowerShell was subsequently installed only in temporary tooling from the official release with its published SHA-256 verified; dependency versions and repository test gates were not changed. Exact new-HEAD CI and the fresh actual Mac scan remain pending at source publication.

## Original-state provenance investigation

Historical [Issue #1218 comment 6596993174](https://github.com/haji84/AI-/issues/1218#issuecomment-6596993174) and [Issue #1219 comment 6595822446](https://github.com/haji84/AI-/issues/1219#issuecomment-6595822446) report the selected Goal being created in an isolated Broker on November 3 and its evidence retained in private handoff directories. This is a historical report and recovery lead, not a current authenticated readback. It does not establish that the live Mac Broker ever held the original.

The named private handoff root is absent in the present workspace. Six existing GORIQ source/CI packages were inspected through the available file service, including their two nested CI archives. All six archives passed CRC checks; all 80 manifest-listed file hashes matched. They contain source, fixtures and source-CI evidence, with no original SQLite/state/Job/Change Set payload and no new reference to the reported isolated retention directories. This bounded search does not establish global deletion or absence from an inaccessible past environment.

## Next observation and rollback

The unchanged protected-main inventory workflow already watches this observer source. After protected PR integration and exact-main CI, inspect its fresh actual Mac result. Distinguish MISSING from UNSAFE_PATH/ACCESS_DENIED, and distinguish incomplete historical scans from true checked zeroes. A candidate match requires separate authenticated correlation of contract, DoD, approval, pause, WorkRun, Job, Change Set, attempts, receipts and artifact bytes before recovery.

No runtime adapter, credential, key, permission, branch rule, workflow or production state is changed. Reverting the three observer/test files restores the previous observer without a data migration. Retain this evidence and the handoff history.

G3 audit also found that a Job-store replacement alone would split authority: executor, execution adapter, admission and Broker scheduling all consult local Compass control and progress. Safe source continuation must cover those boundaries together and refuse incomplete imported authority. Original-state absence must never be repaired by inventing a replacement Goal or empty history.
