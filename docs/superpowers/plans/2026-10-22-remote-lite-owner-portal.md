# Issue1831: owner portal critical path to20:00JST

Owner instruction2026-10-22: preserve the parent goal; prioritize a usable minimal real-device flow and report actual evidence at20:00. Baseline main f2b56c80, PR1832 f279a5de; both exact-head CI runs passed. Reuse the existing branch/PR and accepted Android/native paths. No production credentials/account or GORIQ configuration changes.

## Requirement classification at18:20JST

| Classification | Requirement / evidence |
|---|---|
| Verified in disposable VMs | Windows native screen/input/signed revoke; normal Windows enrollment UI/DPAPI/owner approval/reopen; Android15 native screen/input/local TURN/secure-window refusal/revoke; CI39753290523 and39753290543. |
| Implemented, unverified in requested environment | Native APK/EXE on friend's hardware; iPhone Safari; separate external networks; sustained smoothness/40devices. |
| Not implemented | Owner browser login/list/approval/control product flow; durable server enrollment; operational public HTTPS/TURN; Windows installer/production signing; safe Android9–13 input; required unattended Android lock/reboot recovery. |
| External prerequisite / action | Independent server/account absent; actual Android/Windows/iPhone availability unknown; concrete public endpoint/credentials/cost limits and signing material must be bound to existing approvals. No secret values in chat. |

## Largest actionable obstacle

There is no deployable owner browser entrance connecting the tested native components. Build one isolated HTTPS service that reuses signed device protocols and BrowserManualPeer. A configured high-entropy owner access key is exchanged for an HttpOnly/Secure/SameSite cookie; mutations require exact Origin and a session-bound CSRF token. No owner identity from request JSON, no browser storage or URL secrets. Public account provisioning remains external; disposable HTTPS is sufficient to verify this code, not to mark external acceptance.

## Bounded implementation sequence

1. Add durable validated public-key registration and owner-scoped pending/device listings to the existing coordinator. Persist approve/revoke before accepting the mutation; on storage failure, deny success. Live sessions/tokens are never restored.
2. Add standalone bounded HTTPS owner/device gateway, configured owners, cookie login/logout, CSRF and body/rate limits. A restart invalidates browser/live sessions while preserving enrolled public identities. No arbitrary proxy/command or GORIQ import.
3. Japanese browser login, invitation, fingerprint approval, device selection, WebRTC video/manual control and stop/logout. Reuse tested BrowserManualPeer and signed native endpoints. Never mark stale video LIVE. Direct connection and relay readiness must be distinguished.
4. Verify authorization negatives, disk restart/revoke durability, actual HTTPS/browser setup and connection; independent review, exact-head CI and Issue/PR record. Then build only the artifacts actually needed for available real devices.

Risk: authentication/persistence is security-sensitive; independent review is required before integration/public exposure. Local disposable test identities and files only until exact production configuration is available. Do not spend the remaining time extending already-passed Android tests unless a regression appears.

Rollback: revert this isolated portal change and stop its own process. Preserve enrollment/config files and keys. No migration of GORIQ DB, system service, firewall, account or public deployment is included. Do not silently restart from an empty registry after corruption.

At20:00 report observed functions, revision/run evidence, distribution decision and remaining obstacles. Unknown or unavailable physical evidence is INCONCLUSIVE, never PASS.
