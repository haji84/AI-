# iPhone Owner Recovery Enrollment Design

Date: 2026-09-26
Issue: #1218
PR branch: `goriq/1218-iphone-owner`

## Purpose

A trusted iPhone becomes the normal recovery origin for adding another Owner terminal. The owner authenticates with Face ID and the iPhone's registered Secure Enclave key, requests a short-lived recovery code, reads that code from the iPhone, and enters it on the new terminal. The new terminal generates its own key and redeems the code once to become a trusted Owner terminal.

This replaces the proposed ZBook reveal/copy workflow and the legacy iPhone flow that stored, revealed, or copied the long-lived Production Owner code. It does not move `JARVIS_OWNER_SECRET` to the iPhone and does not make the recovery code a general Owner password.

## Owner intent

- Recovery starts from the trusted iPhone, not from a ZBook credential display.
- The iPhone displays a recovery code for registering another Owner terminal.
- Normal iPhone use remains Google bootstrap followed by Face ID and device-key proof.
- The long-lived Production Owner code is not typed, displayed, copied, returned, or stored on the iPhone.
- Production Owner secret rotation remains a separate protected recovery operation and is not authorized by a recovery code.

## Success criteria

1. A currently trusted, non-revoked iPhone can issue a recovery code only after a fresh Face ID and device-key challenge/signature verification.
2. The iPhone displays the recovery code and a visible expiry countdown without persisting it to Keychain, UserDefaults, files, pasteboard, analytics, or logs.
3. The recovery code expires after five minutes, is accepted once, and is scoped only to registering one new Owner terminal key.
4. The redeeming terminal generates its own P-256 key before redemption; no private key crosses the network.
5. Successful redemption creates the existing trusted-device credential and durable registry record, then consumes the recovery code atomically.
6. A used, expired, revoked, malformed, guessed, or replayed code fails closed with generic error detail.
7. Revoking the issuing iPhone invalidates any recovery code that it issued and has not yet consumed.
8. At most one recovery code is active for the Owner identity. Issuing a replacement invalidates the previous code.
9. `JARVIS_OWNER_SECRET` and the raw recovery code never appear in URLs, cookies, browser storage, repository content, observability, evidence, or server logs.
10. Existing Owner Fleet identities, Worker identities, history, queues, and current trusted-device credentials remain unchanged.

## Chosen architecture

### Authentication origin

The iPhone uses the existing trusted-device path:

1. request `/api/owner-login/trusted/challenge` with its existing trusted credential,
2. require Secure Enclave signing with user presence,
3. submit the signature to `/api/owner-login/trusted/verify`,
4. receive the existing device-bound, HttpOnly Owner session cookie in the app's ephemeral URL session,
5. immediately request a recovery enrollment code.

No new bearer session format is introduced. The recovery issue endpoint requires the existing Owner session and rejects a session whose bound device has been revoked or cannot be checked.

### Recovery code

The displayed form is `OR-XXXX-XXXX-XXXX-XXXX`. The sixteen symbols use an unambiguous 32-character alphabet and provide 80 bits of randomness. Separators are presentation-only; redemption normalizes case and separators before validation.

The code is:

- valid for five minutes,
- valid for one successful registration,
- limited to trusted Owner terminal enrollment,
- unrelated to the Production Owner secret,
- never accepted by `/api/owner-login`, JARVIS action routes, rotation routes, or Worker enrollment.

The iPhone keeps the raw value in memory only while the protected view is active. Moving the app out of the active scene clears the displayed value and countdown. A hidden or cleared display does not extend expiry. The owner may issue a replacement after authenticating again; replacement invalidates the earlier code.

### Broker-owned durable state

The Broker persists one active recovery record through its existing durable state boundary. The record contains only:

- schema version,
- random record identifier,
- HMAC-SHA-256 digest of the normalized code using the existing Broker Owner secret,
- issuing trusted-device ID,
- issued-at and expires-at timestamps,
- optional consumed-at timestamp,
- optional registered target device ID after successful consumption.

The raw code is returned once to the issuing iPhone and is never persisted. A durable compare-and-consume operation validates the digest, issuer status, expiry, unused state, target key, and registration result under one serialized mutation. A registration failure leaves no usable target credential and does not report success.

This state is separate from the Worker invitation store. Worker invitations are reusable fleet enrollment credentials with different authority and acceptance rules; reusing that contract would accidentally broaden Owner enrollment authority.

