# #1219 — Limited console bootstrap proposal

Status: **source preparation; no console permission has been added, no authenticated SSH session, no physical E2E PASS.** The owner requested agent-operated diagnosis and correction, with only critical changes separately confirmed. This document is not an approval issuer.

## Newly observed boundary

The agent read the existing Ubuntu display through the supported Computer Use API. The owner's log commands used uppercase `-U` (journalctl's until option), then omitted the option hyphen. The visible errors were `Failed to parse timestamp: ssh` and `Failed to add match 'u': Invalid argument`. These observations explain why the requested server log was not collected; they do not explain the SSH authentication rejection. No raw screenshot or incidental console text is published.

One ordinary `h` key sent to the existing VMConnect window did not visibly echo. No Enter was sent and no further input was attempted in that window. Input delivery and the input-buffer state are unconfirmed; a future working channel must first clear and verify the prompt. Existing administrator window/process35224 was preserved.

A distinct non-administrator Windows VMConnect process9152 was launched against the exact VM GUID. Its returned dialog reported insufficient permissions while locating that VM. A separate read-only `Get-VMConnectAccess` call also returned permission denied. Only the newly created diagnostic process was then closed. No VM lifecycle, disk, network, account, permission or protected-service mutation occurred. The current executor's lack of permission is established; whether a per-VM grant fixes the normal client on this installed Windows version remains an acceptance test, not a fixture claim.

## Existing implementation reused and corrected

The previously prepared `scripts/ai09-console-access.ps1` and fixture suite are reused rather than creating another authorization executor. Independent review found that its path validator applied a current-user/SYSTEM/Admin ownership allowlist to every ancestor including the TrustedInstaller-owned OS drive. Consequently normal user-owned paths were refused before mutation, while mocked ACL fixtures hid the incompatibility.

The correction reuses the unchanged SHA-pinned `ai09-access-host.ps1` validator: aliases are checked along the complete path, while the existing target and its actual parent must remain owner-controlled. No filesystem ownership or ACL is changed. CLI arguments are captured before loading the shared dependency; source pins use LF. The original proposed source is retained outside the checkout, SHA256306ac937a288c8ff663d9fb65a7138a327c566f2be672ebbe76b924b7a10aa70.

Native read-only comparison reproduced `OWNER_PATH_REQUIRED` in that original source on an existing owned profile path, then accepted the same path with the corrected source, without creating or deleting files. New real-Windows ACL regressions accept a new/existing owned file and reject repository-contained plans. The Node wrapper passes2/2 on ZBook PowerShell5.1; the PowerShell7 fixture passes76 assertions and its real-ACL regression passes separately. Hyper-V authority, native mutations and snapshots in the larger fixture remain simulated; no native Grant/Revoke is proven by those tests.

## Exact proposed critical scope

- Issue1219, hostHAJI only.
- VM `GORIQ-AI09-Ubuntu`, GUID `453b139b-cceb-446e-99fb-f45bf5895436`, existing NIC MAC `00155DDC2C00`.
- Existing Windows user `HAJI\qq113`, SID `S-1-5-21-3241814747-1938433149-1705921193-1004` only.
- One `Grant-VMConnectAccess` addition only if that exact user has no existing entry. Preserve every existing entry; existing Allowed produces NO_CHANGE/no owned journal, and Denied or drift refuses.
- Proposed authority reference `owner-chat:1219:console-bootstrap:20261020`, execution deadline `2026-10-20T13:00:00Z` (October20 22:00 JST). Fresh native VM/NIC/user/full-policy observation, source pins, exclusive plan/journal and immediate pre/post comparisons are mandatory.
- The same requested approval includes removing only this run's added entry through fresh, externally pinned original-plan/journal evidence. Restore after the bounded diagnostic attempt or if the client remains unusable; never compensate by adding a group or wider right.

**This grants interactive access to this VM's current console session, not a read-only log permission.** It grants neither global Windows administrator membership nor Hyper-V administrator-group membership. The proposed task use is fixed public diagnosis followed by concrete SSH-repair preparation; the grant itself is not an SSH credential or guest sudo authority.

There is **no native automatic expiry**. The deadline limits executions; it does not schedule revocation. Revocation restores the recorded permission metadata; it does not guarantee termination of an already-open connection or undo guest actions. Any client opened for this diagnostic must also be closed and its process exit checked. Preexisting windows/rights remain untouched. Drift or UNCERTAIN outcomes stop for reconciliation.

The installed Hyper-V .NET ACE metadata was inspected read-only: UserName/string, UserId/SecurityIdentifier, VMName/string, VMId/Guid, ComputerName/string, Access/Allowed-or-Denied. This confirms field projection only; current actual ACE contents and native mutation behavior are not yet observed. Microsoft documents [Grant](https://learn.microsoft.com/en-us/powershell/module/hyper-v/grant-vmconnectaccess?view=windowsserver2025-ps) and [Revoke](https://learn.microsoft.com/en-us/powershell/module/hyper-v/revoke-vmconnectaccess?view=windowsserver2025-ps) as permissions for applications initiating VM Connection, not proof that this client will work.

## Gates and follow-on work

Before execution, require the exact reviewed source/launcher hashes and external owner approval for the above limited grant plus its exact recovery. Until then, only source, fixture tests and read-only inspections are authorized. No SSH key registration, password reset, guest account/shell/PAM/SSH-policy change, network reapplication, service/install/container/signing-key change is included.

After a usable ordinary console is observed, collect the SSH refusal log without sudo first, if the existing account can read it. Do not automate a password prompt. Diagnose the actual cause and present any demonstrated credential or policy change as a separate concrete critical bundle. Correct commands alone do not establish a repaired account or stable SSH.

Latest completed state-only headf402bcf2 CI39277173767 passed repository guard, Windows fixtures and project checks, but the actual independent container job again timed out at unit180000ms. Its signed unit result is inconclusive; integration/security/build were not executed. Artifact12197918134 ZIP SHA2566da2077849849aefc0575aadb6585e443a11d0266101ce13aa1008be0bbd47a5, receipt SHA256225a93eaba193bd1198e1659fc0124f8f361f0835586e3d91d5ac6db5836914d; independent signature/log/cleanup audit retained. This does not establish the new source's CI, nor justify increasing limits or removing tests.

The already executed TCP22 failure rollback remains recorded separately; its one added rule was removed. Authenticated Goal → real Ollama → physical independent six-check signature → Windows OS reboot → nextJob remains NOT VERIFIED. Draft #1824 → #1826 → #1827 stays HOLD. Protect8787/8796/8797, VM/disks/seed, all worktrees and prior evidence.
