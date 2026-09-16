# Registered Android Remote Assist (#852)

The owner enrollment page is the normal front door. It shows registered devices
and their missing permission/connectivity/update actions without navigating to
another registration page. The legacy time-limited enrollment and Device Owner
flows remain under administrator details. Installation of a generic APK does
not carry the private invitation into Android: the user must tap Register in
the invitation page once. Do not claim deferred installation handoff exists.
Reopening an invitation first checks the existing signed identity; it must not
consume a second invitation slot or overwrite an existing key.

Remote discovery merges Broker registered nodes and gateway connections.
Registered workers remain visible even if ADB is down. USB and Wi-Fi are separate
connection groups: there is no verified serial-to-worker UUID binding and no
model-name heuristic is used to merge identities. A missing capability, stale
heartbeat, locked/busy/disabled node or denied owner policy fails closed.

## Native transport v1

Worker 0.4.3 advertises remoteProtocol 1. Android 11+ with enabled Accessibility
can capture JPEG frames and perform tap, swipe, focused non-password text input,
Back, Home and Recents. Android's secure-window capture restrictions are honored.
Older Android remains visible with USB / ADB fallback. Native teaching, video,
continuous frame recording and arbitrary URL launch are not implemented here.

The existing owner session/audit boundary authorizes each command before the
dashboard sends it to a loopback owner-authenticated Broker endpoint. The private
TLS worker ingress exposes only two additional signed POST worker routes.
The Broker checks the registered identity, signature, body hash, timestamp and
nonce for both command polling and results. No owner credential reaches workers.

The in-memory mailbox holds at most one operation per registered device for at
most eight seconds. Delivery claims are one-shot; results bind to the same node
and random command ID. Restart, timeout and reconnect never replay input. The
worker checks the deadline, lock and runtime state before execution. Ending the
owner session cancels queued commands; an already claimed input may finish
within its original deadline. An input whose result is lost is UNKNOWN, not
safe to retry automatically. Ordinary task claims are paused while input is pending.
Images stay in the request/response path and are not added to audit logs.

## Release and acceptance

This requires both Broker/dashboard and the signed 0.4.3 APK. The new screenshot
capability is declared in Accessibility metadata; OS permission requirements
must remain visible and cannot be silently enabled. Production release and APK
publication must follow repository task-scoped approval. Do not reuse PR855's
exact-commit deployment receipt for this change.

Required physical evidence: two enrolled devices visible, install/open/register
flow without USB, signed heartbeats, screenshot matching actual screen, tap/text/
swipe/Home, disconnect and reconnect without enrollment, expired command never
executes later, locked/password/secure-screen refusal. Automated CI is not this
evidence. Roll back Broker/dashboard and APK by approved mechanisms; retain
the fleet database, signing identities and invitation sidecar.

API reference: https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#takeScreenshot(int,java.util.concurrent.Executor,android.accessibilityservice.AccessibilityService.TakeScreenshotCallback)
