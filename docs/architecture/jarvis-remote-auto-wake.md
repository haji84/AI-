# Native remote screen wake (#861)

Worker0.4.7 stages automatic wake before a signed native Remote Assist screenshot
or input. It uses the existing WAKE_LOCK permission and a temporary screen wake
lock; it does not change keyguard settings or open another foreground app.

Expired, busy, credential-locked, and missing legacy
capture consent commands fail before requesting wake. A visible non-secure swipe
keyguard can now be dismissed by the OS requestDismissKeyguard API through a
non-exported, transient Activity. This is allowed only when isKeyguardSecure,
isDeviceSecure and isDeviceLocked are all false. The signed command deadline,
capture consent and busy state are rechecked before dismissal. A process-local
one-use token binds the Activity to the pending request; its lifetime is bounded
to 2.5 seconds and the command deadline. It never calls disableKeyguard, changes
lock settings, enters credentials, or sends a synthetic unlock swipe. OS refusal
remains an explicit failure. All original post-wake guards still apply.
Already interactive phones
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

Stacked on #860. The owner's 2026-09-18 physical-test and completion request
authorizes the connected A202ZT canary update; fleet publication and host release
remain separate. Same signer and install-r preserve its existing registration.
No enrollment, credential, or lock-setting reset is permitted for rollback.
