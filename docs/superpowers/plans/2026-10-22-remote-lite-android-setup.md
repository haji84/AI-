# Remote Lite Android HTTPS Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the normal Android APK with the existing independent coordinator through validated HTTPS and a visible first-run flow.

**Architecture:** Pure invitation/origin validation, bounded HTTPS transport, shared JSON exchange, and persisted UI enrollment state. Debug VM trusts only its generated local certificate; release uses system HTTPS trust.

**Tech Stack:** Kotlin/JVM, Android SDK 37, standard HttpsURLConnection/AndroidKeyStore, existing Node coordinator, Android 15 emulator.

**Spec:** `docs/remote-lite/ANDROID_SETUP_HTTPS.md`

## Global Constraints

- No GORIQ runtime, credentials, ports, AI or arbitrary execution in the APK.
- HTTPS only; no certificate/hostname bypass, redirect following or HTTP fallback.
- Origin is shown and registration requires a local tap. Invite is not persisted.
- No new public infrastructure or production key; test certificate/private key stays in ignored build output.
- Keep PR #1832 Draft until parent physical acceptance; software verification is not physical acceptance.

## Review Focus

- Duplicate/encoded invitation parameters must not select a different server.
- TLS/redirect failures must never transmit enrollment to another origin.
- Process death after proof must preserve receipt/origin and must not repeat enrollment blindly.
- Android intent extras must not bypass release HTTPS trust or local confirmation.
- Debug certificate trust and test screens must be absent from the compiled release manifest.

### Task 1: Invitation and HTTPS boundary

**Files:** Add `EnrollmentLink.kt`, `HttpsJsonTransport.kt` and corresponding JVM tests under `android/remote-lite/app/src/{main,test}/java/app/goriq/remote/lite/`.

**Interfaces:** `RemoteEndpoint.parse(String): RemoteEndpoint`, `EnrollmentLink.parse(String): EnrollmentLink`, `HttpsJsonTransport.post(path: String, body: String): JsonReply(status: Int, body: String)`.

- [x] Write tests for valid invitation, duplicate/unknown parameters, HTTP/userinfo/path/fragment rejection, valid TLS request, certificate rejection, redirect refusal, invalid path, and 96 KiB bounds.
- [x] Run tests with local portable JDK/Gradle/SDK; record RED for missing behavior.
- [x] Implement standard URI and HttpsURLConnection boundary, then run all Android unit tests GREEN.
- [x] Commit the independently testable boundary.

### Task 2: Shared protocol and first-run UI

**Files:** Add `CoordinatorExchange.kt`, `EnrollmentSettings.kt`, `EnrollmentActivity.kt`; update `MainActivity.kt` and release/debug manifests; replace duplicate debug exchange.

**Interfaces:** `CoordinatorExchange(transport: HttpsJsonTransport): EnrollmentExchange, DeviceSessionExchange`; settings retain origin and `EnrollmentReceipt`, never invite; EnrollmentActivity previews link and requires explicit submit, then signed registration check.

- [x] Add failure tests for response identity/status mismatch and Android intent bootstrap rejection.
- [x] Implement shared JSON paths and normal setup activity, preserving the device key and pending receipt after process restart. No remote media/input starts.
- [x] Add INTERNET to release for the user-authorized enrollment function; preserve cleartext refusal and debug activity exclusion.
- [x] Run unit tests and builds, commit.

### Task 3: Real HTTPS Android VM acceptance

**Files:** Update `scripts/pairing_fixture.mjs`, `scripts/emulator_smoke.py`, add `scripts/prepare_vm_tls.py`, debug network config, `.github/workflows/remote-lite-android.yml`, README.

- [x] Generate ephemeral loopback PKCS12/certificate in ignored build output; copy only certificate to generated debug resources.
- [x] Drive normal EnrollmentActivity over HTTPS, compare displayed fingerprint in the fixture owner approval, then signed registration/status/capture/tap/revocation through the shared exchange.
- [x] Inspect compiled release for INTERNET, no cleartext, no test CA config/activity; run Android VM and ordinary CI on the pushed head.
- [ ] Independent review; fix substantive findings with reproduction tests. Save evidence, failures, next action and reverse commit order to Issue #1831; update the existing PR description.

## Progress

- Baseline: `dd1790f2`, main `f2b56c80`, prior normal/Android CI green. Untracked Python cache predates this plan and is excluded from commits.
- Execution: native implementation under the user's autonomous completion instruction. No additional plan approval is required for this continuation.
- Task 1 complete: invitation tests 3 RED to GREEN; HTTPS tests 5 RED to GREEN using a genuine local TLS socket and untrusted-certificate denial. Full Android unit suite passed locally. No dependency or external account added.
- Task 2 complete: lost-response/pending-receipt tests 2 RED to GREEN, origin replacement regression, existing identity/status mismatch tests and full Android units/builds passed. Release archive inspection confirms INTERNET, cleartext false, no debug screen/config/CA. JSON mapping is exercised next by the real Android VM rather than a mocked JSON library.
- Task 3 VM complete at `9584ff6e`: [Android run](https://github.com/haji84/AI-/actions/runs/39729977289) and [ordinary CI](https://github.com/haji84/AI-/actions/runs/39729977333) succeeded. The test exercised explicit recovery from an invalid invitation, HTTPS enrollment, persisted receipt/key, signed approval/session checks, process restart, actual Accessibility screenshot/tap, and rejection after owner revocation. Earlier failures were retained in Issue #1831. A separate self-instrumented test-only APK now reads the hierarchy without suppressing Accessibility; ordinary CLI dump was repeatedly unbinding the service. This is Android VM evidence, not native WebRTC video or physical acceptance.
