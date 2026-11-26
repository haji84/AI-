# #1858 unchanged-baseline restart recovery

## Observed incident (2026-10-23 JST)

The approved activation on main `75100488cdde6b58e5b4ed1bb72c654faefc7b5f`
stopped the identified old GORIQ host, then failed with `HANDLE_REJECTED_32`
before ACL or pointer writes. The existing durable restore failed at the same
write-capable handle acquisition. The particular target/lock owner is unknown;
do not infer that another process should be killed. Restore's mutation flag is
set before acquisition and does not prove an ACL write occurred.

The saved transaction is `bde347b3c55a4db1af3bd63e9528d464`, originally created by
helper SHA256 `025e2cb455b4ff8727aff5e5cac83c9bc67b3edf4c53b7343807de779741f7ed`.
Keep the encrypted backup and its source proof unchanged.

## Minimal alternate recovery

`-Phase restore -RestartUnchangedBaseline` is a separate fail-closed controller
inside the existing helper. Only the exact incident backup/source/helper above
can use it. The executing controller still has its own independently pinned
hash and clean source revision. Default restore keeps its same-source rule;
forward source authorization is unchanged.

The controller reuses DPAPI, owner/admin, native path, ancestor guards, task XML,
expiry and state preservation checks. It requires all five objects to equal the
saved baseline in path, type, file identity, full security descriptor and byte
hash. It verifies that the installation is stopped, then starts the existing
named task once. Config and launcher are retained under read-only, FileShare.Read
locks through startup and verification; existing/new writers are refused.
It performs no stop, ACL or pointer writes and has no fallback
to ordinary repair. Only verified old revision health, owned services, preserved
state and a second five-object comparison allow clearing the transaction marker.
Otherwise it retains reconciliation state and never declares restoration.

Authority remains the owner-approved fixed-five-object #1858 recovery scope,
proposal `b1bfc50a28f7fd65b4c8819ae3da10f98e4739b217abb9115430d04a105866a7`.
Recovery ends 2026-10-23 23:59:59 JST. Independent review and successful PR/main
CI are required before native execution. No new permission or deadline is added.

## Verification and limits

Windows PowerShell 5.1 executes the actual resume controller against isolated OS
adapters. The regression first failed on the old controller (`BACKUP_REJECTED`),
then passed with one start, no writable-handle acquisition, and marker retention
on wrong provenance, baseline, stopped state or failed post-start verification.
Existing transaction/process refusal and Node activation-scope tests also pass.
Independent review found a pointer TOCTOU risk. A failing writer-lock regression
was added before the fix; the actual read-lock function now passes real Windows
file tests for allowed readers, blocked existing/new writers and byte drift.
The existing Windows CI includes this resume fixture; no workflow change is needed.

CI and native outcomes are recorded in Issue #1858. This document is preparation,
not evidence that production recovered or completion-path activation succeeded.
Rollback the code through reviewed revert; preserve the incident backup and
marker until verified recovery. Reverting code alone does not restart services.
