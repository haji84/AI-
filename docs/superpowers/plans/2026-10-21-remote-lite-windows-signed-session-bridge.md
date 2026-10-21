# Remote Lite Windows Signed Session Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Windows frame and manual input delivery on a fresh device-signed session status check, then exercise the path in a disposable Windows VM.

**Architecture:** Keep the existing loopback-only Windows listener and visible owner consent. Add a Go status client that signs the existing challenge/status contract with an injected in-memory Ed25519 key. Add separate, fail-closed remote-session HTTP routes; every frame and input must pass the signed check before invoking the native bridge, and a failed check stops the bridge. The product entry point has no enrollment/key provisioning yet, so these routes remain unavailable in the normal executable. No Internet listener, account, key provisioning, or public signaling is introduced.

**Tech Stack:** Go 1.23 standard library, Win32 bridge, Node 24 test runner, GitHub Windows VM.

**Spec:** `docs/architecture/goriq-remote-lite-manual.md`; Issue #1831 R1/R5 and formal handoff comment 6307863638.

## Global Constraints

- Preserve `127.0.0.1` binding, local consent, 15-minute limit and protected-desktop refusal.
- Keep the device private key out of the browser and repository; tests use ephemeral keys only.
- No GORIQ main runtime, public service, new credential, OS permission or paid resource change.
- A failed/uncertain status check denies both frame and input. Native release errors remain visible.
- This stage is a local/VM integration, not iPhone, Android, Internet or physical Windows acceptance.

## Review Focus

- Revocation between status and input: deny further input after observed revocation; document the unavoidable in-flight boundary.
- Status service timeout/malformed response: fail closed and stop held input.
- Wrong device/session/expired response: reject without applying input or disclosing a frame.
- Local preview isolation: existing local endpoints continue to require local consent and token.
- Stop failure: do not report a clean release if Windows cannot send key/button UP.

---

### Task 1: Signed status client

**Files:** Create `apps/remote-lite-windows/cmd/localhost/session_gate.go`; test `session_gate_windows_test.go`.

**Interfaces:** Produce `signedStatusGate.Check(context.Context) error` from a coordinator base URL, device/session IDs, injected Ed25519 signer, and bounded HTTP client.

- [x] Write a failing test using an ephemeral Ed25519 key and loopback HTTP fixture that validates the exact challenge message/signature, then returns active, revoked, wrong-device and expired responses.
- [x] Run `go test ./cmd/localhost` on Windows and confirm the feature test fails.
- [x] Implement strict JSON/response bounds, context timeout, exact identity/expiry checks and fail-closed behavior.
- [x] Run the Go test and vet.

### Task 2: Guarded native frame/input routes

**Files:** Modify `apps/remote-lite-windows/cmd/localhost/main_windows.go`; test `remote_routes_windows_test.go`.

**Interfaces:** Consume `signedStatusGate.Check` through an injected gate interface. `/api/remote/frame`, `/api/remote/input`, and `/api/remote/status` always reject without a configured gate; preserve existing local routes.

- [x] Write a failing HTTP test using the real signed gate fixture and a fake desktop bridge: active session yields one frame and one applied manual command; revoke blocks both and stops held input.
- [x] Run the test and confirm failure is due to missing guarded routes.
- [x] Add a shared local token/consent check, fresh status check before each remote frame/input, no-store response, and fail-closed bridge stop on denial.
- [ ] Run Go test/vet/build, Remote Lite Node tests and lint; commit.

### Task 3: Virtual end-to-end and handoff

**Files:** Update `.github/workflows/ci.yml`, `docs/remote-lite/ACCEPTANCE.md` and Issue #1831.

- [ ] Run exact-head Windows VM CI, including real Node/Go status interop and native GDI/SendInput route checks; keep existing Chromium media/DataChannel smoke.
- [ ] Obtain independent review of the security and false-PASS boundaries; repair findings and rerun exact-head checks.
- [ ] Record verified R1/R5 software progress, physical/Internet limits, blockers, next action and revert order in Issue #1831 and Draft PR #1832.
