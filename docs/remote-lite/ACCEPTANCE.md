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
