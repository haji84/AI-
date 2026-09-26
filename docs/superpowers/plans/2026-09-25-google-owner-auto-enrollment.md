# Google Owner Auto-Enrollment Implementation Plan

Date: 2026-09-25
Spec: `docs/superpowers/specs/2026-09-25-google-owner-auto-enrollment-design.md`
Issue: #1218
Branch: `goriq/1218-iphone-owner`

## Context

The native iPhone Owner app is already physically built, signed, installed, and launched. It currently enrolls by manually POSTing the long-lived Production Owner code, then creates a Secure Enclave P-256 device key and receives the existing trusted-device credential.

This plan replaces the manual bootstrap with Google OIDC + PKCE while preserving the existing trusted-device credential/challenge/revocation path. It must never return or transport `JARVIS_OWNER_SECRET` through the Google flow.

## Global constraints

- TDD for every behavior change: write failing test, observe failure, implement, rerun.
- Keep PR #1255 Draft until physical Google enrollment acceptance is complete.
- No live Owner secret rotation.
- No Google/Gmail/Drive scopes beyond `openid email profile`.
- No OAuth tokens, codes, PKCE verifier, nonce, state, device identifiers, Owner secret, or account email in logs/evidence.
- Google OAuth production configuration and the first live Google Owner identity binding are security-sensitive Human Gates.
- Existing Worker identities/history and existing trusted-device credential format must remain unchanged.
- Existing manual Owner code flow remains recovery-only until physical acceptance passes.
- Do not use Google's tokeninfo endpoint as the production verifier.

## File map

### New server units

- `src/app/google-owner-oidc.ts`
  - Google discovery/JWKS loading, ID-token JWT signature and claims verification, PKCE helper validation.
  - No application routing or registry writes.

- `src/app/google-owner-enrollment.ts`
  - Five-minute enrollment-context issue/consume contract.
  - Binds state, nonce, PKCE challenge, device ID and public-key thumbprint.
  - Enforces single-use/replay rejection through the Broker-owned durable state adapter.

- `src/app/google-owner-identity-store.ts`
  - Minimal interface for durable Google Owner binding (`provider/sub/boundAt/version`).
  - First bind requires configured bootstrap email and `email_verified`; subsequent binds require matching `sub`.
  - No secret values in errors/logs.

- `src/app/api/owner-login/google/begin/route.ts`
  - Disabled-by-default endpoint that accepts only device metadata/public key and returns short-lived OAuth enrollment context + public OAuth configuration needed by iOS.

- `src/app/api/owner-login/google/complete/route.ts`
  - Accepts authorization code, PKCE verifier and enrollment context.
  - Exchanges code at Google, validates ID token, binds identity, registers device, returns existing trusted-device credential.

### Existing server units modified

- `src/app/trusted-device-registry-client.ts`
  - Reuse only; add an idempotent registration helper if current Broker API needs it.

- Broker trusted-device state implementation (discover exact file before Task 2)
  - Add durable single-use enrollment-context consumption and minimal Google Owner identity binding.
  - Preserve current registry schema/records.

### iPhone units

- `apps/ios-owner/Sources/GoogleOwnerEnrollment.swift`
  - Generate state/nonce/PKCE.
  - Prepare Secure Enclave device key/public JWK.
  - Run `ASWebAuthenticationSession` against Google's official authorization endpoint.
  - Complete enrollment with GORIQ.
  - Clear transient OAuth material on every terminal path.

- `apps/ios-owner/Sources/OwnerCredentialRuntime.swift`
  - Split device-key creation/storage from manual-code enrollment so Google and recovery paths reuse one trusted-device storage routine.
  - Google enrollment stores trusted credential/device key only. It does not store a Production Owner code.

- `apps/ios-owner/Sources/JarvisIOSOwnerApp.swift`
  - Primary button: `GoogleでOwner登録`.
  - Manual code entry moves under recovery/advanced UI while rollout is incomplete.

- `apps/ios-owner/Info.plist`
  - Registered callback scheme and privacy-safe configuration required by the OAuth flow.
  - No client secret.

- `apps/ios-owner/project.yml`
  - Add only dependencies/settings required by the chosen OAuth implementation. Prefer system `ASWebAuthenticationSession` to avoid an unnecessary SDK dependency unless Google compatibility testing proves the SDK is required.

### Tests

