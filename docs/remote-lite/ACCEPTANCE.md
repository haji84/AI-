# GORIQ Remote Lite: progress and acceptance

Issue #1831. Friend installs the Windows host and Android companion and controls their own devices from iPhone/PC without user-managed VPN, router rules or GORIQ AI access. No production publication yet.

## Code now on draft PR
- Manual-only schema, identity-bound expiring sessions, signed device enrollment, owner approval and revocation, locally bound HTTP signaling.
- Browser WebRTC adapter: sends a screen video track and manual-only input via ordered DataChannel. The sharing user must explicitly approve the screen. Peer disconnect stops the local capture. Tests use simulated peers, not real hardware.
- Short-lived coturn TURN credential helper with explicit deny-by-default billing/deployment readiness.
- Japanese setup diagnostics; READY is forbidden until a real screen frame and acknowledged manual input are observed.

## Acceptance by requested milestone

1. Actual WebRTC video and input: code candidate and simulated tests only. Real Chrome/Safari peers, media, mobile latency and reconnect remain.
2. Windows desktop: standalone native Win32 screenshot + SendInput prototype cross-compiled for Win64 outside this PR. Its Windows runtime, trust, GUI approval, signed installer and connection to WebRTC remain.
3. Android and simple UI: existing Android Worker has screenshot/tap; new Japanese diagnostics exist. Native low-latency video, first-run onboarding UI, Android permission flow, standalone APK and real Android E2E remain.
4. Cellular without Tailscale: loopback signaling and TURN credential generation exist. Real authenticated hosted HTTPS, TURN instance, relay billing/quotas, DNS, TLS, anti-abuse and cellular E2E remain.

## Physical/environment and security limits

The sandbox's Chromium browser was blocked from both file:// and 127.0.0.1 by ERR_BLOCKED_BY_ADMINISTRATOR; this is NOT a successful browser media test. Cross-compiling a Windows Go prototype is NOT a physical Windows validation. Android 14+ MediaProjection requires consent per capture session. Windows UAC/secure desktop and locked sessions cannot be assumed remotely operable. STUN-only direct ICE cannot guarantee NAT traversal; TURN may incur bandwidth charges. Public signaling/relay creation requires separate approval for infrastructure, credentials, billing and deployment.

Current HTTP prototype is loopback-only and must never be publicly exposed. No original GORIQ services/identities/endpoints were changed. Main integration requires exact-head CI, independent review, and guarded approvals. Friend distribution remains blocked until clean-install real iPhone cellular -> Windows/Android operation, disconnect/revoke, and restart recoveries are verified.

References:
- https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel
- https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTrack
- https://developer.android.com/media/grow/media-projection
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
- https://github.com/coturn/coturn/wiki/turnserver

## 2026-10-20 progress: Windows source imported, local real-RTC smoke test available

All six Windows Go/HTML files are now in this draft PR under `apps/remote-lite-windows/` and can be built without third-party Go dependencies. An unsigned Windows/amd64 EXE and Japanese manual have also been created in the conversation as `GORIQ_Remote_Lite_WebRTC_Windows_DevTest.zip`. This ZIP is a local developer artifact, not a public GitHub Release or verified installer.

The Windows HTML now includes a **real browser RTCPeerConnection loopback self-test**: native JPEG snapshots are drawn into a canvas, a canvas video track is sent between two local browser peers using the normal WebRTC stack, and a DataChannel ping/pong is checked. A separate, locally confirmed test moves the Windows pointer via the WebRTC DataChannel into the same-host native input API. The test requires explicit Windows owner consent and is capped at 60 seconds. No outside network path or relay server is opened.

**Verification accomplished**: Go Windows/amd64 cross-build PASS, Windows target `go vet` PASS, Windows native layout test compiled but cannot execute on Linux, embedded JavaScript `node --check` PASS. Actual Windows runtime capture/input, decoded browser media and pointer movement are still **PENDING PHYSICAL TEST**. A source-invariant Node test checks that the Windows host still binds only to loopback and keeps the consent/expiry/secure-desktop protections.

**The four original completion criteria remain unmet as a complete product**: (1) remote peer media/input over authenticated signaling, (2) physical Windows manual control across machines, (3) independently installable Android low-latency media and Japanese first-run UI, (4) private-account HTTPS signaling and TURN that actually work across mobile NAT and have approved cost protections. Build and simulated contract checks are not equivalent to the friend's iPhone controlling their own Android/Windows PC.

