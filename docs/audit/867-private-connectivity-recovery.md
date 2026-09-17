# Existing Android connectivity recovery — #867

Parent #681, audit #865/#866; authorization: owner requested necessary restoration work excluding billing in this task on 2026-09-17. No permission is inferred to erase identities, weaken security, publish Broker/Gateway or rotate existing keys.

## Observed root cause and scope

At 2026-09-17T13:03:03Z Windows Broker responds with 38 registered Androids, zero recent heartbeats, newest heartbeat 2026-09-16T23:06:07.820Z and zero task records. Wi-Fi address is 192.168.100.49, tailnet address 100.71.220.44. Existing TLS Worker ingress still listens at 192.168.0.169:8792. Broker8787/Gateway8790/Dashboard3000 bind loopback. Tailscale Serve routes the private owner hostname to localhost3000; no Funnel was enabled.

Owner explicitly confirmed ZBook is outside home. The legacy LAN endpoint therefore no longer has its host on the home LAN. The home Mac independently timed out connecting to this endpoint. This explains the broken fleet route; it does not prove every Android is powered on or permission-ready. Restarting Windows or re-enrolling devices is not a repair for this topology.

## Current home Mac evidence

Read-only existing workflow run [35224891426](https://github.com/haji84/AI-/actions/runs/35224891426), job105213822408 completed successfully at approximately13:05Z:

- Mac runner online; AC100%, en0 192.168.0.107/24.
- Tailscale `NeedsLogin`, offline, zero peers.
- Broker8787 alive, but its separate state has 1 identity and 141 task records (not classified as pending). Do not overwrite or merge this with Windows authority.
- Port8790 is legacy direct commander, not the required modern Gateway. UI3000 unavailable. System remote-host is spawn-scheduled, not running.
- FileVault and firewall remain enabled. No reboot or sleep-policy change performed.
- Legacy quick-tunnel services already exist; they are not reused for this restoration. Their controlled retirement remains a separate dependency review, not evidence of private-only compliance.

## Bounded authentication preparation

The existing Mac app supports a CLI path. Official references: [Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli?tab=macos) and [up command](https://tailscale.com/docs/reference/tailscale-cli/up).

`scripts/jarvis-mac-auth-request.mjs` reads status, only attempts `up` in NeedsLogin, never uses logout/reset/force-reauth, bounds process/output and encrypts the login challenge with an ephemeral public transport key. Raw CLI output and the plain login URL are not put in GitHub logs. The corresponding ephemeral private transport key is DPAPI CurrentUser-protected on the owner's Windows machine; it is unrelated to existing device signing keys.

The dedicated workflow is constrained to this repository/branch, a pinned script commit and expiry2026-09-17T14:30:00Z. It has contents:read only, no checkout, no artifact upload and a two-minute timeout. Existing Mac repository/services remain untouched except the explicitly requested Tailscale login initiation. This is task-specific operations preparation, not production release automation.

Run [35225356043](https://github.com/haji84/AI-/actions/runs/35225356043) returned LOGIN_REQUIRED with encrypted challenge. It was decrypted locally and the owner browser reached Tailscale login. **This is not successful tailnet authentication or restored Android operation.** Owner account sign-in is pending; no password is requested in chat. No new paid service or reusable auth key was created.

## Safe continuation design — not deployed

Prefer a temporary byte-forwarding compatibility path that retains Windows as the one current registry/signature authority, rather than copying database/private keys into the older Mac installation:

Home Android → original LAN endpoint/TLS → home bridge → private tailnet → original Windows TLS ingress → current Broker.

Mandatory conditions before activation:

1. Confirm Mac joins the SAME intended tailnet and can reach the intended Windows node. Do not infer identity from an IP alone; check node/account metadata and existing TLS trust.
2. Establish ownership of the legacy home IP against router DHCP/reservations and actual LAN observations. A failed TCP probe is not proof an address is free. Do not blindly assign the address to Mac. Define fencing against a returning ZBook using the same address.
3. Preserve end-to-end Worker TLS and signed requests/results; do not decrypt TLS at a new untrusted proxy, rotate keys or put credentials in a relay config. Restrict relay destination/listener and bound sockets/time/resources. Prevent an open proxy.
4. Provide a private-only destination on Windows reachable by Mac while retaining the existing LAN listener. Validate authorization/firewall restrictions without expanding public exposure or disrupting the owner UI.
5. Test an isolated relay against a fixture before production. After the authenticated path is verified, use one existing device as canary: unchanged ID/key, heartbeat, signed task/result, observation/input and verifier. Enrollment counts must not change unexpectedly.
6. Rollback must stop the added relay/listener and remove only the introduced address/route after verifying exact ownership. Existing Windows and Mac registries stay untouched. Retain the original known-good home setup.

This temporary bridge still depends on ZBook staying powered/networked outside home. It is NOT the final independent Home Coordinator and cannot pass ZBook-removal acceptance. Full role/state migration remains M0–M10 under #863.

## Verification / remaining work

Transport-key test covers matching-key decryptability, wrong-key refusal and untrusted URL refusal. Fresh remote diagnostics proved the current route failure and Mac accessibility, not fleet restoration. Existing device credentials were not altered; no firmware, OS restart, public tunnel or billing operation occurred.

Next: owner signs into the displayed Mac Tailscale challenge; re-read Mac state and Windows peers, then assess legacy IP ownership and private compatibility bridge conditions before any network cutover. If OS-local permission or router ownership cannot be verified remotely, record that exact gate. Do not ask the owner to re-enroll the fleet.
