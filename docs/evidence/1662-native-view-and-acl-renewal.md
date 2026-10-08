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
