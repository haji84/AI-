# ZBook native view verification and ACL renewal candidate

Issue #1662, parent #1219/#681. Observed 2026-10-08. ACL renewal status: **PENDING separate owner permission gate**. The existing runtime/enrollment expiry is unchanged at 2026-10-08T22:33:43Z. This document and candidate code do not grant permission to execute ACL repair.

## Corrected diagnosis

The first elevated plan on exact main `43a3634f20694559652a83a97131091bc412b8e2` stopped at `compatibility-launcher`. Its inferred active-launcher mismatch was incorrect. Read-only handle-level inspection showed different physical files behind the logical AppData path:

| Context | Physical view | SHA256 | Delegates to native launcher |
| --- | --- | --- | --- |
| Codex child | package overlay | 5F22C365464CA0C25479334138E7C52A54C31EC40434AC0A59C15930E0622135 | false |
| Same-owner Windows native child | native AppData | 27F8AFB66AC4DC5A241CADE217C9E6C19B16DC316F84D6D3D08257DB90C72A36 | true |

Both package-identity API queries returned 15700 (no package identity). That API alone is therefore insufficient to establish the effective file view. No launcher repair is needed. The native process was created using the existing Windows process capability; elevation still used ordinary UAC. No task registration or permission change occurred.

The native same-owner administrator plan then passed at 03:32:30Z, exit 0. Exact main CI 37722273129 succeeded. Unchanged runtime helper verified schemaCompatible, quiescent, nativeLauncherSupported and taskUnchanged; Android count 38, identity count 40, identity digest `5051a047b2b161462467868efd296d78bbec0dcadb9806ea5e7e92f3ca9c7560`. Existing runtime is `a49c458d69a28c0266be8fcad5b26253e5ed8d75`; one owned host process tree owns four service ports. This is plan evidence, not update/reboot/fault-recovery acceptance.

