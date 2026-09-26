# iPhone Owner Recovery Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the iPhone/ZBook Production Owner-code reveal path with a trusted-iPhone flow that issues a five-minute, one-use code for enrolling one additional Owner device key.

**Architecture:** Extend the Broker-owned trusted-device registry so recovery issuance, rate metadata, target registration, and code consumption share one durable file and one lock. Next.js requires a freshly issued device-bound Owner session to issue/cancel, validates the redeeming P-256 public key using the existing credential constructor, and delegates state mutation to the Broker. The iOS app keeps issued codes only in volatile memory, clears them on backgrounding, and supports both issuing from an enrolled iPhone and redeeming on a new iPhone.

**Tech Stack:** TypeScript, Node.js `node:test`, Next.js route handlers, Broker JSON persistence, Swift 6/SwiftUI, CryptoKit/Secure Enclave, Python source-contract tests, XcodeGen/Xcode CI.

**Spec:** `docs/superpowers/specs/2026-09-26-iphone-owner-recovery-enrollment-design.md`

## Global Constraints

- [ ] Keep `JARVIS_OWNER_SECRET`, raw recovery codes, credentials, private keys, account identifiers, device identifiers, and tunnel URLs out of logs and committed evidence.
- [ ] Never accept a recovery code at `/api/owner-login`, Worker enrollment, credential rotation, Human Gate, or general action endpoints.
- [ ] Use HTTPS POST JSON only. Set `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on all recovery responses.
- [ ] Keep Google enrollment, existing trusted-device challenge/verify, current Owner Fleet identities/history, and Worker identities/history behavior unchanged.
- [ ] Preserve legacy `owner-production-code` Keychain data until the owner explicitly re-registers with Google or explicitly deletes local data; do not reveal, copy, or create it in the new UI.
- [ ] Gate recovery routes with `GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED === "1"`; default and missing values deny.
- [ ] Do not deploy, enable Production configuration, merge the PR, delete devices, or rotate a secret under this implementation plan. Those remain separate Human Gates.
- [ ] Baseline before edits: record `git status --short`, `git rev-parse HEAD`, and run the focused existing Owner tests. Roll back only the commits from this plan; never reset unrelated work or delete production state.

## Review Focus

- [ ] Confirm the issue route cannot be used with a passcode-only or stale Owner session.
- [ ] Confirm the raw code is returned once and is absent from every persisted object, error, log, URL, cookie, and test evidence artifact.
- [ ] Confirm trusted-device registration and one-time consumption occur in one locked read-modify-save operation.
- [ ] Confirm issuer revocation, cancellation, replacement, expiry, replay, malformed input, rate exhaustion, and registry failure all fail closed.
- [ ] Confirm successful redemption does not create an Owner session; the target must challenge/sign/verify its new key.
- [ ] Confirm the iPhone clears code and countdown on backgrounding and does not use Keychain, UserDefaults, files, or pasteboard for the raw recovery code.
- [ ] Confirm legacy manual enrollment UI and new long-lived-code storage are removed without silently deleting previously stored legacy data.

---

## Task 1: Add fresh trusted-session claims

**Files:**

- Modify: `src/app/owner-auth.ts`
- Modify: `src/app/api/jarvis/broker.ts`
- Modify: `tests/owner-auth.test.ts`
- Create: `tests/owner-recovery-session.test.ts`

- [ ] Add failing tests for a typed session parser that returns `{ deviceId, issuedAtSeconds }` only for a valid `v3` device-bound session and rejects `v2`, expired, future, malformed, and tampered tokens.
- [ ] Add failing tests for `verifyFreshTrustedOwnerSessionAccess`: accept a non-revoked `v3` session at the freshness boundary; reject it one second later, reject a revoked issuer, and fail closed when the Broker revocation lookup throws.
- [ ] Run `node --test tests/owner-auth.test.ts tests/owner-recovery-session.test.ts` and confirm the new assertions fail for missing exports.
- [ ] In `src/app/owner-auth.ts`, introduce an exported `ownerSessionClaims(secret, token, options?)` parser that performs the current signature/time validation once and returns typed claims without weakening `verifyOwnerSessionToken` or `verifyOwnerSessionBinding`.
- [ ] In `src/app/api/jarvis/broker.ts`, add `verifyFreshTrustedOwnerSessionAccess(secret, token, maxAgeSeconds = 120)` returning the bound device ID or `null`; use the existing Broker revocation lookup and fail closed.
- [ ] Keep `requireJarvisOwner()` behavior unchanged for existing callers.
- [ ] Re-run `node --test tests/owner-auth.test.ts tests/owner-recovery-session.test.ts` and confirm green.
- [ ] Commit: `git add src/app/owner-auth.ts src/app/api/jarvis/broker.ts tests/owner-auth.test.ts tests/owner-recovery-session.test.ts && git commit -m "feat(owner): require fresh trusted recovery sessions"`

## Task 2: Make recovery state and target registration atomic

**Files:**

- Modify: `src/jarvis/trusted-device-registry.ts`
- Modify: `tests/trusted-device-registry.test.ts`
- Create: `tests/owner-recovery-registry.test.ts`

- [ ] Add failing tests proving the registry can read the existing version-1 `{ version, devices }` file without changing devices or revocations.
- [ ] Add failing tests for `issueRecovery`: only a registered, non-revoked issuer may issue; the third successful issue in an hour succeeds and the fourth fails; a new issue cancels the prior active record; the returned record contains no raw code.
- [ ] Add failing tests for recovery-code format and normalization: `OR-XXXX-XXXX-XXXX-XXXX`, sixteen unambiguous base32 symbols, case/separator normalization, and malformed input rejection.
- [ ] Add failing tests proving the JSON file contains an HMAC-SHA-256 digest but not the raw code or display form.
- [ ] Add failing tests for `redeemRecovery`: accept before/at the five-minute boundary as specified by the design, reject after it, compare digests in constant time, reject wrong/replayed/cancelled/replaced codes, and reject when the issuer is revoked.
- [ ] Add failing tests that two competing consumes produce exactly one registered target and one success, with no duplicate device entry.
- [ ] Add failing tests that target `deviceId`, label, and public-key thumbprint are bound into consumed metadata; a revoked target ID cannot be reactivated.
- [ ] Add failing tests for bounded redeem attempts: ten attempts per HMACed source bucket and one hundred attempts globally within a five-minute window; raw IP/source text is never persisted. Confirm pruning keeps only bounded non-secret audit metadata.
- [ ] Add a failure-injection test showing a save error yields neither a consumed record nor a registered target after reopening the last durable file.
- [ ] Run `node --test tests/trusted-device-registry.test.ts tests/owner-recovery-registry.test.ts` and confirm red.
- [ ] Add an exclusive `.lock` directory around every trusted-device mutation, matching the fail-closed pattern in `GoogleOwnerStateRegistry`.
- [ ] Extend the trusted-device file with validated optional recovery state while continuing to accept existing version-1 files. Keep devices and recovery metadata in the same JSON document so one atomic temp-file rename commits target registration and consumption together.
- [ ] Implement code generation with `randomBytes(10)`, an unambiguous 32-symbol alphabet, display formatting, normalization, HMAC-SHA-256 using the Broker owner token, and `timingSafeEqual`.
- [ ] Implement `issueRecovery`, `cancelRecovery`, and `redeemRecovery` with injected `now`/randomness for deterministic tests. Persist digests and HMACed source buckets only, never raw values.
- [ ] Ensure all registry parsing is size-bounded and fail-closed, and all state collections have explicit capacity/pruning limits.
- [ ] Re-run `node --test tests/trusted-device-registry.test.ts tests/owner-recovery-registry.test.ts` and confirm green.
- [ ] Commit: `git add src/jarvis/trusted-device-registry.ts tests/trusted-device-registry.test.ts tests/owner-recovery-registry.test.ts && git commit -m "feat(owner): persist one-time recovery enrollment state"`

## Task 3: Expose the authenticated Broker recovery contract

**Files:**

- Modify: `scripts/jarvis-broker.ts`
- Create: `src/app/owner-recovery-registry-client.ts`
- Create: `tests/owner-recovery-broker.test.ts`
- Create: `tests/owner-recovery-broker-contract.test.mjs`

- [ ] Add an integration harness that starts the Broker with temporary `JARVIS_DB_PATH` and distinct test owner token.
- [ ] Add failing tests for `POST /api/jarvis/admin/owner-recovery` actions `issue`, `cancel`, and `redeem`; unauthenticated requests return 401 and oversize/unknown actions return a generic 400/409 without echoing input.
- [ ] Test that issue checks the issuer in the trusted-device registry, returns `{ code, expiresAt }`, and includes no-store/no-referrer headers.
- [ ] Test that redeem receives normalized code, target device metadata, public-key thumbprint, and HMACed source bucket; it registers/consumes once and returns non-secret target metadata only.
- [ ] Test cancel is idempotent for the authenticated issuing device and cannot cancel another issuer's record.
- [ ] Test issuer revocation invalidates an outstanding record and that concurrent Broker redeems yield one success.
- [ ] Add a static contract test proving the recovery route remains inside the existing `/api/jarvis/admin/` `requireOwner` boundary and does not reuse Worker invitation APIs.
- [ ] Run `node --test tests/owner-recovery-broker.test.ts tests/owner-recovery-broker-contract.test.mjs` and confirm red.
- [ ] Instantiate the enhanced registry with the existing `JARVIS_OWNER_TOKEN` as its HMAC key; reject Broker startup if the existing owner token invariant is not met.
- [ ] Add the bounded admin action handler. Never log payloads or returned raw code, and add `Referrer-Policy: no-referrer` to its recovery responses.
- [ ] Implement `owner-recovery-registry-client.ts` with five-second aborts, schema validation, generic errors, and typed `issueOwnerRecovery`, `cancelOwnerRecovery`, and `redeemOwnerRecovery` functions.
- [ ] Re-run the focused Broker tests and existing `node --test tests/trusted-device-registry.test.ts tests/google-owner-broker-contract.test.mjs`.
- [ ] Commit: `git add scripts/jarvis-broker.ts src/app/owner-recovery-registry-client.ts tests/owner-recovery-broker.test.ts tests/owner-recovery-broker-contract.test.mjs && git commit -m "feat(owner): add broker recovery enrollment API"`

## Task 4: Add testable recovery service and Next.js routes

**Files:**

- Create: `src/app/owner-recovery-service.ts`
- Create: `src/app/api/owner-login/trusted/recovery/issue/route.ts`
- Create: `src/app/api/owner-login/trusted/recovery/redeem/route.ts`
- Create: `src/app/api/owner-login/trusted/recovery/cancel/route.ts`
- Create: `tests/owner-recovery-service.test.ts`
- Create: `tests/owner-recovery-routes.test.mjs`

- [ ] Add service tests for issue/cancel authorization inputs and for redeem validation of `deviceId`, trimmed label, recovery-code syntax, and P-256 public JWK via the existing `createTrustedDeviceCredential` validation path.
- [ ] Add tests proving credential construction happens before the Broker mutation, Broker receives only the public-key thumbprint (not the credential/private key), and no credential is returned if Broker registration/consume fails.
- [ ] Add tests proving successful redeem returns the existing credential format but creates no Owner session or cookie.
- [ ] Add route contract tests proving every route is disabled by default, uses POST, has body-size/JSON guards, returns generic Japanese failures, and adds `Cache-Control: no-store` plus `Referrer-Policy: no-referrer`.
- [ ] Add tests proving issue/cancel read `OWNER_SESSION_COOKIE`, require a fresh device-bound session, and bind the Broker action to that session's issuer device ID.
- [ ] Add tests proving redeem derives a source bucket from the platform forwarding address, HMACs it before persistence, never stores/logs the address, and falls back to a single bounded anonymous bucket if no trusted address exists.
- [ ] Add a negative source audit proving the new code is not referenced by `/api/owner-login`, Worker enrollment, rotation, requirements, or action routes.
- [ ] Run `node --test tests/owner-recovery-service.test.ts tests/owner-recovery-routes.test.mjs` and confirm red.
- [ ] Implement the pure orchestration service with dependency injection, using `publicKeyThumbprint`, `createTrustedDeviceCredential`, and the typed Broker client.
- [ ] Implement the three route handlers. Issue/cancel use the 120-second fresh trusted session helper. Redeem is unauthenticated but feature-gated/rate-bounded and never sets `OWNER_SESSION_COOKIE`.
- [ ] Return 503 while disabled or when required secrets/services are unavailable, 401 for issue/cancel auth failure, 400 for malformed requests, 403 for generic rejected redemption, and 503 for retryable registry unavailability without revealing which predicate failed.
- [ ] Re-run the focused service/route tests plus `node --test tests/trusted-device-auth.test.ts tests/google-owner-routes.test.mjs tests/google-owner-service.test.ts`.
- [ ] Commit: `git add src/app/owner-recovery-service.ts src/app/api/owner-login/trusted/recovery tests/owner-recovery-service.test.ts tests/owner-recovery-routes.test.mjs && git commit -m "feat(owner): add recovery enrollment routes"`

## Task 5: Issue, display, clear, and cancel on the trusted iPhone

**Files:**

- Modify: `apps/ios-owner/Sources/OwnerCredentialRuntime.swift`
- Modify: `apps/ios-owner/Sources/JarvisIOSOwnerApp.swift`
- Modify: `apps/ios-owner/Tests/test_signing_access.py`
- Modify: `tests/ios-owner-security.test.mjs`
- Create: `tests/ios-owner-recovery-enrollment.test.mjs`

- [ ] Add failing iOS source-contract tests for a `recoveryCode` and `recoveryExpiresAt` volatile state, with no Keychain/UserDefaults/file/pasteboard write of that value.
- [ ] Add a failing ordering test proving `issueRecoveryCode()` calls `verifyTrustedDeviceProof()` before `/api/owner-login/trusted/recovery/issue`.
- [ ] Add failing tests for exact registered-state actions: `Face IDと端末鍵でログイン`, `別端末の復旧コードを表示`, `Googleで端末鍵を再登録`, revocation/delete, and local delete.
- [ ] Add failing tests that the displayed `OR-` code and live expiry countdown are privacy-sensitive, non-selectable, have no copy button, and offer explicit hide/cancel.
- [ ] Add failing tests that scene deactivation calls a method that clears both code and expiry; app initialization/relaunch has no restoration source for either.
- [ ] Run `node --test tests/ios-owner-security.test.mjs tests/ios-owner-recovery-enrollment.test.mjs && python3 apps/ios-owner/Tests/test_signing_access.py` and confirm red.
- [ ] Replace `revealedCode` with volatile recovery display state. After fresh proof, POST issue and validate only the expected `OR-` form and integer expiry before publishing UI state.
- [ ] Implement `hideRecoveryCode()` as an in-memory clear and `cancelRecoveryCode()` as server cancel followed by local clear. Backgrounding always clears locally without waiting on network.
- [ ] Render the recovery code with monospaced privacy-sensitive text and a countdown derived from `expiresAt`; disable stale display at expiry. Do not add copy/share/text-selection behavior.
- [ ] Rename the normal proof action to `Face IDと端末鍵でログイン` while preserving the existing challenge/verify implementation and HttpOnly cookie behavior.
- [ ] Re-run the focused Node/Python tests and confirm green.
- [ ] Commit: `git add apps/ios-owner/Sources/OwnerCredentialRuntime.swift apps/ios-owner/Sources/JarvisIOSOwnerApp.swift apps/ios-owner/Tests/test_signing_access.py tests/ios-owner-security.test.mjs tests/ios-owner-recovery-enrollment.test.mjs && git commit -m "feat(ios-owner): display volatile recovery enrollment codes"`

## Task 6: Redeem on a new iPhone and retire manual Production-code enrollment

**Files:**

- Modify: `apps/ios-owner/Sources/OwnerCredentialRuntime.swift`
- Modify: `apps/ios-owner/Sources/JarvisIOSOwnerApp.swift`
- Modify: `apps/ios-owner/Tests/test_signing_access.py`
- Modify: `tests/ios-owner-google-enrollment.test.mjs`
- Modify: `tests/ios-owner-security.test.mjs`
- Modify: `tests/ios-owner-recovery-enrollment.test.mjs`

- [ ] Add failing tests that the unregistered view accepts only the short Owner recovery code and no longer contains a Production Owner code field, `enroll(code:)`, masked long-lived-code row, reveal/copy/change controls, or `UIPasteboard`/`UniformTypeIdentifiers` use.
- [ ] Add failing tests that redemption generates a new Secure Enclave P-256 key with `.userPresence` and `.privateKeyUsage`, sends only its public JWK, device ID, label, and entered recovery code, and stores the returned trusted credential in device-only Keychain storage.
- [ ] Add a failing ordering test proving the new iPhone immediately performs normal challenge/signature verification before setting `isEnrolled = true` or showing success.
- [ ] Add failure-path tests that malformed/rejected/expired codes never mark the device enrolled and never persist the entered code.
- [ ] Add a compatibility test that `owner-production-code` remains only as a legacy deletion account: Google re-registration and explicit local deletion remove it, but app startup/backgrounding do not silently delete it.
- [ ] Run the focused Node/Python tests and confirm red.
- [ ] Implement `enrollWithRecoveryCode(_:)`: create the protected key locally, call `/redeem`, store only key/credential/device ID, prove the new key, then publish enrolled/logged-in state.
- [ ] On a post-redemption proof failure, fail closed with a retry/re-register message and do not present a logged-in state; never fall back to Google or Production Owner code automatically.
- [ ] Remove new manual Production-code enrollment/storage/reveal/copy UI and helpers. Retain the legacy Keychain account constant solely for explicit migration cleanup in `storeTrustedDevice(... recoveryCode: nil)`/Google re-registration and `forgetLocal()`.
- [ ] Re-run `node --test tests/ios-owner-google-enrollment.test.mjs tests/ios-owner-security.test.mjs tests/ios-owner-recovery-enrollment.test.mjs && python3 apps/ios-owner/Tests/test_signing_access.py`.
- [ ] Commit: `git add apps/ios-owner/Sources/OwnerCredentialRuntime.swift apps/ios-owner/Sources/JarvisIOSOwnerApp.swift apps/ios-owner/Tests/test_signing_access.py tests/ios-owner-google-enrollment.test.mjs tests/ios-owner-security.test.mjs tests/ios-owner-recovery-enrollment.test.mjs && git commit -m "feat(ios-owner): enroll new devices with recovery codes"`

## Task 7: Document configuration, security boundaries, and traceability

**Files:**

- Modify: `apps/ios-owner/README.md`
- Modify: `docs/architecture/jarvis-remote-access.md`
- Modify: `docs/requirement-traceability.md`
- Create: `docs/architecture/iphone-owner-recovery-enrollment.md`
- Create: `tests/owner-recovery-security-contract.test.mjs`

- [ ] Add a failing static security test that scans the recovery implementation for URL query construction, cookies containing recovery data, console/logger payload output, browser storage, pasteboard, and persistence of raw-code-shaped fields.
- [ ] Add a failing contract test that the feature flag is checked in all three public routes and that no enabled default is committed.
- [ ] Document the state machine, five-minute/one-use boundary, fresh-session requirement, Broker atomicity, rate limits, issuer revocation, target proof, and generic errors.
- [ ] Document operator rollout/rollback: flag off by default, no secret rotation, no device deletion, active records rejected while disabled, existing trusted targets retained after rollback.
- [ ] Update iOS README usage: registered iPhone displays; new iPhone enters; neither device handles the Production Owner secret. Include the explicit legacy cleanup behavior.
- [ ] Update Issue #1218 traceability rows without claiming Production deployment or physical acceptance.
- [ ] Run `node --test tests/owner-recovery-security-contract.test.mjs tests/owner-recovery-routes.test.mjs tests/ios-owner-recovery-enrollment.test.mjs` and confirm green.
- [ ] Commit: `git add apps/ios-owner/README.md docs/architecture/jarvis-remote-access.md docs/requirement-traceability.md docs/architecture/iphone-owner-recovery-enrollment.md tests/owner-recovery-security-contract.test.mjs && git commit -m "docs(owner): document recovery enrollment boundary"`

## Task 8: Verify the implementation without deploying

**Files:**

- Modify only if a test exposes a defect; add a regression test before each fix.

- [ ] Run the focused recovery suite:
  `node --test tests/owner-auth.test.ts tests/owner-recovery-session.test.ts tests/trusted-device-registry.test.ts tests/owner-recovery-registry.test.ts tests/owner-recovery-broker.test.ts tests/owner-recovery-broker-contract.test.mjs tests/owner-recovery-service.test.ts tests/owner-recovery-routes.test.mjs tests/owner-recovery-security-contract.test.mjs tests/trusted-device-auth.test.ts tests/ios-owner-google-enrollment.test.mjs tests/ios-owner-security.test.mjs tests/ios-owner-recovery-enrollment.test.mjs`
- [ ] Run `python3 apps/ios-owner/Tests/test_signing_access.py`.
- [ ] Run `pnpm test` and record only counts/statuses, not secrets or raw recovery values.
- [ ] Run `pnpm test:p8-security`.
- [ ] Run repository lint/type/build commands required by `package.json` and current CI.
- [ ] If macOS/Xcode tooling is available, run `cd apps/ios-owner && xcodegen generate` followed by the same simulator/device-independent build command used in `.github/workflows/iphone-owner-build-1218.yml`; otherwise leave this as CI-required evidence and do not claim a local iOS build.
- [ ] Inspect `git diff --check`, `git status --short`, and `git log --oneline` to confirm no generated project, secret, raw code, unrelated file, or evidence artifact was committed.
- [ ] Review every item in **Global Constraints** and **Review Focus** against the final diff.
- [ ] Use `superpowers:requesting-code-review` for a whole-branch review against the approved spec; address findings with tests and focused commits.
- [ ] Use `superpowers:verification-before-completion` before claiming implementation complete.
- [ ] Do not enable `GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED`, update Production environment, install on a physical phone, redeem a real code, or move PR #1255 out of Draft without a separate explicit authorization and acceptance checklist.
- [ ] Final verification commit only if needed: `git commit -m "test(owner): verify recovery enrollment flow"`.

## Deferred authorized follow-up

After implementation review and a separate Production/physical-test authorization:

- [ ] Enable the feature only for the approved environment and exact verified commit.
- [ ] Install the exact CI artifact on the trusted iPhone and one test Owner iPhone.
- [ ] Record redacted evidence for issue 200, redeem 200, target challenge/verify 200, replay rejection, cancellation/revocation rejection, and unchanged Worker/Fleet counts.
- [ ] Never capture the recovery code, email, device ID, credential, secret, or tunnel URL in screenshots, logs, comments, or evidence files.
- [ ] Disable the flag to roll back if any acceptance condition fails; do not delete successfully registered devices as part of rollback.
