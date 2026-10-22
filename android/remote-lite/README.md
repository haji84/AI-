# GORIQ Remote Lite Android candidate

This is an independent `app.goriq.remote.lite` Android project containing a local P-256 AndroidKeyStore identity, a manual Accessibility screenshot/gesture service, and a Japanese setup/diagnostic screen. It includes no GORIQ Worker, AI, task executor, device administrator, boot receiver, public listener, or owner credential.

The APK is **not ready for a friend**. Release has no network permission, account enrollment UI, signaling, WebRTC media/DataChannel transport, off-device viewer, Android 9/10 capture path, or unattended reconnect. The screenshot diagnostic works only on Android 11+ after a human enables the Accessibility service. It reports a fresh image's dimensions and byte count, never a stale frame as live media. Secure/locked screens are refused. The OS owns the Accessibility permission dialog; the app does not grant it silently.

The `debug` variant alone includes a diagnostic activity and loopback HTTP permission so an Android VM can submit its real AndroidKeyStore proof to the Node test coordinator through ADB reverse. This test automatically approves the displayed fingerprint with an ephemeral fixture owner token; it does not establish a production owner account or prove human fingerprint review. **Never distribute the debug APK.** CI builds an unsigned release APK and inspects its compiled manifest to reject the debug activity or INTERNET permission. The Android 15 emulator test checks local screenshot/tap and attempts the loopback enrollment handshake. CI does not publish, sign or deploy an APK. Physical device acceptance is a separate gate.

Rollback: revert the Android candidate commits. No account, external service, secret, or device enrollment state is created by the build.
