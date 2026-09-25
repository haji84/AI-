# GORIQ Owner Google Auto-Enrollment Design

Date: 2026-09-25
Issue: #1218
PR branch: `goriq/1218-iphone-owner`

## Purpose

Replace manual entry of the long-lived Production Owner code on iPhone with a secure, iPhone-first Google sign-in flow. The owner should be able to install/open GORIQ Owner, tap one button, authenticate with the approved Google account, complete Face ID/user-presence confirmation, and become a trusted Owner Fleet device without typing or exposing `JARVIS_OWNER_SECRET`.

The existing ZBook-local recovery path remains authoritative. The Google flow is an additional enrollment path, not a remote secret-recovery endpoint.

## Success criteria

1. Fresh iPhone installation can enroll without typing the Production Owner code.
2. Only the configured Google identity may bootstrap the first Owner identity binding.
3. After first binding, authorization uses the immutable Google `sub` identifier, not mutable display name or email alone.
4. The iPhone generates its device key locally; private key material never leaves Secure Enclave/ThisDeviceOnly storage.
5. Enrollment creates a normal GORIQ trusted-device credential and durable registry entry.
6. The long-lived Production Owner secret is never returned to the iPhone by the Google enrollment API, written to URLs, logs, telemetry, GitHub, or browser storage.
7. Existing trusted-device proof, revocation, reveal/copy protections, and Owner Fleet data remain intact.
8. OAuth cancellation, wrong account, replay, expired authorization, nonce/state mismatch, cross-device reuse, and registry failure fail closed.
9. Existing registered devices and Worker enrollment/history are unchanged.

## Chosen architecture

### iPhone

The native GORIQ Owner app adds a primary **GoogleでOwner登録** action.

Before authentication it creates or loads a device-bound Secure Enclave P-256 key and prepares the public JWK and device ID. Authentication uses Google's supported iOS sign-in/OAuth flow. The client requests identity scopes only (`openid email profile`); no Drive/Gmail scopes or offline access are needed.

OAuth browser/session state is ephemeral where the platform permits. The app does not persist authorization codes, access tokens, refresh tokens, ID tokens, PKCE verifiers, state, or nonce after enrollment.

### Broker / Next.js

Add a dedicated Google Owner enrollment boundary separate from `/api/owner-login`.

The server validates:
- Google token signature against Google JWKS/discovery metadata,
- issuer,
- audience/client ID,
- expiry,
- nonce binding,
- `email_verified == true`,
- configured bootstrap email on first binding,
- configured immutable Google `sub` on subsequent enrollment.

The Google `sub` becomes the canonical Owner identity after the first successful binding. The bootstrap email is only a first-bind gate and is never used as the durable identity key.

The server then issues the same trusted-device credential format already used by GORIQ and calls the existing trusted-device registry. No new device-credential format is introduced.

### Identity binding storage

Persist only the minimum Owner identity binding required for enrollment:
- provider = google
- Google `sub`
- normalized bootstrap email only if required for audit/display
- bound-at timestamp/version

The binding belongs in the existing Broker-owned durable state boundary, not in Vercel process memory and not in iPhone UserDefaults.

Changing or clearing this binding is a credential/identity change and remains a Human Gate.

## OAuth flow

1. iPhone generates random `state`, `nonce`, and PKCE verifier/challenge.
2. iPhone opens Google's official authorization flow for the configured iOS OAuth client.
3. Google returns an authorization result to the app's registered callback.
4. The app sends the authorization result plus its public JWK/device metadata and the original nonce-bound enrollment context to the GORIQ Google enrollment endpoint over HTTPS POST.
5. Server validates OAuth/OIDC cryptographically and validates the Owner identity policy.
6. Server atomically binds the Google `sub` if this is the first successful bootstrap.
7. Server registers the device and returns only the trusted-device credential plus non-secret enrollment metadata.
8. iPhone stores the trusted-device credential and device key in ThisDeviceOnly Keychain/Secure Enclave storage.
9. Transient OAuth material is destroyed.
10. Existing trusted-device challenge/signature verification becomes the normal authentication path. Google is not required for every reveal/copy.

The Production Owner code is deliberately absent from this flow.

## Replay and one-time semantics

