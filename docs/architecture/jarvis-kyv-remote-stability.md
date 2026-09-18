# KYV Remote Assist stability (#875)

Physical production comparison on Android016 KYV47/Worker0.4.3 reproduced one
successful screenshot followed by a failed capture and browser session teardown.
With 1500ms added between observations, 13 captures completed without failure over
30 seconds. Native error codes are unavailable from this legacy Worker; this
supports conservative pacing, not a claim about the exact Android native error.

KYV refresh waits 1500ms after each completed capture. Other devices keep their
existing 100ms gap. A signed Worker failed screenshot response is explicitly
classified REMOTE_CAPTURE_UNAVAILABLE (503); the browser retains the session and
last image with a stale/retrying notice. Observation retries back off 2/4/8 seconds,
then stop after four consecutive failures (initial attempt plus three retries).
A success resets the counter. Inputs are never retried. Authentication, expired
sessions, revoked capabilities, and unclassified conflicts retain fail-closed
behavior. Every attempt still passes existing owner, session and worker policy.

No Android APK, identity, permission, enrollment, credential or DB changes.
Rollback restores the previous server release; no device reset is needed.
Validation includes the signed Broker result path, pacing/retry tests, browser
fault injection and separate physical testing. CI alone is not physical evidence.
