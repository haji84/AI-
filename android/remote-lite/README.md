# GORIQ Remote Lite Android candidate

This is an independent `app.goriq.remote.lite` APK containing only a local P-256 AndroidKeyStore identity, a manual Accessibility screenshot/gesture service, and a Japanese setup/diagnostic screen. It includes no GORIQ Worker, AI, task executor, device administrator, boot receiver, public listener, or owner credential.

The APK is **not ready for a friend**. It has no account enrollment, signaling, WebRTC media/DataChannel transport, off-device viewer, Android 9/10 capture path, or unattended reconnect. The screenshot diagnostic works only on Android 11+ after a human enables the Accessibility service. It reports a fresh image's dimensions and byte count, never a stale frame as live media. Secure/locked screens are refused. The OS owns the Accessibility permission dialog; the app does not grant it silently.

CI builds an unsigned debug candidate and runs local parser tests. It does not publish, sign or deploy the APK. Android emulator and physical device acceptance are separate future gates.

Rollback: revert the Android candidate commits. No account, external service, secret, or device enrollment state is created by the build.
