# ZBook Owner ACL narrowing gate — PENDING

Goal #1219/#681, child #1662. Nubia remains Owner-deferred. This is preparation for a separate permission Human Gate, not approval or execution evidence.

## Actual diagnosis

The exact-main elevated read-only process probe completed at 2026-10-02T15:38:00+09:00. Five stable service-related Node candidates are all current-Owner, command-visible and rooted at old revision `ff761733c66f60a49e8c25c5ab0450a7a5e679c5`; four directly own the four service ports and the fifth is the remote-host ancestor. Prior workflow access-denied was its non-administrator execution context, not a different process owner.

A following read-only ACL classifier emitted no names, SIDs, paths or rights masks. One principal appears on production, protected config and native launcher: translatable account SID, same account domain, not in the active Owner token, not a WellKnown SID, inherited, applies now, known read-only rights. Source depth1 on production and2 on both files establishes one explicit parent ACE. The first classifier attempt failed before output because StrictMode accessed DirectoryInfo.Directory; corrected logic completed. Neither attempt mutated ACLs.

The runtime updater's apply boundary allows only current Owner and SYSTEM. Preserving the extra principal by relaxing that boundary would retain private-runtime read access for another local-account principal. Apply therefore correctly remains blocked.

## Concrete proposed operation

Before 2026-10-02T20:18:17+09:00, one local same-Owner administrator PowerShell invocation of the exact reviewed `scripts/goriq-zbook-owner-acl-repair.ps1`, with local UAC consent and process-only RemoteSigned. Source must still be protected current main with successful exact-head push CI; downloaded bytes must match SHA256 `8ad00489e57830150d6a5f91238fc74a698e887e25e33d41ff88a4d2ec5e414f`.

The script fails closed unless the JARVIS root and guarded surfaces remain Owner-owned/non-reparse, the existing Limited/Password runtime task is running, and exactly one additional root Allow ACE is: explicit, translatable, non-WellKnown, account SID in the same account domain, absent from Owner token, known read-only, applies to self, and inherits to containers and objects. It removes only that exact ACE from the JARVIS root. It never recursively resets ACLs, changes ownership, adds/grants a principal, or changes Deny entries.

Before mutation it stores the original root SDDL only as a CurrentUser-DPAPI encrypted local backup under the existing runtime-refresh recovery area. It verifies strict Owner/SYSTEM Allow boundaries on root, production, releases, old release, protected config, launcher and backup; verifies the existing task remains running and all four listeners remain. Any post-change mismatch restores the original root SDDL and reports fixed public state. No SID/name/path/SDDL/config/key/credential is printed or uploaded.

Excluded: task/process stop/start, runtime code/config/DB/key/credential/schema/listener/firewall/TLS/enrollment/grant changes, deletion of the encrypted backup, recursive permission reset, another root or device, Android/Nubia rollout, or runtime apply itself. After a successful ACL receipt, the separate existing runtime updater apply authority must still be evaluated and executed only inside its applicable recorded scope.

## Verification and rollback

TDD RED: PR CI run36975731016 failed only the new fixture with `repair-script-missing`, proving the test preceded implementation. The fixture accepts exactly one safe normalized root candidate and rejects inherited, untranslatable, WellKnown, non-account, different-domain, token-member, write-capable, missing inheritance, inherit-only, zero and multiple candidate cases. A second TDD RED run36976561433 failed only with `downstream-selector-missing`; the implementation now also requires each production/releases/old-release/config/launcher surface to contain exactly the same inherited SID and no other additional Allow entry. Before ACL mutation, the DPAPI backup is decrypted in-process and compared to the original SDDL. Config and launcher hashes plus local health, task state and four ports are verified unchanged. The mutation flag is set before Set-Acl so any Set-Acl exception enters restoration; rollback verifies the original root SDDL and inherited downstream candidate. Protected CI and independent review remain required before merge. Tests are controlled logic evidence, not Windows permission evidence.

Rollback is exact original SDDL restoration from memory on any failure after mutation; encrypted local backup is retained. A code revert removes future availability but does not itself restore a successfully narrowed production ACL; the retained DPAPI backup is the recovery source and must never be exposed in chat or Actions artifacts.

Compass is unavailable; repository handoff is used without fabricated Controller transitions. GORIQ/Stage C is not complete.
