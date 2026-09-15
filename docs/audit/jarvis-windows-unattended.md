# Windows unattended readiness (#685)

Parent: #681. Baseline main: `1e364e1bb82c487474487b3ef26003c5af6ed119`.

## Verified software change

The old Ready+BootTrigger predicate accepted a task that could require interactive login or stop when AC disconnected. The new read-only collector/predicate checks enabled trigger, owner identity, Password logon, Limited execution, a single exact Node action/working directory, battery/offline settings, bounded restart and duplicate prevention. Unknown properties fail closed. Diagnostics do not echo raw actions or secret-bearing arguments. No task or credentials were changed.

Validation on Windows/Node 24.19.0: 7 focused tests PASS; full suite 687/687 PASS, zero skipped; lint PASS; PowerShell parser PASS. Regression cases cover interactive/S4U/elevated/unknown principals, disabled/missing actions, wrong executable/folder, secret-bearing extra arguments, battery/network restrictions, unbounded or absent restart and duplicate instances.

Read-only execution on this machine produced explicit startup failures and overall exit 2. Tailscale executable was not available. This is successful failure detection, not successful unattended operation. PHYSICAL and RECOVERY remain unverified. BIOS/UEFI and battery duration were not tested.

## Boundaries and next work

The historical installer is intentionally not rewritten to silently store credentials or change account privileges. Prepared owner Task Scheduler instructions are in the power recovery runbook. Continue independent P3 session/live-view work before requesting a physical gate. Main CI queries for #682/#684 have returned no runs; a later alternate fetch encountered a connector transport error. Do not infer successful main CI or deployment.

Risk LOW/MEDIUM: diagnostics and tests only, with no new permissions, listener, database or deployment behavior. Rollback by reverting this PR. Fix attempts: 0 at initial verification.
