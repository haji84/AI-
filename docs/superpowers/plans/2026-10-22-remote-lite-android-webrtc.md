# Android native WebRTC continuation

Issue #1831 / PR #1832. Continue within the owner's autonomous completion instruction.

## Design

Reuse the existing owner/device coordinator and browser viewer protocol. The Android private key remains in AndroidKeyStore. Each outgoing SDP/ICE message is validated and its canonical JSON SHA-256 is bound into a fresh signed device challenge. Incoming signaling uses signed polling and advances the acknowledgement only after the native peer applies it. TLS and the saved registration origin remain the transport boundary.

Native media will use the separately licensed Android WebRTC SDK, a foreground MediaProjection capture service and a locally confirmed session screen. Input is the existing bounded tap/swipe/navigation service through the ordered manual channel. Status failure, expiry, local stop or disconnect must close tracks/channels and refuse further input. Android system consent and secure/locked-screen restrictions remain; this does not promise unattended restart on Android 14+.

No public server/account, paid service, production credential, device-administrator capability, AI executor or GORIQ runtime integration is part of these implementation steps.

## Steps and verification

- [x] Add pure typed SDP/ICE validation/canonicalization and signed polling/send access; test malformed messages, exact payload hash binding, foreign receipts, cursor jumps and delayed acknowledgement with RED/GREEN JVM tests.
- [ ] Connect the shared HTTPS JSON exchange and exercise actual AndroidKeyStore signed SDP/ICE against the Node fixture in Android VM. Synthetic SDP verifies the signaling contract only.
- [ ] Add native video peer/capture consent and foreground lifecycle; verify real decoded screen frames in a separate browser process through a local TURN fixture where needed.
- [ ] Connect ordered manual input with queue/sequence/age bounds and fresh signed status checks; verify the actual tap target and media/input stop after owner revoke/expiry.
- [ ] Independently review, record exact-head CI and known gaps in Issue #1831, and update the existing Draft PR.

The first bounded implementation step is the signaling prerequisite. Do not claim native media or friend readiness from that prerequisite. Public HTTPS/authentication/persistence/TURN operation, distribution signing, Android 9–15 and 40-device coverage, physical iPhone cellular tests and unattended-restart acceptance remain separate parent requirements.

## Progress

Nine signaling tests passed after RED/GREEN, including Node-compatible canonical JSON/SHA-256, local proof deadline, safe cursor bounds and acknowledgement timing. Independent review found that a new instance lost the already-applied cursor; two tests reproduced restart and persistence-failure cases before fixing them. The cursor store is now mandatory, commits session/cursor before advancing memory, and stores no SDP/ICE or token. All 40 Android JVM tests and debug/release builds passed locally. The actual AndroidKeyStore/Node signaling VM step awaits exact-head CI.

Persisting a cursor does not restore an RTC peer or MediaProjection consent. After process death the native media step must renegotiate or start a new session; it must close on cursor persistence failure rather than blindly reapply the same signal.
