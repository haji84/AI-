# Remote Assist wake preparation (#873)

Remote session creation previously did not call the existing signed `wake-device`
task. Scheduler `ready` did not mean screen-on or remote-controllable.

The owner-authenticated Broker now accepts `/api/jarvis/admin/remote/wake` only for
fresh, policy-authorized, unlocked, idle native remote workers advertising wake.
It creates one existing-protocol wake task, maxAttempts=1, with a 15-second server
dispatch deadline. Concurrent starts share an active wake. Restored expired queued
or leased preparation tasks are cancelled before dispatch; unrelated tasks retain
their behavior. Already delivered work may finish; no input is replayed.

Dashboard session creation waits at most 18 seconds for signed task completion,
rechecks current remote authorization, then allows the first screenshot. A wake
acknowledgement is not proof of an unlocked screen. PIN/password/secure-window
restrictions remain enforced. Unknown capture consent or unavailable Worker still
fails visibly. Unsupported workers are not advertised as wake-capable.

The UI distinguishes screen-off and unavailable devices and labels scheduler ready
as task waiting. This is not an Android APK update and does not alter identities,
credentials, registration, permissions or database schema.

Validation: negative and deadline tests, authenticated Broker integration including
signed claim/result, duplicate wake coalescing, build and browser fixture. Separate
existing-Worker physical wake proof is local; it does not prove the complete new
production session-start flow until the candidate is deployed and tested.

Rollback: restore previous Broker/dashboard release, preserving configuration and
fleet state. No worker reset or re-enrollment. Pending wake work must be drained or
cancelled before rolling back to a Broker without dispatch-deadline enforcement.
