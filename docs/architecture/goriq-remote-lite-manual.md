# GORIQ Remote Lite: manual-only product boundary

Status: **Issue #1831, P0 code candidate / NOT DEPLOYABLE**. Decision 2026-10-19 JST.

## Delivery amendment — 2026-10-23

The owner explicitly chose: 「あなたのGORIQを友達専用アカウントで使う」.
The current delivery model is the owner's running GORIQ offering a manual remote
feature to friend-specific accounts. A separate server PC or a full GORIQ install
for each friend is not required. The historical P0 description below remains a
record of the original boundary, not the current implementation inventory.

Reuse the existing Remote Lite per-owner portal, enrollment, native Android and
Windows agents, HTTPS and WebRTC. Android operates through its native agent;
the historical Windows-to-Android dependency below is superseded. Friends receive
only their own remote access, never owner administrative/AI/Broker credentials.

`jarvis-remote-host.mjs` may supervise the existing portal via explicit
`GORIQ_FRIEND_REMOTE_CONFIG`. This default-off integration preserves core
authentication/authority and isolates friend-child startup failures from the core.
The actual child validates distinct owner/friend hostnames against the same parsed
configuration that it serves. Separate ports alone do not isolate host cookies.
OS-only environment inheritance is not an OS-user/filesystem sandbox. Parent IPC
requests graceful close and registry release, with a bounded owned-child fallback.

No current service/configuration/account is changed by adding this integration.
Constant public HTTPS, authenticated TURN with resource controls, approved account
provisioning, formal signing and deferred physical acceptance remain required.
See `docs/remote-lite/SERVICE_OPERATIONS_JA.md` for preparation and Issue1831 for
exact verified source/CI evidence. Neither CI nor this delivery decision establishes
unattended Android reboot/lock support or 40 concurrent physical connections.

## Goal and non-goals

Build a separate friend-distributable Windows host + Android agent. A friend can control their own enrolled Android and Windows devices from an iPhone or PC browser on another network, without needing to install Tailscale/RustDesk, run a terminal, open a router port, know an IP address, manage Node/pnpm, or share the original owner's GORIQ account. Initial setup still requires local owner verification, device confirmation, and OS permissions.

The entire user-facing feature is **manual remote view/input only**. Exclude autonomous agents, AI, GORIQ Goal Controller, arbitrary commands/scripts/shell, task runner, workflow replay, admin APIs, native iOS/Mac targets, and cross-owner fleet access.

## Network and product boundaries

Remote browser -> authenticated HTTPS signaling -> friend-owned Windows host -> friend Android Agent (when Android is selected).
WebRTC media and manual data should connect peers directly when possible. ICE/STUN alone does not guarantee all NAT/firewall connections; authenticated TURN relay is required as a fallback for reliable use across networks. The friend must not configure TURN. A provider must operate signaling and optional relay, and the owner must separately approve provider/accounts/secrets, security/privacy, cost/billing policy and deployment.

A connection broker is **not** allowed to issue arbitrary device commands: it binds one authenticated viewer to one specifically approved device, routes only constrained signaling, and must not receive reusable owner credentials or expose GORIQ Broker/Admin. Media must use authenticated DTLS and the application must bind WebRTC peers to the authenticated signaling identities. These peer/network protections are not implemented by P0. Internet-facing infrastructure is not created here.

## P0 files and what they actually do

- src/remote-lite/manual-protocol.mjs: parses bounded manual tap/swipe/text/key/pointer/wheel inputs and WebRTC offer/answer/ICE candidate envelopes. Rejects other actions, extra fields, invalid coordinates and oversized data.
- src/remote-lite/manual-session.mjs: in-memory, per-device session controller; pending must receive separately authenticated device acceptance; viewer-bound random bearer hash; one controller per device, finite sessions and input/ICE queues; exact input sequence; expiry and explicit disconnect.
- tests/remote-lite-manual-session.test.mjs: simulated principal/device tests for denials, replay, state, boundedness and signaling direction.

**Critical limitation**: the authenticateViewer and authenticateDevice functions are injection points for a future independently verified owner/device authentication implementation. The callbacks MUST derive identity from validated credentials/transport, NEVER trust IDs submitted inside request JSON. A toy callback returning true is not security. P0 has no HTTP endpoints, persistent account/registration, encrypted media, OS input, screen capture, actual device agents, live network service, TURN deployment or installer. It does not assert that friends can connect.