- `tests/google-owner-oidc.test.ts`
- `tests/google-owner-enrollment.test.ts`
- `tests/google-owner-routes.test.ts`
- `tests/ios-owner-google-enrollment.test.mjs`
- existing `tests/ios-owner-security.test.mjs`
- P8 security suite and normal full suite

## Task 1: OIDC verifier and enrollment-context primitives

**Files**
- Create `src/app/google-owner-oidc.ts`
- Create `src/app/google-owner-enrollment.ts`
- Create `tests/google-owner-oidc.test.ts`
- Create `tests/google-owner-enrollment.test.ts`

**RED**
Write tests for:
- issuer/audience/expiry/nonce validation
- unknown `kid` and invalid signature rejection
- `email_verified=false` rejection for bootstrap
- PKCE S256 verifier/challenge match and mismatch
- context expires at five minutes
- state/nonce/device/public-key thumbprint mismatch
- second consumption rejected
- cross-device replay rejected
- errors contain no token/email/secret material

Use deterministic fixture keys/JWKS generated only for tests. No network call in unit tests.

**GREEN**
Implement:
- strict Google OIDC claim validator using Node crypto/JWK verification
- discovery/JWKS fetch with bounded timeout/cache and injectable fetch for tests
- context payload signed/authenticated with an existing server-side secret boundary
- opaque context IDs; no sensitive OAuth material in URL or logs
- storage interface for atomic consume

**Verify**
`node --test tests/google-owner-oidc.test.ts tests/google-owner-enrollment.test.ts`

**Commit**
`feat(owner): add Google OIDC enrollment primitives`

## Task 2: Durable Owner identity binding and single-use state

**Files**
- Discover and modify the Broker trusted-device durable-state implementation.
- Create `src/app/google-owner-identity-store.ts`
- Extend `tests/google-owner-enrollment.test.ts`
- Add focused Broker persistence tests in the existing trusted-device test location.

**RED**
Tests prove:
- first bind succeeds only for exact configured bootstrap email + verified email
- first bind persists immutable Google `sub`
- subsequent bind ignores mutable email and requires same `sub`
- conflicting `sub` rejects
- restart preserves binding and consumed enrollment contexts
- concurrent second consume loses atomically
- existing trusted devices survive unchanged

**GREEN**
Add minimal durable records under the existing Broker-owned state boundary. Do not introduce a second database if the Broker already has an appropriate persistent store.

Use versioned records so a future gated identity migration can be explicit.

**Verify**
Focused persistence tests plus existing trusted-device registry tests.

**Commit**
`feat(owner): persist Google Owner binding and replay state`

## Task 3: Google begin/complete API

**Files**
- Create `src/app/api/owner-login/google/begin/route.ts`
- Create `src/app/api/owner-login/google/complete/route.ts`
- Create `tests/google-owner-routes.test.ts`

**RED**
Route tests:
- feature disabled by default
- malformed device/JWK rejected
- begin returns only public client config + opaque five-minute context
- complete rejects expired/replayed/mismatched context
- Google exchange failure is generic and retry-safe
- wrong Google identity rejected
- successful complete registers device and returns existing `td1` credential
- registry failure never returns success
- no response contains Owner secret
- cache-control no-store everywhere
- rate-limit path rejects abuse without account enumeration

**GREEN**
Implement endpoints with dependency injection points for Google exchange/JWKS and registry in tests.

The complete endpoint exchanges the authorization code using PKCE and validates the returned ID token. It never returns Google access/refresh tokens to iOS.

**Verify**
`node --test tests/google-owner-routes.test.ts tests/google-owner-oidc.test.ts tests/google-owner-enrollment.test.ts`

**Commit**
`feat(owner): add Google auto-enrollment API`

## Task 4: Native iPhone Google enrollment

**Files**
- Create `apps/ios-owner/Sources/GoogleOwnerEnrollment.swift`
- Modify `apps/ios-owner/Sources/OwnerCredentialRuntime.swift`
- Modify `apps/ios-owner/Sources/JarvisIOSOwnerApp.swift`
- Modify `apps/ios-owner/Info.plist`
- Modify `apps/ios-owner/project.yml`
- Create `tests/ios-owner-google-enrollment.test.mjs`
- Extend `tests/ios-owner-security.test.mjs`

**RED**
Static/contract tests prove:
- primary UI has `GoogleでOwner登録`
- state/nonce/PKCE generated from secure randomness
- OAuth callback uses registered scheme and exact state check
- HTTPS GORIQ endpoint only
- no OAuth access/refresh/ID token written to Keychain/UserDefaults/logs
- no Owner secret is required or stored by Google enrollment
- Secure Enclave P-256 key remains device-bound
- cancellation clears transient state
- manual code path is labeled recovery/advanced, not primary

