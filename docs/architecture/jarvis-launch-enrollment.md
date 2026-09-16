# Android enrollment on launch (#779)

Opening Worker first attempts a signed heartbeat. A successfully registered identity
is retained across launches; a network error never triggers re-enrollment. For an
installation-configured HTTPS origin, an unknown identity (HTTP 401) requests a
fresh single-device grant, enrolls, and verifies a signed heartbeat before showing
登録完了. A previously verified identity failing authentication requires owner review.

## Trusted installation bootstrap

Build an installation APK with `-PjarvisBootstrapUrl=https://<private-worker-origin>`.
This owner's build defaults to `installation/zbook.properties` and its public
certificate, approved on 2026-09-16. Gradle properties still override these defaults
for tests/other installations. The private key is outside the repository on ZBook.
This contains an origin, never an owner token, pairing token, or private key. Use the
installation's existing signing identity for updates. Arbitrary LAN advertisements
and intent extras cannot replace this bootstrap. Generic APKs have no guessed host;
they retain registration-link support and explicitly show that host setup is needed.

The origin must serve the Broker's worker routes over trusted HTTPS and be reachable
from home Wi-Fi. A dashboard-only Tailnet URL does not provide that automatically.
Keep the Broker loopback-bound behind private authenticated ingress. Do not expose
it publicly, enable Funnel, port forwarding, cleartext, or bypass TLS validation.

## Owner authorization and bounded issuance

The same fixed `/enroll` URL can be opened on multiple Android devices, up to the
100-node fleet capacity. Each open creates an independent 30-minute grant; the
one-device limit applies to each grant, not to the shared URL or owner's fleet.
App-launch enrollment likewise obtains a separate grant for each installation.
The integration test enrolls 100 distinct logical devices through the Broker and
rejects the 101st, including concurrent opens of the same URL. This is simulated
fleet integration evidence, not evidence from 100 physical phones.

The owner opens the existing enrollment window from JARVIS Devices/registration.
`POST /api/jarvis/enrollment-grant` consumes one of its maximum 100 issuance slots.
The window lasts at most one hour (default thirty minutes); each returned grant lasts
thirty minutes or the remaining window time, whichever is shorter, and enrolls one
device. This lifetime was explicitly requested by the owner on 2026-09-16.
Closed, expired, exhausted, and non-HTTPS host configurations
fail closed. Responses are no-store and contain only the grant and expiry. Existing
worker request signing, replay protection and duplicate identity rejection remain.
HTTP redirects are not followed by the Worker. Opening/retry makes one attempt;
overlapping lifecycle events are guarded against concurrent enrollment attempts.

## Verification and remaining installation work

### ZBook home-LAN Worker ingress

`scripts/jarvis-private-worker-ingress.ts` is an optional HTTPS listener bound to an
explicit RFC1918 address. It forwards only five enrollment/signed-worker POST routes
to the loopback Broker. Dashboard, owner/admin routes, cookies and owner Authorization
headers are not forwarded. There is no public bind, generic proxy, plaintext fallback,
or automatic credential generation.

Required installation configuration (not enabled by this PR):

- `JARVIS_PRIVATE_WORKER_INGRESS_ENABLED=1`
- `JARVIS_PRIVATE_WORKER_HOST=<ZBook home-LAN IPv4>`
- `JARVIS_PRIVATE_WORKER_PORT=8792`
- `JARVIS_PRIVATE_WORKER_CERT_PATH=<local installation certificate>`
- `JARVIS_PRIVATE_WORKER_KEY_PATH=<local private key; never in git or APK>`
- Broker `JARVIS_PUBLIC_BROKER_URL=https://<same home-LAN IPv4>:8792`

For an owner-managed certificate, build the APK with the same `jarvisBootstrapUrl`
and `-PjarvisCaCertificate=<public certificate file>`. Generated Android network
security resources trust this certificate only for that exact hostname. Other hosts
retain system trust; hostname checks and certificate validation remain enabled.
Only the public certificate enters the APK. No Android-wide CA installation needed.
The certificate must have a valid IP subject alternative name for this address.

The current ZBook LAN address was observed as `192.168.0.169`; it is not a permanent
address guarantee. Reserve it or regenerate/reconfigure upon an address change.
Creating the real certificate/private key is a credential Human Gate under AGENTS.md.
The owner explicitly approved it and creation completed at 2026-09-16T08:31Z.
A separate protected directory outside the repository
must hold the key; no secret material belongs in version control, issue text or logs.
Existing release signing credentials must be reused, never replaced. Physical launch,
heartbeat, reopen and network recovery remain required after owner-authorized setup.

`tests/jarvis-launch-enrollment.test.ts` exercises the actual isolated Broker HTTP
server: closed window, owner authentication, grant shape/TTL, enrollment, replay,
unsigned heartbeat rejection, capacity and close. Android unit tests validate the
bootstrap origin; Android CI builds the release and executes those tests.

For this installation set `JARVIS_WORKER_INSTALL_URL` to the existing HTTPS signed
APK release URL. The owner registration page then shares that URL. Android users
install/update and open the app; it enrolls through the certificate-scoped private
origin. No browser certificate-warning bypass or Android-wide CA installation is
required. Existing installations may also open `jarvis://enroll`. The direct private
IP HTTPS origin is a Worker endpoint, not a browser-trusted installation page.

Signed APK rollout and physical launch/heartbeat/reopen verification remain required.
No PHYSICAL PASS is claimed by this source change.

Rollback: revert this issue's code and build a higher-version APK with the existing
signing identity. Preserve app data, device identity and Broker state; no migration.
