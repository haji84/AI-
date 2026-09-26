# iPhone Owner recovery enrollment

## Scope and authority

A currently trusted iPhone can authorize one additional Owner terminal without exposing the Production Owner secret. The recovery code is an enrollment capability only: it cannot log in through the ordinary Owner endpoint, authorize Worker enrollment, rotate credentials, satisfy a Human Gate, or execute an Owner action.

This repository change is software preparation only. The feature is **disabled by default**, Production has not been enabled by this change, and **実機受入は未完了**.

## State machine

| State | Transition | Result |
|---|---|---|
| No active code | A trusted, non-revoked issuer completes a fresh device-bound Owner session and requests issue | One active digest record; raw code returned once |
| Active | Same issuer cancels | Record becomes cancelled |
| Active | Issuer requests a replacement | Old record becomes replaced; one new record is active |
| Active | Five minutes pass | Record becomes expired and cannot redeem |
| Active | Issuing device is revoked | Record becomes issuer-revoked |
| Active | A new target submits a valid key and code | Target registration and code consumption commit atomically |
| Consumed/cancelled/replaced/expired/issuer-revoked | Any further redeem | Generic rejection |

The code is **5分間・1回限り**. Only one code is active for the Owner identity. Issue and redeem paths also enforce bounded **rate limit** windows.

## Trust flow

Issuance and cancellation require an Owner session that is both device-bound and **fresh**. The route checks the session signature, maximum age, bound device ID, and current revocation state before asking the Broker to mutate recovery state.

The Broker generates 80 random bits and returns the formatted code only to the issuer response. Durable recovery state contains a keyed SHA-256 digest, timestamps, issuer ID, status, and bounded rate metadata—not the raw code. Recovery state and the trusted-device registry use the same lock and atomic file replacement. This **atomic** boundary ensures successful redemption registers the target and consumes the code in one commit. **発行元端末の失効** also invalidates its active code in the same registry boundary.

The target iPhone creates a new Secure Enclave P-256 key locally with user-presence/private-key-use access control. Redemption sends the code, device ID, label, and public JWK; private key material never leaves the phone. After receiving a credential, the target must complete the normal **challenge/signature** proof before publishing enrolled state. Proof failure deletes the newly stored key, credential, and device ID and requires a newly issued code.

## Data handling and errors

- Recovery requests are bounded HTTPS POST JSON. Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- The raw code is never placed in a URL, cookie, browser storage, UserDefaults, Keychain, file, pasteboard, analytics event, exception, or log.
- The issuing UI holds the code only in volatile state, marks it privacy-sensitive, disables text selection, shows a countdown, and clears it on backgrounding.
- Public failures are **generic**. They do not distinguish wrong, expired, consumed, cancelled, replaced, issuer-revoked, or rate-limited codes.
- A source address is converted to an Owner-secret HMAC bucket before rate metadata reaches the Broker; the address itself is not persisted there.

## Rollout and rollback

Set `GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED=1` only during a separately authorized rollout after CI and physical acceptance preparation. The repository commits no enabled default. While the flag is off, issue, redeem, and cancel return a disabled response; an active record cannot be used and expires normally.

Rollback consists of disabling the flag and reverting the exact recovery change set if required. It performs no secret rotation and no device deletion. **既存の信頼済み端末は削除しない**; targets that completed enrollment remain ordinary trusted devices. Rollback does not restore a removed legacy code or alter `JARVIS_OWNER_SECRET`.

Legacy `owner-production-code` Keychain data is deletion-only compatibility state. Startup and backgrounding do not touch it. Explicit local deletion or successful Google registration/re-registration removes it; no new UI can reveal, copy, enter, or store it.

## Evidence boundary

Automated evidence may record only test names, pass/fail counts, revision, and redacted status. A real recovery code, email, account identifier, device ID, credential, key material, Owner secret, or tunnel URL must never enter screenshots, logs, comments, or evidence files. Source tests do not establish Production deployment or physical acceptance.