**GREEN**
Implement `ASWebAuthenticationSession` flow and shared trusted-device storage.

Keep OAuth state only in memory for the active enrollment. Use ephemeral browser session where supported. On successful complete, persist only the existing trusted-device credential, device ID and Secure Enclave key material required by current proof.

**Verify**
`node --test tests/ios-owner-google-enrollment.test.mjs tests/ios-owner-security.test.mjs`

Mac physical compile workflow must compile the new Swift sources without signing first.

**Commit**
`feat(owner): add Google enrollment to iPhone Owner`

## Task 5: Integration, negative security and regression

**Files**
- Extend P8/negative security tests in existing locations.
- Update `docs/jarvis-reverse-traceability.json`.
- Update PR #1255 evidence only with non-sensitive facts.

**RED/GREEN cases**
- replay after success
- expiry
- cross-device key substitution
- wrong state/nonce
- wrong audience/issuer
- wrong Google account
- unverified bootstrap email
- registry unavailable
- Google unavailable
- server restart
- revoked iPhone
- logs/artifacts/URLs contain no OAuth code/token/email/Owner secret
- existing manual Owner recovery remains functional
- Worker registry/history unchanged

**Verify**
- focused Google Owner tests
- `pnpm lint`
- `pnpm test`
- `pnpm test:p8-security`
- `pnpm build`
- requirement audit / reverse traceability
- standard PR CI

**Commit**
`test(owner): verify Google enrollment security and regressions`

## Task 6: Physical preflight without live credential issuance

**Files**
- Extend the existing MacBook/iPhone workflow only if required for compile/install.
- No production Google configuration yet.

**Steps**
1. Build on physical MacBook runner.
2. Install/launch on connected iPhone.
3. Confirm Google button renders and manual recovery is not primary.
4. Confirm disabled/missing server configuration produces a safe, specific non-secret error.
5. Capture evidence with account email/device IDs/tokens redacted.

**Expected**
App installs and launches; no Owner credential is issued.

**Commit**
Only if workflow/evidence code needed.

## Task 7: Security Human Gate — Google production configuration

STOP before this task.

Required explicit approval covers:
- creating/configuring the Google OAuth iOS client,
- registering callback/bundle identifiers,
- setting production public client ID/audience and bootstrap Owner email,
- any new production environment/configuration values.

Do not ask the user to paste Google passwords, OAuth tokens or secrets into chat.

After approval:
1. Configure Google OAuth client for the existing iOS bundle.
2. Store server configuration through the approved production secret/config path.
3. Do not create Gmail/Drive scopes or credentials.
4. Re-run physical preflight and verify Google login reaches the server but do not bind Owner yet unless Task 8 is separately approved.

## Task 8: Security Human Gate — first live Owner identity binding

STOP before this task.

Required explicit approval covers issuance of the first live Google Owner binding and trusted-device credential.

After approval:
1. Owner taps `GoogleでOwner登録` on the connected iPhone.
2. Owner authenticates directly in Google's UI.
3. Server verifies and atomically binds the Google `sub`.
4. iPhone receives trusted-device credential.
5. Verify challenge/signature succeeds.
6. Verify no Production Owner code was entered/displayed.
7. Verify device appears in trusted registry.
8. Revoke in a controlled acceptance check, verify use is blocked, then re-enroll only if the owner explicitly wants the device left registered.
9. Record only redacted evidence.

## Task 9: Finish PR #1255 and #1218 acceptance

**Checks**
- All CI green.
- Physical Google enrollment evidence complete.
- Revocation behavior evidenced.
- Recovery path documented and tested.
- No live secret/token/account identifier in GitHub evidence.
- PR body updated to reflect actual head and evidence.
- Independent review of full diff.
- Merge only if repository gates permit.
- Close #1218 only if every acceptance item is evidenced; otherwise leave open with exact remaining blocker.

## Review focus

Final review must deliberately inspect:
- OAuth token/code leakage through errors, URLs and Actions logs
- OIDC signature/issuer/audience/nonce correctness
- replay race conditions around one-time consume
- first-bind race conditions
- Google `sub` vs email semantics
- half-written identity/device registration
- Secure Enclave/Keychain persistence semantics
- loss/revocation behavior
- regression to existing Owner/Worker authentication boundaries
