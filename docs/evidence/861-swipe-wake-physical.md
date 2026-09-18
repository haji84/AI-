# #861 non-secure swipe-lock recovery — 2026-09-18

Scope: one physical ZTE A202ZT, Android 13/API33, Worker0.4.7 versionCode20.
The owner requested completion after the previous0.4.6 physical test stopped
at a non-secure swipe keyguard. No credential lock or OS security setting changed.

## Verification

- Release build/lint and15 Android unit tests passed, including6 bounded wake
  tests and the new dismissal-policy test (secure/device-locked/busy/expired/
  missing consent all rejected). The new test failed before implementation.
- Existing Windows signing certificate matched installed APK; install-r kept
  existing enrollment. Registry remained38 entries, same Android004 identity.
- At00:06 UTC, ADB observation before command: `mWakefulness=Dozing`,
  `showing=true`, `secure=false`. ADB was used to put the device to sleep and
  observe state, never to wake or dismiss its keyguard.
- Through authenticated Broker→signed Worker request/result: screenshot200,
  ok=true, JPEG101309bytes. Image visually checked: real Accessibility settings,
  not a black frame or helper Activity.
- Subsequent signed HOME200, ok=true. OS observation after: Awake,
  showing=false, current focus ZTE launcher.
- Existing38 registrations retained;35 fresh at measurement. The three other
  stale registrations were not modified.

Local raw evidence (not published): `tmp/remote-disconnect/physical-wake-before.txt`,
`physical-wake-after.txt`, `physical-wake-result.jpg`,
`swipe-wake-check-0b207f5e-1c9c-4faa-a47d-e500e0cb271b.json`,
`home-check-0b207f5e-1c9c-4faa-a47d-e500e0cb271b.json`, `swipe-green.log`.

## Limits and rollback

PASS applies to the connected canary's non-secure swipe lock only. Credential
locks, deep idle delivery, network outage, OEM variants and all-fleet rollout
are not certified by this test. The dashboard input/capture collision remains
a separate undeployed UI fix. No fleet update channel or host release changed.

The previous APK is retained locally. Never uninstall/clear app data for rollback;
if Android rejects downgrade, use a same-signer forward-version rollback build.
The canary remains on tested0.4.7. No keys or enrollment identifiers were replaced.

API contract: https://developer.android.com/reference/android/app/KeyguardManager#requestDismissKeyguard(android.app.Activity,android.app.KeyguardManager.KeyguardDismissCallback)
