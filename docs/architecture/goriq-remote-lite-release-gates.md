# GORIQ Remote Lite: Issue #1831 release gates

Status: review packet; no approval or release implied. Scope is the separate manual-only Windows/Android product in PR #1832. The existing GORIQ owner runtime is outside this scope.

## Verified boundary

The Windows EXE can read a current-user DPAPI-protected active-session file, sign fresh status challenges and bind the result to native capture/input. The repository does not issue a product device key or create the session file. The embedded page still connects two peers inside one browser. The coordinator adapter is loopback-only. There is no separate Android Remote Lite APK. Exact-head CI and VM results must be attached to Issue #1831 before these claims are accepted.

## Separate Human Gate decisions

| Decision | Action requiring explicit approval | Acceptance condition |
| --- | --- | --- |
| Identity and credentials | Choose an independent friend login provider; authorize device key creation, enrollment, recovery and storage. Never reuse a GORIQ owner account or secret. | Different owners cannot cross-control; a revoked device cannot view/control; copied protected key fails under another Windows account. |
| Public network | Approve the HTTPS origin, provider, auth/session policy, retention policy and deployment environment. | Cross-network signaling binds the authenticated owner and device; unauthenticated and browser-origin abuse is denied. |
| TURN and spending | Approve relay provider, temporary credential issuance, concurrency/bandwidth caps and monthly spending ceiling. | Direct ICE and forced-relay VM tests; expired relay credentials fail; no stale image is labeled live. |
| Android OS consent | Approve a standalone APK declaring only needed Accessibility and MediaProjection foreground-service permissions. Native consent prompts remain required. | Emulator install, opt-in capture/input, lock/permission denial, revoke, uninstall and no Worker/AI capabilities. |
| Signed distribution | Approve exact Windows/APK signing identities, artifact destination and external publication audience. | Clean install, update, rollback/uninstall and dependency-license review. |

No production credential, public service, OS permission change, billed relay, signing identity or distribution may be activated by CI on the basis of this file.

## Remaining acceptance evidence

1. Windows VM: ordinary EXE with ephemeral protected credentials; separately running viewer peer; native cursor coordinates; revoke/expiry stop capture and input. The two-peer local browser probe is insufficient.
2. Android emulator: separate APK with explicit grants, screen/video, bounded gestures, revocation, lock and permission removal.
3. Approved public test environment: independent identities, HTTPS, direct ICE, TURN fallback and quotas.
4. Friend-equivalent physical devices: clean Windows and Android controlled from an iPhone on cellular and a PC on another network, including reboot/disconnection/recovery. CI/VM cannot substitute for this currently unavailable step.

Until all applicable evidence exists, PR #1832 remains Draft and unmerged. No friend-ready claim or installer distribution is permitted.
