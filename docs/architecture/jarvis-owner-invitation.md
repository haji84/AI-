# Owner invitation enrollment (#852)

## Owner flow

An authenticated owner issues one invitation at `/jarvis/enroll`, copies it once,
and opens the same link on each Android connected to home Wi-Fi. Install the
existing signed Worker APK, return to the link, then press Register. No USB,
recurring ZBook approval, or open pairing window is required. Android permission
dialogs still require the device user. Registration alone does not implement
Wi-Fi screen streaming; native Worker Remote Assist remains outstanding in #852.

## Credential boundary

The reusable invitation is a 256-bit bearer credential. Anyone holding it and
able to reach the private LAN ingress can enroll up to its remaining budget.
It has no automatic expiry: the owner can revoke it. Creation and revocation
require existing owner authentication. There is at most one current invitation.
Maximum invitation budget and maximum fleet size are independently 100.

Only the SHA-256 digest, ID, timestamps, revocation state and consumed node IDs
are stored beside `JARVIS_DB_PATH` in `.invitation.json`. Preserve this file in
host backups with the same private ACL as the Broker database. Do not commit it.
The service must have one writer per database. Corrupt state fails closed.
Atomic replacement reserves a slot before enrollment: a crash may consume a
slot without registering a device; it cannot grant an extra slot.

The public `/android-join` page receives invitation data in a URL fragment, not
a query string. Its static inline script passes data to the existing Android
`jarvis://enroll` handler only after a user clicks the Android intent link.
No analytics, remote scripts, fetches or browser storage are used. No-referrer
and a script-hash CSP prevent accidental disclosure to the APK download site.
The link remains sensitive in browser history and anything to which it is copied.
Only HTTPS RFC1918 Broker origins are accepted. TLS trust remains enforced by
the existing signed APK; arbitrary private addresses do not become trusted.

The Broker consumes a new internal single-device, 30-minute quick-enrollment
grant for each redemption. Full management is never granted by an invitation.
Registered identities must reconnect rather than overwrite their signing key.
Revocation stops new enrollment and leaves existing device identities intact.
Worker requests still require signatures, nonce and clock checks.

## Verification and release

Automated tests cover restart persistence, duplicate identities, invalid bearer,
revocation/rotation, 100/101 capacity, corrupt state, owner authentication,
closed-window Broker enrollment and static landing CSP. These are simulated
integration tests, not Android physical acceptance.

Release requires both the public static landing route and the private ZBook
Broker/dashboard update. Verify the canonical public route before issuing a
real owner invitation. Physical acceptance must demonstrate an Android intent
handoff, signed enrollment and signed heartbeat without USB.

Rollback the dashboard/Broker to the previous release; retain the sidecar for
recovery. The old Broker rejects invitation credentials. Revoke before rollback
if links should remain invalid after upgrading again. Never delete the fleet
database or reset existing device identities as a rollback step.
