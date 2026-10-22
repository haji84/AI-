# Android native WebRTC continuation

Issue #1831 / PR #1832. Continue within the owner's autonomous completion instruction.

## Design

Reuse the existing owner/device coordinator and browser viewer protocol. The Android private key remains in AndroidKeyStore. Each outgoing SDP/ICE message is validated and its canonical JSON SHA-256 is bound into a fresh signed device challenge. Incoming signaling uses signed polling and advances the acknowledgement only after the native peer applies it. TLS and the saved registration origin remain the transport boundary.

Native media will use the separately licensed Android WebRTC SDK, a foreground MediaProjection capture service and a locally confirmed session screen. Input is the existing bounded tap/swipe/navigation service through the ordered manual channel. Status failure, expiry, local stop or disconnect must close tracks/channels and refuse further input. Android system consent and secure/locked-screen restrictions remain; this does not promise unattended restart on Android 14+.

No public server/account, paid service, production credential, device-administrator capability, AI executor or GORIQ runtime integration is part of these implementation steps.

## Steps and verification

- [x] Add pure typed SDP/ICE validation/canonicalization and signed polling/send access; test malformed messages, exact payload hash binding, foreign receipts, cursor jumps and delayed acknowledgement with RED/GREEN JVM tests.
- [x] Connect the shared HTTPS JSON exchange and exercise actual AndroidKeyStore signed SDP/ICE against the Node fixture in Android VM. Synthetic SDP verifies the signaling contract only. Verified at7a41a9d3, Android run39730997369.
- [ ] Add native video peer/capture consent and foreground lifecycle; verify real decoded screen frames in a separate browser process through a local TURN fixture where needed.
- [ ] Connect ordered manual input with queue/sequence/age bounds and fresh signed status checks; verify the actual tap target and media/input stop after owner revoke/expiry.
- [ ] Independently review, record exact-head CI and known gaps in Issue #1831, and update the existing Draft PR.

The first bounded implementation step is the signaling prerequisite. Do not claim native media or friend readiness from that prerequisite. Public HTTPS/authentication/persistence/TURN operation, distribution signing, Android 9–15 and 40-device coverage, physical iPhone cellular tests and unattended-restart acceptance remain separate parent requirements.

## Progress

Nine signaling tests passed after RED/GREEN, including Node-compatible canonical JSON/SHA-256, local proof deadline, safe cursor bounds and acknowledgement timing. Independent review found that a new instance lost the already-applied cursor; two tests reproduced restart and persistence-failure cases before fixing them. The cursor store is now mandatory, commits session/cursor before advancing memory, and stores no SDP/ICE or token. All 40 Android JVM tests and debug/release builds passed locally. The actual AndroidKeyStore/Node signaling VM step awaits exact-head CI.

Persisting a cursor does not restore an RTC peer or MediaProjection consent. After process death the native media step must renegotiate or start a new session; it must close on cursor persistence failure rather than blindly reapply the same signal.

## Native transport implementation boundary

Use the pinned `io.github.webrtc-sdk:android:150.7871.01` artifact (publisher POM: BSD-3-Clause, publisher notices: `Licenses/WEBRTC.md`). Keep its complete published notices with the APK. A non-exported foreground service owns one MediaProjection token and peer after a visible session confirmation and the OS capture dialog; no boot receiver or token reuse. The normal release initially has no public ICE configuration, and must not claim outside-network connectivity from LAN-only candidates. A separate disposable VM fixture may supply local TURN.

Before capture, fresh signed active status establishes a short monotonic media lease. Frame forwarding itself checks the lease; an independent watchdog closes the peer on expiry, so a stalled network callback cannot keep publishing or revive an expired lease. Status failure, OS projection stop, peer/channel loss, local stop and activity/service failures close tracks and input. Input is queued with strict sequence/rate/age/size bounds and a fresh signed status check before real Accessibility capture/gesture and confirmation. Android 9/10 input must remain unavailable until an equally safe geometry/capture boundary exists. Locked and protected screens are refused.

Real VM acceptance must use a different browser process receiving actual Android screen video and returning a bounded manual command. Assert decoded frames/pixel changes, the real tap target/ACK and owner-revoke media/input shutdown. Synthetic SDP tests cannot satisfy this step.

### Native implementation candidate (not yet VM accepted)

Added pinned native SDK plus complete publisher/upstream notices, locally bound session/OS consent, foreground capture, short monotonic publication lease, independent signed status/watchdog, strict ordered input and post-operation ACK. Local stop serializes with OS command emission. Cleanup keeps foreground visibility until native resources are released and separately attempts signed coordinator session-end; uncertain release/end is displayed honestly.

Independent review found startup/stop races, lock publication, window screenshot pacing and missing coordinator session-end. Fixes are present. Android14+ remote input now requires an actual target-window screenshot success immediately before issuing input; window metadata is used only for ID/bounds/layer matching, not element content. Display screenshots alone can redact secure content while allowing blind input. Android9–13 input remains denied pending an equally safe boundary; this is an unmet parent requirement, not a reduced acceptance scope. An already-issued gesture may finish after local stop; no later OS dispatch may start. Window flag/content changes between proof and dispatch are not an atomic OS transaction and remain a physical acceptance consideration.

Added disposable VM acceptance: independent Chromium, relay-only local coturn reached from the Android VM through its host-loopback alias10.0.2.2, actual decoded screen/pixel change, real taps/ACK including rapid commands, FLAG_SECURE refusal, owner revoke and capture release. Device HTTPS separately uses ADB reverse and adds100ms per request. Browser TURN allocation is checked before emulator startup. Native media checks are pending CI; do not report a native media pass before their exact-head logs succeed. No account/public endpoint, production signing key, public TURN or GORIQ runtime change is included.
