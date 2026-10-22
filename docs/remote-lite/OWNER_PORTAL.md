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

The current CLI supplies **direct ICE only**. It does not claim Internet/NAT/TURN readiness. The native release Android/Windows hosts also have no production ICE provisioning; the Android VM's local coturn settings are debug-only. A public hostname and TLS do not by themselves establish a media path across all networks. Production TURN endpoint, temporary credential delivery, quota/billing enforcement and actual external-network acceptance remain required.

Normal Android14+ capture requires local OS consent. The reported nubia name may mean **nubia S5G**; [Y!mobile's official specification](https://www.ymobile.jp/lineup/smartphone/nubia_s/) lists Android14 at launch, but the actual model/installed OS must be checked in Settings. No successful physical test is claimed from the model name.

Current browser verification uses disposable Chrome/HTTPS and a real signed Node device enrollment; pending native consent is the endpoint of this portal UI test. Actual Android/Windows video/input is separately verified in VMs. PC→physicalAndroid and cellulariPhone→physicalWindows through this portal have not yet been observed. Installer, final signing/clean install, broader Android compatibility,40devices and unattended recovery remain parent gates.

## Verification and rollback

```text
node --test tests/remote-lite-*.test.mjs
REMOTE_LITE_PORTAL_BROWSER=1 node --test tests/remote-lite-owner-portal.test.mjs
```

The browser check requires ChromeDriver and uses a generated disposable TLS certificate pinned only by that test browser. Production TLS verification is never disabled. Independent review and exact-head CI must be recorded in ACCEPTANCE.md/Issue1831 before integration.

Rollback: stop only this portal's process, revert this implementation and rebuild. Retain devices.json, owner config and native keys. There is no GORIQ migration or external deployment to reverse.