External relay pricing is a separate billing gate. Cloudflare Realtime TURN, for example, publishes a monthly free allocation followed by usage-based overages, so its free allocation alone is not a verified hard-zero charge guarantee. See: https://developers.cloudflare.com/realtime/turn/ and https://developers.cloudflare.com/durable-objects/platform/pricing/. No account linking, DNS, Worker or TURN service has been deployed in this task.

## 2026-10-21 handoff audit and bounded safety work

The latest fetched `main` is `cb6b0fa06492b3d610ecb527645244b9a46ba8eb`, matching this draft PR's base. The inspected PR head was `d7d0d5509256c90648391f25d4385ad1b0643745`; its CI run 39397754639 succeeded. These hashes describe the pre-change baseline, not release evidence.

| Requirement | Verified here | Still required for acceptance |
| --- | --- | --- |
| R1 Windows | Local preview pointer coordinates now respect the actual displayed image, including letterbox refusal. | Native runtime capture/input, safe button release, logged-in/lock/UAC boundaries, remote browser connection, installer, clean-PC physical tests. |
| R2 Android | Existing owner Worker architecture reviewed as a reuse candidate. | Separate manual-only APK, OS consent flow, live capture/input, physical Android tests. |
| R3 Connection | Signed device session-status check added to the loopback transport. | Hosted authenticated HTTPS, real ICE media, approved TURN operation and cellular/NAT tests. |
| R4 Setup/UI | Existing diagnostics and local preview remain. | Friend account and pairing UI, complete Japanese wizard, signed Windows installer and Android APK. |
| R5 Safety | Browser peer now stops a capture arriving after close, refuses simultaneous capture requests, starts the permission prompt within the user's gesture, closes on control-channel loss or more than 30 inputs in any second, requires host session checks before publishing the track, and acknowledges input only after the host callback confirms application. Tests cover these behaviors. | Wire checks to the signed status endpoint and a real native host; verify logout/revoke/expiry stops actual media and input. DTLS peer binding, input already in flight at revocation, and native pressed-button cleanup remain open. |
| R6 Distribution/recovery | No new distribution claim. | License review, signed source-matched artifacts, update/uninstall/reboot/network recovery and friend acceptance. |

Local checks: 63 remote-lite Node tests passed, lint passed, P8 security 332 passed, and Next build passed. The full Node suite on this Windows checkout produced 19 failures in unrelated Mac/owner-workflow tests (2,558 passed, 1 cancelled, 24 skipped of 2,602); Linux CI must be rerun on the exact new PR head. A verified official portable Go archive was downloaded for native checks, but Windows Application Control blocked its `asm.exe`; no policy bypass was attempted. Windows native build/runtime evidence remains pending.

Independent review found the consent race, RTC input rate-limit bypass, missing live session shutdown, possible stuck Windows pointer-down on stop, and letterboxed-coordinate error. The race, rate limit, and coordinate mapping are addressed in this branch. Review of the updated diff also found that the signed status API is not yet wired to the WebRTC/native path, and that the unauthenticated challenge issuance can exhaust its shared pool. The latter is restricted to loopback now, but public HTTPS exposure must first add caller authorization and per-device request limits. None of this is physical Windows, Android, iPhone, or TURN acceptance. No public service, new account, credential, OS permission or paid relay was created.

## 2026-10-21 follow-up: local signed status binding

A host-side `createDeviceSessionCheck` adapter now obtains a fresh challenge, signs it using an injected device-key operation, and accepts only an active, matching, unexpired status result. A local HTTP integration test passes this checker to `BrowserManualPeer`; after the owner revokes the device, a simulated DataChannel input causes the host to stop its fake track without applying the input. The private key remains outside the adapter. This is a localhost simulated-peer test, not Windows or Android native wiring or a physical WebRTC test.

Challenge issuance now rejects nonexistent, wrong-device, and inactive session IDs before consuming nonce capacity; outstanding challenges are capped per registered device. Public caller authentication is still required because a party that learns an active session ID could request challenges. Independent review confirmed that 25 devices with eight outstanding challenges each can still exhaust the shared 200-challenge pool, interrupting another device's status checks. Issuer authorization and fair account-level capacity are required before Internet exposure. The current quota is only a containment measure.

The Windows held-button cleanup, native status/input integration, logout handling, Android APK, installer, public HTTPS/TURN and cellular physical acceptance remain open. Windows Application Control still prevents local Go verification, and no system-policy exception was attempted. Targeted tests in this follow-up: 66/66 passing; exact-head GitHub CI and independent native review must be refreshed after the next push.