Issue receipts: [diagnosis correction](https://github.com/haji84/AI-/issues/1662#issuecomment-6051609037). Sanitized local receipts are under `tmp/goriq-1662-preflight-20261008/`; private configuration was not exported.

## Exact permission proposal

Apply still requires Owner/SYSTEM-only access. A single additional read-only local account/group entry, whose translated name identifies Codex or sandbox use, is explicit on the owner-profile `JARVIS` root and inherited by production, releases, active release, config and launcher. It is not authority to weaken the updater's access guard.

Prepare the existing reviewed `goriq-zbook-owner-acl-repair.ps1` for one operation before 2026-10-08T22:33:43Z: remove only its strictly selected additional read-only root ACE and allow normal inheritance to update descendants. The only code changes are the expired cutoff and the exact observed active release literal. The root, selection predicates, denial rules, backup, postchecks and rollback remain unchanged. No recursive ACL reset or added permission. If required, separately authorize ownership normalization of the newly created DPAPI ACL-backup file from Administrators to the current Owner while preserving its exact DACL and encrypted contents; this is not a general owner repair.

Before execution: explicit separate permission approval, reviewed protected merge, successful exact-main CI, SHA256-pinned artifact, same-owner native file view, UAC, fixed active release, one exact matching candidate on all existing guarded surfaces, running Limited/Password task, unchanged config/launcher baseline. The operation keeps the encrypted original root ACL locally, verifies runtime health/four listeners/config and launcher hashes after narrowing, and restores the original root descriptor on failure. No service stop, DB/schema/key/config/task/network change occurs in this ACL operation.

If Codex or another external actor restores the entry, stop and report that event rather than repeatedly removing it or relaxing the guard. Do not modify Codex sandbox settings, policy, or account membership. The separate approved runtime refresh may run only after its own current-source, expiry, state, process and strict-ACL checks pass.

## Validation and limits

Existing Windows PowerShell 5.1 selector/backup fixtures pass without ACL mutation. The native read-only plan is verified; ACL mutation is not approved or performed. The broad GORIQ physical E2E and cognitive/requirements program remains incomplete. Nubia stays deferred.

## Approved ACL result and runtime-launch diagnosis

The historical pending status above was superseded by [explicit owner approval at03:43:11Z](https://github.com/haji84/AI-/issues/1662#issuecomment-6051718256), with the same expiry. PR1742 merged as `0fa99a5ef7049ed8f1052071b4b1dcaefaf887a7`; main CI37724076947 passed. The pinned repair artifact ran after fresh native UAC plan. Machine receipt at03:49:32.5161571Z: strictSurfaces=7, aclTargetRootOnly, backupCreated, backupProtected, backupOwnerNormalized and runtimeUnchanged all true. Original encrypted ACL backup remains on host. No second ACL removal is authorized if an external actor restores it.

Runtime refresh attempt1 reached dependency install but had no final verification receipt. The caller reported incomplete at03:52:12Z. Its exception detail was not retained, so the exact original exception cannot be reconstructed. Old runtime `a49c458d` remained healthy and the task Running; no quiesce/activation stage was observed. The unactivated immutable `0fa99a5e` candidate is retained. A separate build-only diagnostic subsequently returned exit0 at03:58:10Z and preserved build warnings on stderr. That result is not production activation.

A Windows PowerShell5.1 disposable child fixture reproduces `NativeCommandError` when the former caller combines streams under ErrorActionPreference=Stop, even though the child only emits a stderr warning and exits0. The new owner-invoked `goriq-pc-runtime-launch.ps1` preserves stdout/stderr separately using Start-Process -Wait and validates both the actual child exit code and a complete typed success receipt. A real exit9 and incomplete/source-only receipts fail. Logs are unique and never overwritten. The launcher cannot authorize an operation: the existing runtime child retains every source/CI/expiry/Owner/ACL/process/state/activation/rollback check unchanged and defaults to plan. Use from the native same-owner context already established above.

The first fixture was RED (missing helper), then exposed unavailable process ExitCode with a bare WaitForExit call; Start-Process -Wait fixes that real Windows behavior. Final local Windows fixtures PASS. CI now runs the same warning/failure/receipt tests on Windows5.1. Do not reuse or delete the unactivated candidate to bypass the child's immutable-release guard. A subsequent reviewed exact-main revision provides a fresh release path. Runtime refresh, watchdog rejoin, coordinator loss and full physical completion are still unverified.

## Verified launcher integration; ACL recurrence stops activation

PR1743 merged as `b4d608627ee30cd730eb38beed3106e17bddbd2e`. Independent review at78ca99c4 found no material findings. [PR CI37726242634](https://github.com/haji84/AI-/actions/runs/37726242634) and [main CI37726648475](https://github.com/haji84/AI-/actions/runs/37726648475) passed all jobs. The first hosted test run exposed an expected legacy native failure leaking LASTEXITCODE into the Actions epilogue; the fixture now returns0 only after all assertions, including the real exit9 negative. The same Actions invocation passed locally and in CI.

After the owner completed native UAC, fresh plan at04:19:15Z passed: Android38, identity40, the unchanged identity digest above, olda49c458d runtime, schema/quiescence/task checks and four listeners. Apply at04:19:17Z exited1 at production-directory/private-acl, before build, prepare, service stop or activation. Separate logs and final launcher refusal were retained correctly. Loopback health remained status=ok. This is a successful failure-capture test, not runtime acceptance.

Read-only native inspection at04:20:54Z found one additional read-only Codex-or-sandbox-class ACE, rights1179817, explicit on the owner JARVIS root and inherited by production/config/native launcher. The approved repair had verified its absence at03:49:32Z; it has reappeared. These observations do not identify which process reapplied it. Per the explicitly approved stop condition, no second ACL removal, security-guard relaxation, sandbox policy/account change or further update retry occurred. The original protected backup and unactivated0fa99a5e candidate remain intact. [Issue1662 recurrence receipt](https://github.com/haji84/AI-/issues/1662#issuecomment-6052156807).

The next step is read-only provenance diagnosis and a concrete separately reviewed permission remedy. Runtime/enrollment expiry remains2026-10-08T22:33:43Z. Existing native watchdog inspection at04:18:15Z also found Listener=0, Worker=0, enabled watchdog/supervisor tasks with lastResult1, stale watchdog status sinceOct6, and the original node-loss37607612844 loss receipt still present. This is diagnosis only: watchdog rejoin, finalVerifier and later coordinator/network/reboot tests remain incomplete. Nubia remains deferred.
