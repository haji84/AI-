# Android 8 support and enrollment-safe staging (#859)

Status: implementation in review; no production deployment or physical Android8 PASS.

The owner is enrolling devices now. This task must not restart the host, replace
the stable APK, rotate an installed identity, delete registrations, or install on
enrolling phones. Work is isolated on a branch based on #858. Merging to main
would trigger the existing Android signing/publication workflow and is therefore
deferred until enrollment-safe release coordination. No workflow authority changes.

API26–29 use an explicit MediaProjection consent session with a foreground
notification and stop action. Consent is never saved, replayed after reboot, or
confirmed by Accessibility. Screen sharing is required for remote input as well
as observation; revocation stops both locally even before the next heartbeat.
Rotation fails closed and requires a new session. Secure surfaces remain subject
to OS redaction. API30+ retains Accessibility screenshot capture.

Updater reads API26 package signatures and version fields without invoking API28
methods. Full signer equality, package, version, byte and timeout checks remain.
Enrollment verification, active UI, tasks, screen sharing, and recent remote
commands suppress automatic installs. Ordinary phones retain system installer
confirmation; Device Owner installations may be unattended where OS permits.

The fleet has two signing lineages. Never replace the old signer with the Windows
canary signer: that cannot preserve registrations. Each lineage needs a matching
signed artifact and verified distribution. Older Workers with the broken download
path need an initial same-key manual bootstrap update. This task does not claim
that fleet rollout or fully silent updates on ordinary phones are complete.

Required evidence before release: Android8 installation/enrollment; allow/deny/
revoke capture; Home/tap/swipe/text; rotation; lock/secure screen; reboot requires
fresh consent; same-key update preserves identity; active enrollment unchanged.

Reference: https://developer.android.com/reference/android/media/projection/MediaProjectionManager
