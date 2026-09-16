# Registered Android Remote Assist (#852)

The owner enrollment page is the normal front door. Opening Worker 0.4.3 on
home Wi-Fi submits a signed request proving possession of the device key. It
does not enroll the device. The owner sees the device label and key comparison
code, selects the devices, and registers the selection once. No ZBook action,
pairing window, USB or post-install invitation handoff is required for this flow.
Requests expire after 30 minutes, are capped at 100, and cannot replace a pending
key or existing registered identity. Owner selection binds to a random offer ID;
an expired selection cannot approve a different subsequent key. Restart discards
pending offers; reopening Worker resubmits. Registered identities persist normally.

The page shows registered devices
and their missing permission/connectivity/update actions without navigating to
another registration page. The legacy time-limited enrollment and Device Owner
flows remain under administrator details. Installation of a generic APK does
not carry a private invitation into Android. The optional invitation flow still
requires Register in the invitation page once; it is under a separate details
section. Do not claim deferred installation handoff exists.
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
