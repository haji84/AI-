# GORIQ Owner for iPhone (Issue #1218)

This is a separate native iOS Owner application. It does not reuse the iPhone Worker credential or the browser PIN key, and it never receives `JARVIS_OWNER_SECRET`.

## Build and primary enrollment

1. On a Mac with Xcode and XcodeGen, run `cd apps/ios-owner && xcodegen generate && open JarvisIOSOwner.xcodeproj`.
2. Select the `JarvisIOSOwner` target, development team, and a physical iPhone. The phone must have a device passcode and Secure Enclave.
3. Enter the HTTPS GORIQ origin and tap **GoogleでOwner登録**.
4. Complete Google authentication. The app creates a Secure Enclave P-256 signing key and stores only the device-bound key representation, trusted credential, and device ID in `WhenPasscodeSetThisDeviceOnly` Keychain items.
5. Tap **Face IDと端末鍵でログイン** and confirm that challenge/signature verification succeeds.

The browser PIN remains a separate browser-only capability. Google enrollment does not store OAuth tokens, a recovery code, or the Production Owner secret on the iPhone.

## Add or recover another iPhone

On a registered iPhone:

1. Tap **別端末の復旧コードを表示** and complete Face ID plus device-key proof.
2. Read the displayed `OR-…` code and its countdown. Do not screenshot, copy, paste, or record it.

On the new or locally reset iPhone:

1. Enter the same HTTPS GORIQ origin.
2. Enter the short code under **iPhoneに表示された復旧コード** and tap **復旧コードでOwner登録**.
3. The new phone creates its own Secure Enclave key, redeems the code once, stores the returned trusted credential, and immediately proves the new key before showing enrollment success.

The code is valid for five minutes and one use. The issuing iPhone keeps it only in volatile memory and clears it when hidden, expired, cancelled, or backgrounded. Neither iPhone reads, displays, copies, transmits, or newly stores the long-lived Production Owner secret.

## Revocation, deletion, and legacy cleanup

- **この端末の信頼登録を失効して削除** revokes the server registration, confirms that the old credential is denied, and then deletes local trusted-device material. If denial cannot be confirmed, it fails closed and retains local data.
- **このiPhoneの保存情報だけ削除** requires iPhone authentication and removes local data only. Confirm server revocation from another Owner terminal.
- An `owner-production-code` Keychain item left by an older app is never read, revealed, copied, or removed at startup/background. It is removed only by explicit local deletion or a successful explicit Google registration/re-registration cleanup path.

## Rollout and acceptance

The server feature flag `GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED` is disabled by default. Enabling it, changing Production configuration, installing a new build, and collecting physical acceptance evidence are separate operator actions.

Do not count source review, CI, simulator results, or this documentation as physical iPhone acceptance. Physical evidence must omit the recovery code, email, device ID, credential, secret, and tunnel URL.
