# Android enrollment on launch (#779)

Opening Worker first attempts a signed heartbeat. A successfully registered identity
is retained across launches; a network error never triggers re-enrollment. For an
installation-configured HTTPS origin, an unknown identity (HTTP 401) requests a
fresh single-device grant, enrolls, and verifies a signed heartbeat before showing
登録完了. A previously verified identity failing authentication requires owner review.

## Trusted installation bootstrap

Build an installation APK with `-PjarvisBootstrapUrl=https://<private-worker-origin>`.
This contains an origin, never an owner token, pairing token, or private key. Use the
installation's existing signing identity for updates. Arbitrary LAN advertisements
and intent extras cannot replace this bootstrap. Generic APKs have no guessed host;
they retain registration-link support and explicitly show that host setup is needed.

The origin must serve the Broker's worker routes over trusted HTTPS and be reachable
from home Wi-Fi. A dashboard-only Tailnet URL does not provide that automatically.
Keep the Broker loopback-bound behind private authenticated ingress. Do not expose
it publicly, enable Funnel, port forwarding, cleartext, or bypass TLS validation.

## Owner authorization and bounded issuance

The owner opens the existing enrollment window from JARVIS Devices/registration.
`POST /api/jarvis/enrollment-grant` consumes one of its maximum 100 issuance slots.
The window lasts at most one hour; each returned grant lasts at most ten minutes
and enrolls one device. Closed, expired, exhausted, and non-HTTPS host configurations
fail closed. Responses are no-store and contain only the grant and expiry. Existing
worker request signing, replay protection and duplicate identity rejection remain.
HTTP redirects are not followed by the Worker. Opening/retry makes one attempt;
overlapping lifecycle events are guarded against concurrent enrollment attempts.

## Verification and remaining installation work

`tests/jarvis-launch-enrollment.test.ts` exercises the actual isolated Broker HTTP
server: closed window, owner authentication, grant shape/TTL, enrollment, replay,
unsigned heartbeat rejection, capacity and close. Android unit tests validate the
bootstrap origin; Android CI builds the release and executes those tests.

The installed v0.4.1 and the current ZBook private trial have NOT been changed by
this source change. The trial exposes only the dashboard to Tailnet; a reachable
private HTTPS Worker origin, installation-configured signed APK, and physical
launch/heartbeat/reopen verification are still required. No PHYSICAL PASS claimed.

Rollback: revert this issue's code and build a higher-version APK with the existing
signing identity. Preserve app data, device identity and Broker state; no migration.