## API boundaries

### Issue

`POST /api/owner-login/trusted/recovery/issue`

Requirements:

- valid device-bound Owner session created by a fresh trusted-device proof,
- issuing device exists and is not revoked,
- request uses HTTPS and accepts JSON,
- issuance rate limit passes.

Success response:

```json
{
  "code": "OR-XXXX-XXXX-XXXX-XXXX",
  "expiresAt": 0
}
```

The response uses `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The raw code is not placed in a URL, cookie, response header, trace attribute, or console message.

### Redeem

`POST /api/owner-login/trusted/recovery/redeem`

Request body:

```json
{
  "code": "OR-XXXX-XXXX-XXXX-XXXX",
  "deviceId": "new_device_generated_id",
  "label": "Owner terminal label",
  "publicKeyJwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  }
}
```

The endpoint validates the code and target key, checks the issuing device's current revocation state, creates the existing trusted-device credential, registers the target device, and consumes the record atomically. It returns only the target trusted-device credential and non-secret expiry/label metadata.

The redeem endpoint does not create a general Owner session for the caller. The new terminal must prove possession of its new private key through the normal challenge/verify path before it is treated as logged in.

### Cancel

`POST /api/owner-login/trusted/recovery/cancel`

The authenticated issuing iPhone may cancel its active record. Issuing a replacement also cancels any previous active record. Cancellation is idempotent and never returns the raw code.

## iPhone application changes

The primary registered state becomes **Owner認証情報** rather than a Production login-code display.

Registered actions:

- **Face IDと端末鍵でログイン**
- **別端末の復旧コードを表示**
- **Googleで端末鍵を再登録**
- **この端末の信頼登録を失効して削除**
- **このiPhoneの保存情報だけ削除**

Removed actions and state:

- Production Owner code text field,
- manual Owner-code enrollment,
- masked long-lived-code row,
- long-lived-code reveal,
- pasteboard copy,
- change-code prompt,
- new storage of `owner-production-code`.

When **別端末の復旧コードを表示** is selected, the app performs fresh trusted-device proof first, then requests and displays the recovery code with a five-minute countdown. The value uses privacy-sensitive rendering and disappears when the scene becomes inactive. It is not copied automatically and is not written to persistent storage.

A device that previously used manual code enrollment does not delete its saved long-lived code silently. Completing an explicit Google re-registration replaces the device enrollment and removes the legacy local code through the already-visible registration action. This preserves the credential/data-deletion Human Gate while ending new legacy storage.

## New-terminal flow

1. The new terminal creates a new P-256 signing key locally.
2. The owner opens the Owner recovery-registration surface.
3. The owner enters the code shown on the trusted iPhone.
4. The new terminal submits the code, public JWK, generated device ID, and label over HTTPS POST.
5. The Broker validates and atomically consumes the code while registering the device.
6. The new terminal stores the returned trusted-device credential in platform-appropriate device-only protected storage.
7. The new terminal immediately completes challenge/signature verification.
8. Only after successful proof does the UI show the terminal as registered and logged in.

Browser PIN enrollment remains a separate browser-specific capability. This recovery contract may later be called by that surface, but this design does not place a recovery code in a URL or automatically weaken browser PIN policy.

## Rate limits and abuse resistance

- Issue: at most three successful issue operations per issuing device per hour.
- Active records: one globally active recovery record for the Owner identity.
- Redeem: bounded per-source and global attempt limits over the five-minute window.
- Invalid requests receive one generic rejection response; they do not reveal whether the code, issuer, target ID, or public key failed.
- A successful consume cannot be repeated even with the same target device.
- The normalized code is compared in constant time against the stored digest.
- Expired, consumed, and cancelled records are retained only as bounded non-secret audit metadata, then pruned.

Rate limiting supplements rather than replaces the 80-bit code entropy, short expiry, issuer-revocation check, and one-time consume.

## Failure handling

- Face ID or Secure Enclave cancellation: no issue request and no displayed code.
- Challenge/signature failure: fail closed; do not fall back to Google or the Production Owner code automatically.
- Broker unavailable: show a retryable communication error; do not fabricate an offline code.
- Issuer revoked after issue: redemption fails even before expiry.
- App backgrounded: hide and clear the local raw code; server expiry remains unchanged.
- App terminated: raw code is lost locally; the owner authenticates again and issues a replacement.
- Target registration failure: do not return a credential or consume into a half-registered state.
- Redeem response lost after commit: retry cannot create another identity or return a second usable credential; the new terminal restarts with a new code unless an idempotent target-bound recovery result can be returned without widening authority.
- Registry unavailable: return retryable failure without treating the target as trusted.

## Security boundaries

- No endpoint returns `JARVIS_OWNER_SECRET`.
- No API accepts the recovery code as a normal Owner password.
- No raw recovery code is persisted server-side or client-side.
- No recovery code is stored in a URL fragment, query, cookie, UserDefaults, Keychain, pasteboard, analytics event, exception, or log.
- The issuing and redeeming clients use HTTPS only and reject cross-host redirects.
- The target private key never leaves its originating terminal.
- Trusted-device revocation remains authoritative for both issuer and target.
- Recovery-code issuance cannot rotate credentials, change permissions, approve Human Gates, perform destructive actions, or enroll Workers.
- Production Owner secret rotation remains a separately approved Human Gate with backup, validation, restart, verification, and rollback.

## Testing

### Domain tests

- code format provides 80 bits of random space and normalizes presentation separators,
- durable state contains the digest but never the raw code,
- five-minute boundary accepts before expiry and rejects after expiry,
- first successful consumption wins under a replay race,
- second use, cancellation, replacement, and issuer revocation reject,
- one active record and issue/redeem rate limits hold,
- wrong target key/device binding and malformed JWK reject,
- registry failure cannot produce a credential or consumed-success result,
- successful redemption uses the existing trusted-device credential format,
- recovery code is rejected by normal Owner login and non-enrollment APIs.

### API tests

- issue requires a valid device-bound Owner session,
- issue fails closed when revocation status cannot be checked,
- redeem does not require or create a general Owner session,
- target challenge/verify succeeds only after successful redemption,
- response headers are no-store/no-referrer,
- generic failures do not reveal validation detail,
- request/response diagnostics contain no raw code, Owner secret, private key, or target credential.

### iOS contract tests

- source contains no Production Owner code input, reveal, copy, or pasteboard path,
- Google enrollment stores no recovery code or Production Owner code,
- recovery display follows a successful trusted-device proof,
- the raw recovery code exists only in volatile view/runtime state,
- background transition clears the displayed code and countdown,
- app relaunch cannot restore the raw recovery code,
- issuer revocation and expiry surface a failure rather than stale success.

### Integration and physical acceptance

1. install the updated Owner app on the trusted iPhone,
2. authenticate with Face ID and the existing device key,
3. issue and display one recovery code,
4. register a new test Owner terminal with its own generated key,
5. verify the new terminal's challenge/signature succeeds,
6. verify the same recovery code replay fails,
7. issue another code, revoke or cancel it, and verify redemption fails,
8. verify no long-lived Production Owner code was typed, displayed, copied, returned, or logged,
9. verify existing Owner Fleet and Worker history/counts are unchanged.

Physical evidence records only timestamps, HTTP status, revision, and redacted device classes. It must not contain the raw recovery code, account identity, device identifier, key material, Owner secret, or tunnel URL.

## Rollout and rollback

1. Implement behind a disabled-by-default `GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED` configuration gate.
2. Keep the accepted Google enrollment and trusted-device proof paths unchanged.
3. Run domain, API, iOS contract, full CI, P8, and build verification.
4. Enable the feature in Production only through the task-scoped deployment gate.
5. Install the exact verified iOS build and run the physical acceptance flow.
6. Remove legacy manual-code UI only after the recovery flow's physical acceptance succeeds.

Rollback disables the feature gate and reverts the exact change set. Existing trusted devices and successfully registered target devices remain valid; rollback never deletes fleet identities. Active recovery records are rejected while the feature is disabled and naturally expire. Rollback does not restore a removed raw code or change the Production Owner secret.

## Non-goals

- displaying or copying the long-lived Production Owner code,
- putting a recovery code in Safari or a browser URL,
- automatically signing a browser into GORIQ,
- replacing Google first-owner identity binding,
- rotating or revealing `JARVIS_OWNER_SECRET`,
- resetting the bound Google identity,
- Worker enrollment,
- changing browser PIN policy,
- changing existing Owner Fleet identity/history data.
