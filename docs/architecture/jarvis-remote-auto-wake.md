# Native remote screen wake (#861)

Worker0.4.6 stages automatic wake before a signed native Remote Assist screenshot
or input. It uses the existing WAKE_LOCK permission and a temporary screen wake
lock; it does not change keyguard settings or open another foreground app.

Expired, busy, locked (including a visible non-PIN keyguard), and missing legacy
capture consent commands fail before requesting wake. Already interactive phones
do not acquire a wake lock. A screen-off unlocked phone receives one wake request
and is observed for at most2seconds, bounded by its original command expiry.
The lease is bounded to at most8seconds and released in finally. Guards are
checked during wake, immediately before input, and before returning a result.
Inputs are never retried after timeout or uncertain results. Releasing the lease
does not force the screen off; the owner's existing OS timeout remains in force.

Errors expose fixed Japanese guidance and codes UNLOCK_REQUIRED, WAKE_TIMEOUT,
WAKE_NOT_ALLOWED, SCREEN_OFF, CAPTURE_CONSENT_REQUIRED, DEVICE_BUSY or COMMAND_EXPIRED.
No raw exception/credential text is exposed. OEM/OS wake denial remains visible;
the user can press the power button. Deep idle may delay delivery before the
worker receives a command; this change does not bypass OS power management.

The Android wake flag is deprecated on API33 and may need TURN_SCREEN_ON on future
platforms. This change does not request additional permissions or claim universal
device support. Physical API26 and representative modern-device wake, locked,
timeout and no-enrollment-loss tests remain required before VERIFIED.

Reference: https://developer.android.com/reference/android/os/PowerManager#ACQUIRE_CAUSES_WAKEUP

## Enrollment hold

Stacked on #860. Keep draft: no main merge, APK publication, live host restart,
device installation, or registration mutation while the owner is enrolling.
Rollback at this stage is source-only. Existing signed production remains intact.