In this reference implementation, sessions expire: pending 60 seconds, idle 10 minutes, absolute 30 minutes. One active/pending controller per device; max 100 sessions, 30 accepted inputs/sec/session, 64 outstanding signaling messages each way. Tokens, typed text, SDP and ICE are not written to logs or disk by this module. Exact transport-side deduplication and safe handling of UNKNOWN input delivery remain necessary.

## Verified current source context / scope difference

- Existing JARVIS Remote Assist (src/app/jarvis/JarvisConsole.tsx, scripts/jarvis-remote-gateway.ts) is owner-only and carries GORIQ capabilities not suitable for redistribution.
- Current Android Wi-Fi Worker (docs/architecture/jarvis-worker-remote.md) supports signed enrollment and bounded screenshots/manual input. It is **not** continuous screen video.
- Current optional H264 scrcpy route (docs/decisions/2026-09-16-jarvis-video-trial.md) is an ADB-linked 60-second trial, not an all-network low-latency Android production stream.
- Existing Windows production setup (docs/architecture/jarvis-windows-production.md) is owner-specific and not a friend-friendly installer; Windows task execution is not remote interactive desktop control.
- No top-level LICENSE could be fetched in the examined source tree. Redistributions require explicit review of code ownership and every included third-party dependency's licensing.

## Threat model / acceptance blocks

1. **User A -> User B**: no cross-owner device session, screen, input, signaling, account reuse or login credential sharing; real owner/device identity attestation needed.
2. **Spoofed device / false consent**: session cannot become active merely because browser requests it. Real agent must authenticate separately and enforce OS owner approval/permission policy. Android MediaProjection may require new consent for each screen-capture session, especially target Android 14+.
3. **Stolen browser / replay**: token lifetimes/rotation, logout and remote revoke; input sequencing and no blind re-send after UNKNOWN status. Future implementation needs real HTTPS session protections, CSRF/XSS defense, persistent revocation and secure key storage.
4. **Input/code abuse**: allow only manual human input; no public shell, script, scheduled command, background automation, or privilege escalation. No Windows UAC, device lock or Android screen consent bypass.
5. **Streaming misuse**: visible connection state and user-controlled stop, no covert streaming, no logging sensitive media/input; encryption and separate peer authentication required.
6. **Resource abuse/cost**: enforce rate/capacity/size bounds and stronger upstream quotas, concurrent media caps, TURN budgets. A free STUN service does not solve arbitrary mobile networks; TURN can incur cost. Never silently activate billable usage.
7. **Recovery and privacy**: host offline, stale frame, permission refusal, direct ICE failure, relay failure, host reboot, Android lock and browser disconnect must display honest state; no stale screenshot labeled LIVE. Device revocation must work and failed update must preserve the friend's private data.

## Delivery milestones and strict proof

P0: isolated manual-only safety contract + local tests + independent review. **This PR.**
P1: independently authenticated registration/pairing, signaling local integration and screen-less connection test, no new public infrastructure without approval.
P2: native Windows screen capture/input bridge + least-privilege host installer + physical Windows manual E2E.
P3: Android screen/input adapter, supported consent model, low-latency video where permitted and real iPhone/mobile-data E2E.
P4: Japanese first-run wizard, click-to-connect dashboard, no-terminal recovery, signed installers/APKs and tested rollback/uninstall.
P5: a friend with a **clean Windows host** and own Android controls both from an iPhone on cellular; measured latency, NAT/TURN fallbacks, disconnect/revoke/reboot/permission denial and cross-owner negative tests.

No friend-ready or production-ready claims until the above physical acceptance succeeds. Local test command: node --test tests/remote-lite-manual-session.test.mjs. CI on exact PR head and independent review remain required.

## Invariants and rollback

No changes to original GORIQ/JARVIS endpoints, task execution, Mac/ZBook, Android fleet, owner token, DB, Tailscale settings, Windows services, firewall, 8787/8790/8792/8796/8797, or repository governance. No new credentials, permission changes, external/public deployment, signing keys, workflows or billed services without separate Human Gate. Follow AGENTS.md/PROJECT_STATE.md/ROADMAP.md, retain a clear separate product boundary.

Rollback: revert only the new src/remote-lite directory, this document, and its isolated test. There is no state/data migration.

## Standards

WebRTC: https://webrtc.org/getting-started/peer-connections
Android screen-capture consent: https://developer.android.com/media/grow/media-projection
