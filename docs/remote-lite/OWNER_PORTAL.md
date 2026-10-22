# GORIQ Remote Lite owner portal candidate

Issue1831 / PR1832. This independent portal connects the existing signed device protocol to a Japanese owner browser. It is a candidate for verification, **not an externally deployed or friend-ready service**. No GORIQ service, database, account, permission or port is reused.

## What is implemented

- Configured owners receive separate256-bit random login keys. The server stores SHA-256 digests, not the keys. These are generated operator credentials, not human passwords. No public account signup, email or paid identity provider.
- HTTPS only, exact Host/Origin, HttpOnly/Secure/SameSite=Strict cookie, session-bound CSRF, bounded JSON/login/session/connection rates. One login lasts at most12hours with15minute idle expiry. Logout/expiry closes that login's coordinator sessions; native signed-status checks then stop the host.
- Invite, proven pending-device list, explicit full-fingerprint comparison, approval, registered-device selection, session request, native OS consent, WebRTC viewer, normalized tap/swipe, platform-specific keys and disconnect.
- Only fresh decoded frames enable manual input. A local watchdog removes LIVE after2seconds without a new frame and closes after4seconds. A delayed start response cannot revive a stopped page. No browser local/session storage or URL bearer tokens.
- Approved public device identities persist across server restart; live sessions, browser sessions, invitations and pending registrations do not. Approval/revocation persists before changing authority. A failed save quarantines the live authority; corrupt/missing storage does not silently create an empty registry.

## Operator configuration (after concrete environment approval)

The operator runs the independent Node service; friends use the HTTPS browser and native apps. Node24 and a valid system-trusted TLS certificate/key are required. The certificate must match the exact origin. The JSON config is private and must stay outside Git:

```json
{
  "origin": "https://APPROVED-HOST.example",
  "listenHost": "127.0.0.1",
  "listenPort": 9443,
  "tlsCert": "tls/fullchain.pem",
  "tlsKey": "tls/private-key.pem",
  "stateDirectory": "remote-lite-state",
  "owners": [
    { "ownerId": "friend-01", "keyHash": "SHA256_OF_DISTINCT_64_HEX_RANDOM_KEY" }
  ]
}
```

The placeholders deliberately fail validation. Provision a distinct random key through the approved secret channel; do not put it in a URL, shell argument, GitHub comment or log. Do not use a GORIQ key. Listener/firewall/DNS/provider/certificate configuration must be specifically bound to the approved independent environment. This example alone is not reachable outside the host and is not a deployment instruction.

Initial empty-directory setup (operator only):

```text
node scripts/remote-lite-owner-server.mjs <private-config.json> --initialize
```

Subsequent starts omit `--initialize`. A second writer or stale crash lock refuses startup. After a crash, the operator must confirm the original process has ended, preserve the state/backup and inspect the lock before recovery. Never delete devices.json to get a green startup. Back up the public registration file together with the owner configuration and keep the private keys in their existing separate stores. A key/config rotation requires a controlled service restart and a new login.

## Connection and distribution gates

The CLI defaults to **direct ICE only**. After verifying the independent coturn
provider, free limit/hard cap, authentication and public ports, an operator may
add this private configuration:

```json
"turn": {
  "urls": ["turn:APPROVED-RELAY.example:3478?transport=udp", "turns:APPROVED-RELAY.example:5349?transport=tcp"],
  "sharedSecretFile": "private/turn-shared-secret"
}
```

The secret is read only on startup and stays on the server. A browser receives
10-minute HMAC credentials only after authenticated, CSRF-checked creation of a
session for that owner's approved device. No public credential endpoint exists.
An issuer failure closes the newly created session. These settings do not
provision coturn or enforce its traffic budget: provider billing/free-only status
and relay bandwidth limits must be verified in the actual environment.

Native Windows/Android hosts now request relay settings through
`POST /v1/device/ice`, using a one-use `session-ice` challenge signed by the
registered device key. The server checks the active session and derives its
owner from the registry before issuance. It caches one host credential per
session, requires fresh authorization on every fetch, and refuses a new
credential after expiry until a new session is created. Direct-only mode returns
an explicit empty server list. Unknown fields, invalid URLs/credentials, wrong
device/session bindings, replay and expired/revoked authority fail closed.

Credential expiry is clipped to the active session and at most600seconds. Each
authenticated response includes fresh server time; clients allow the existing
30second discovery clock skew, count the whole fetch against remaining lifetime,
and stop on a fixed monotonic deadline. A later device clock rollback cannot
extend relay use. The server's long-term secret stays out of APKs/EXEs and logs.

This path has local signed-HTTPS, JVM and Windows unit/interoperability coverage.
Code head9f623791 passed [Android REST coturn integration](https://github.com/haji84/AI-/actions/runs/39806463894)
and [normal CI](https://github.com/haji84/AI-/actions/runs/39806463888): actual native
relay/relay media, four swipes followed by static video, secure-input refusal
and owner-revoke capture shutdown. These are disposable loopback VM results.
Windows real relay allocation, carrier NAT, Safari and sustained sessions past
credential expiry have not been accepted. Credentials are not yet refreshed in
an active connection: relay sessions stop at expiry and require a new session
(and Android OS screen-sharing consent). Logout/revoke stops product media/input but does
not invalidate an already issued TURN password before its expiry; coturn must
have restrictive allocation/bandwidth quotas and private-network peer denial.
A public hostname and TLS alone do not establish usable media across all networks.

Normal Android14+ capture requires local OS consent. The reported nubia name may mean **nubia S5G**; [Y!mobile's official specification](https://www.ymobile.jp/lineup/smartphone/nubia_s/) lists Android14 at launch, but the actual model/installed OS must be checked in Settings. No successful physical test is claimed from the model name.

Current browser verification uses disposable Chrome/HTTPS and a real signed Node device enrollment; pending native consent is the endpoint of this portal UI test. Actual Android/Windows video/input is separately verified in VMs. PC→physicalAndroid and cellulariPhone→physicalWindows through this portal have not yet been observed. Installer, final signing/clean install, broader Android compatibility,40devices and unattended recovery remain parent gates.

## Verification and rollback

```text
node --test tests/remote-lite-*.test.mjs
REMOTE_LITE_PORTAL_BROWSER=1 node --test tests/remote-lite-owner-portal.test.mjs
```

The browser check requires ChromeDriver and uses a generated disposable TLS certificate pinned only by that test browser. Production TLS verification is never disabled. Independent review and exact-head CI must be recorded in ACCEPTANCE.md/Issue1831 before integration.

Rollback: stop only this portal's process, revert this implementation and rebuild. Retain devices.json, owner config and native keys. There is no GORIQ migration or external deployment to reverse.
