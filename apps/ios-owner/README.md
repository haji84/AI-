# GORIQ Owner for iPhone (Issue #1218)

This is a separate iOS Owner application. It does not reuse the iPhone Worker credential or the browser's IndexedDB PIN key. It never calls a server endpoint that returns `JARVIS_OWNER_SECRET`.

## Build and enroll on a physical iPhone

1. On a Mac with Xcode and XcodeGen, run `cd apps/ios-owner && xcodegen generate && open JarvisIOSOwner.xcodeproj`.
2. Select the `JarvisIOSOwner` target, your development team and the physical iPhone; Build & Run. The iPhone must have a device passcode and Secure Enclave.
3. Enter the HTTPS GORIQ origin and, once, the Production Owner code read directly from the ZBook's owner-local utility. Use an owner-controlled transfer. Do not put the code in a GitHub issue, chat, screenshot, URL, or shared log.
4. Tap **本人確認して登録**. The app authenticates the code to the existing Owner login, registers a Secure Enclave P-256 signing key as a trusted device, and saves the code in a `WhenPasscodeSetThisDeviceOnly` Keychain item with `userPresence` access control.
5. Close and reopen the app. Tap **表示** and confirm the device authentication prompt. Tap **コピー** and confirm the clipboard expires after 60 seconds. Background the app and confirm the value is hidden.
6. Revoke this device in GORIQ's trusted device management; confirm further **表示** and **コピー** fail. If the app still has a valid proof, **この端末の信頼登録を失効して削除** revokes server first, then removes local keys and code. If the server is unavailable, this operation retains local data and fails closed. The separate local-only deletion requires iPhone authentication and explicitly directs the owner to confirm server revocation from another Owner terminal.

The existing browser PIN login remains separate. This implementation requires manual first provisioning from the authoritative ZBook code; the planned one-time encrypted Owner Fleet transfer and iPhone initiated gated rotation are not implemented. A code rotation on ZBook invalidates the HMAC-backed trusted credential, so the iPhone must be re-enrolled. An offline iPhone cannot reveal or copy, even if the local Keychain item exists. The iOS screen can still be captured by a person using the phone; avoid screenshots in acceptance evidence.

Do not count source review, CI or simulator results as physical iPhone verification. Record the build SHA, device model/iOS version, successful server proof, revoke denial, background hide and clipboard expiry without capturing the code.
