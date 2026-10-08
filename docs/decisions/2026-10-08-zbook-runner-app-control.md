# ZBook Runner blocked by Smart App Control (#1745)

Date: 2026-10-08
Status: BLOCKED at security decision; no security change authorized by this document.

Native watchdog file publication passed on main 7b3e8678. The remaining Runner failure is Windows application-control rejection 0x800711C7. Installed Runner.Listener DLL and EXE match the hash-verified official v2.337.0 ZIP. Replacing the same files has no demonstrated benefit. See [native evidence](../evidence/1745-native-watchdog-recovery.md) and its JSON receipt.

## Options and exact boundary

1. Retain Smart App Control. Keep the ZBook Runner recovery gate BLOCKED until an accepted/signed vendor build or another legitimate vendor-supported resolution is available. Independent repository work can be scheduled separately; no physical PASS is inferred.
2. Separately authorize turning Smart App Control Off on this ZBook through Windows Security's supported setting. This is a device-wide reduction of application execution protection, not a Runner-only exception. It permits other software that this layer would have rejected. The requested scope would not include changing Defender antivirus, firewall, other App Control policies, credentials, task principals, ACLs or runner registration.

The [Microsoft FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions) states that individual-app exceptions are unavailable. It also states that recent Windows updates support re-enabling the feature, but the actual device UI and restoration capability must be checked before any change; this record does not promise rollback. Do not replace the supported setting with registry edits, policy removal, broad allow rules or trust-metadata bypasses.

For option 2, obtain a separate explicit owner decision bound to issue1745, this ZBook and an expiry before execution. The existing completion authority and PR1746 distribution-guard approval do not cover it. If the setting or restoration path cannot be confirmed, stop with that limitation rather than inventing reversibility.

After an authorized change, observe the existing periodic watchdog, verify the same Runner identity reconnects, and let existing node-loss run37607612844 reach rejoin and final Verifier. Record results separately from publication. Do not rerun the successful launcher repair or initiate a second fault run. If the owner wants protection restored, use the supported UI and verify its reported state; disabling/re-enabling is not a guaranteed route to keep an unsigned Runner running.

AGENTS.md requires a separate Human Gate for "security weakening, protection/audit disabling". This is why the next security decision remains outside ordinary completion approval. No security configuration, authorization receipt or runtime code changes are included here.
