# Worker update delivery (#857)

## Incident

The ZBook dashboard at14f0651 requires Worker0.4.3 for native Wi-Fi Remote
Assist, but the stable signed asset remained0.4.2 because the existing Mac
signing runner was offline. Reinstalling that asset cannot change its version.
Separately, UpdateManager requested a Broker APK route that the private ingress
intentionally does not expose, and MainActivity discarded update errors.

## Update contract

Worker0.4.4 checks the fixed official GitHub release asset over HTTPS without
Broker credentials. Only that exact source URL and HTTPS release-assets host
redirects are allowed. The private worker ingress remains unchanged. Downloads
have bounded redirects, bytes, read/connect timeouts and total duration. A
partial file is never offered for installation. App ID and the complete current
signer set must match; version must increase. PackageInstaller performs final
Android verification. Signing-key rotation is deliberately unsupported here.

Existing WorkManager scheduling checks automatically, at most hourly per
device (OS scheduling may defer it); cached candidates avoid repeated downloads.
Ordinary devices receive an update notification and an explicit Android
confirmation. Existing Device Owner devices may install while no task is active,
with a maximum of three automatic attempts per version and no duplicate open
installer session. No Accessibility action confirms the installer. Failed
update discovery cannot prevent ordinary task polling. Status and installed
version are included in signed heartbeats and displayed in the remote inventory.

Installation identity and app data are retained; never uninstall to fix updates.
Existing0.4.2/0.4.3 installations need one manual upgrade to this updater after
the same-key signed release is actually published. New updater code cannot run
inside an old installed APK. An offline signing host is a release blocker, not
an Android permission problem. The UI does not claim a same/older published APK
means all intended new software has already been released.

## Acceptance and release gate

No new Android permission, public worker route, signing key, or workflow
authority is introduced. This commit still needs its own production/APK release
approval; PR856's exact-commit approval is not reused. Physical acceptance:
same-key upgrade preserves UUID and reconnects; ordinary install consent is
honored; Device Owner update only where supported; offline recovery; wrong-key,
wrong-package, oversized and old APK rejection; remote screen/input after update.
CI is not physical acceptance. Binary downgrade is not automatic: keep previous
source and produce a higher-version recovery build with the existing signer.

Android reference: https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)