The enrollment context is short-lived (60 seconds), single-use, and bound to:
- OAuth state,
- nonce,
- PKCE challenge,
- device ID,
- device public-key thumbprint,
- OAuth client/audience.

Consumption is atomic. A second use, different public key, different device ID, expired context, or mismatched nonce/state returns a generic enrollment failure without disclosing which identity check failed.

## Revocation and loss

Existing trusted-device revocation remains authoritative. A revoked iPhone cannot pass trusted-device proof even if its local Keychain still exists.

App deletion or device reset creates a new device identity. Re-enrollment through the already-bound Google `sub` is allowed, but it does not silently overwrite or un-revoke the old device record.

Google outages block new enrollment only. Existing trusted devices continue to use GORIQ's own challenge/signature path.

## Failure handling

- User cancels Google: no device registration; transient OAuth state deleted.
- Wrong Google account: 403-equivalent generic Owner identity rejection.
- Unverified email on first bootstrap: reject.
- Token/JWKS/discovery unavailable: 503-style retryable failure; never fall back to email-only trust.
- Registry write failure: do not report enrollment success; do not leave a usable local credential.
- Identity binding succeeds but device registration fails: transaction/compensation must avoid a half-enrolled device; retry must be idempotent.
- Existing binding conflicts with presented `sub`: reject and require gated recovery.

## Configuration

Configuration names are committed; values are not.

Expected server configuration:
- Google OAuth client/audience ID
- approved bootstrap email
- bound Google subject stored durably after first bootstrap

No Google client secret is embedded in the iOS binary. If the chosen Google iOS SDK/client flow exposes a client identifier, that identifier is treated as public application configuration, not a secret.

Production OAuth configuration creation/change and first live Owner identity binding remain explicit security-sensitive actions.

## Security boundaries

- No endpoint returns `JARVIS_OWNER_SECRET`.
- No ID/access/refresh token is logged or included in evidence.
- No OAuth credential is placed in a URL controlled by GORIQ.
- HTTPS only; redirects are constrained to the registered OAuth callback.
- Existing Owner code login remains available as a recovery path until the Google flow is physically accepted.
- Google token validation uses production signature verification; Google's tokeninfo endpoint is not used as the production verifier.
- Rate-limit enrollment attempts and avoid account-enumeration error detail.
- App Check/App Attest can be layered after baseline acceptance; it is defense in depth, not a substitute for OIDC verification.

## Testing

### Unit / contract
- state/nonce/PKCE generation and mismatch rejection
- Google ID token issuer/audience/expiry/signature validation
- first-bind exact bootstrap email + `email_verified`
- subsequent-bind `sub` match independent of mutable email
- wrong account rejection
- 60-second expiry and second-use replay rejection
- cross-device public-key substitution rejection
- no Owner secret/token in logs, URLs, artifacts, UserDefaults
- idempotent retry and registry-failure compensation

### Integration
- mocked Google OIDC/JWKS path through enrollment endpoint
- trusted-device credential returned and existing challenge/verify succeeds
- revocation blocks the enrolled iPhone
- existing Owner code path and Worker identities remain unchanged

### Physical acceptance
On the connected iPhone:
1. install updated app,
2. tap GoogleでOwner登録,
3. authenticate with the approved Google account,
4. complete Face ID/user presence,
5. confirm registered state,
6. verify trusted-device challenge succeeds,
7. verify revoke blocks subsequent use,
8. verify no Production Owner code was typed or displayed during Google enrollment.

## Rollout

1. Implement behind a disabled-by-default server configuration gate.
2. Run unit/integration/security tests and normal CI.
3. Configure Google OAuth client only after explicit approval.
4. Deploy configuration only after explicit approval.
5. Perform first live Google Owner binding only after explicit approval.
6. Keep manual recovery path until physical acceptance is complete.
7. After acceptance, make Google auto-enrollment the primary iPhone onboarding UI; manual code entry moves to recovery/advanced UI.

## Non-goals

- No Google Drive/Gmail access.
- No refresh-token storage.
- No automatic Google account migration.
- No automatic Owner identity reset.
- No removal of ZBook-local recovery.
- No Worker re-enrollment or fleet-history migration.
