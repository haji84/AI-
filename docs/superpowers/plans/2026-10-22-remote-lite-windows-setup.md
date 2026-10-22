# Windows first-run enrollment implementation plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task; request independent review before integration.

**Goal:** A normal Windows EXE can enroll through a locally confirmed HTTPS invitation, preserve its DPAPI identity across restarts, verify owner approval, and feed the existing signed session gate.

**Architecture:** Reuse the Node enrollment/discovery contract and existing Go bounded HTTPS client. Add a separate local setup server without desktop capture/input authority. The Windows user's DPAPI-protected key and registration journal are persisted before network mutation; only fresh signed discovery can activate the existing version2 config.

**Tech Stack:** Go standard library, Windows current-user DPAPI, embedded Japanese HTML, existing Node coordinator and disposable Windows CI.

**Spec:** Issue1831 formal handoff, `docs/architecture/goriq-remote-lite-manual.md`, `docs/remote-lite/ACCEPTANCE.md`.

## Constraints and baseline

Baseline d7813971 native Android/Windows VM PASS, plus103cc72f evidence only. Owner completion authorizes ordinary implementation; earlier task-scoped enrollment/credential approval permits explicit user-triggered device enrollment. Generate only disposable test identities here. No public account/server, production key, GORIQ state, billing, service installation or privileged Windows setting changes. Existing active-session configs remain compatible. Keep one PR1832.

## Review focus

- Lost propose/prove replies: retain identity and uncertainty, never automatically replay an invitation.
- Different origin or concurrent EXEs: refuse replacement/racing registration; preserve all prior receipt IDs.
- Malformed or foreign challenge/receipt: reject before signing/activation, do not echo secrets in errors.
- Approval absent/revoked: no usable remote config until signed discovery succeeds; setup itself cannot capture/input.
- Browser CSRF/foreign origin/expired local token: reject; invitation/private key never enter logs or browser storage.

## Task 1: durable enrollment engine

Files: add `apps/remote-lite-windows/cmd/localhost/enrollment_windows.go` and tests; reuse `remote_config_windows.go` and `session_gate.go`.

- [x] RED tests for HTTPS invitation validation, DPAPI identity persistence, exact signed proof/receipt, lost-response no-replay, same-origin explicit recovery, approval and corrupt state denial.
- [x] Implement bounded journal, current-user protection, atomic persistence and strictly bound enrollment/discovery. Do not replace an existing different active config.
- [x] GREEN tests, Go vet and build; review before proceeding. Local Go1.27.3 including real Node interop passed; independent review fixed setup shutdown/lock ordering.

## Task 2: normal EXE setup and VM acceptance

Files: add setup handler/UI/tests, update main startup and embed declarations, extend isolated Windows CI formatting list as needed.

- [x] Start setup only when no active config is available. Use a per-user directory lock for the setup lifetime, a loopback-only random token and15min expiry. No desktop bridge exists in setup.
- [x] Japanese invitation preview/register, exact fingerprint/receipt display, owner approval check and explicitly confirmed uncertain-request recovery. Clear pasted invitations and fragment token from visible URL; no browser persistence.
- [x] Verify independent Node pairing and browser setup in disposable Windows VM, plus negative origin/token/unknown-fields tests and all existing Windows native/browser checks. F279a5de normal CI39753290523 all4 jobs PASS, Android39753290543 PASS.
- [x] Independent review and exact-revision evidence recorded in ACCEPTANCE.md. Continue Issue/PR write-back with the20:00 critical-path checkpoint. Separate public login/persistence/infrastructure and installer gates remain; setup success alone is not friend readiness.

Rollback: revert this setup change and rebuild the EXE. Preserve user's encrypted identity/journal and active-session.json; do not delete app data or silently re-enroll. There is no production deployment or schema migration.

## Verification checkpoint

Local Go tests including actual Node enrollment/discovery/revoke passed, as did Go vet/build, the two new scripts' ESLint/syntax checks and diff whitespace checks. The browser branch is deliberately enabled only by the existing disposable-Windows-VM environment flag; it must pass exact-revision CI before claiming the Japanese setup UI works end to end. Core tests reject foreign fingerprint/receipt, canceled request mutation, cleartext/foreign origin, unknown fields, unconfirmed recovery and concurrent setup. A lost propose response retains the encrypted identity, and no automatic retry occurs.

Shutdown waits up to8seconds for current requests. If it cannot confirm drain, the directory handle is intentionally held until the immediately returning main process exits; HTTP Close alone is not evidence that disk/DPAPI work has ended. No second EXE can enter while that writer remains alive. The UI clears a previous success on each new operation, so failed re-confirmation after revoke cannot leave a stale success notice.
