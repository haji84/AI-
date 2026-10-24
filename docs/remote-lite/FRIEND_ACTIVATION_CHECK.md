# GORIQ Remote Lite: friend-only activation proof and release gates

Issue #1831; Draft PR #1832. This document describes the **first step in the remaining completion path**. It is not a deployed service or permission to distribute.

## Local, read-only readiness check

The existing Remote Lite owner portal already supports distinct account keys and per-owner device/session authorization. Its tests use two independent accounts under real local HTTPS; friend accounts have not been issued in production. To avoid treating valid source code or an issued HTTPS certificate as a live, friend-usable service, inspect the exact *operator-controlled private* wrapper and portal configuration before any activation:

```text
node scripts/remote-lite-friend-activation-check.mjs <absolute-private-wrapper-path>
```

The inspector reuses the actual hosted-portal configuration loader, the existing account hash validator and TLS certificate/private-key identity checker. It checks that the friend hostname differs from every listed owner-management hostname, account key hashes have the expected shape and uniqueness, the existing registry is readable and bound to declared owners, the certificate is in date and matches the configured TLS identity, and a configured STUN or TURN issuer passes existing syntactic/secret validation. It does **not** connect to the public network, generate a signing key, open a port, change credentials, change OS/ACL/Tailscale policy, create a registry lock, start Android/Windows screen sharing, or deploy GORIQ.

The only stdout is bounded JSON with booleans, machine-readable blocker codes, and explicit Human/physical acceptance gates. No paths, usernames, hashes, IPs, certificates, private keys, tokens, ICE passwords, or device identifiers are included. Exit 0 means **configured local prerequisites only**. Missing/unverifiable prerequisites return exit 2. `deploymentAccepted`, `physicalIphoneAccepted`, `deviceAndFriendAccountAccepted`, and `distributionSignedAndAccepted` are **always false** at this stage. Even a fully configured private file is not evidence of Internet connectivity or an activated device. A `stun` issuer does not establish a relay path.

## Private Tailscale binding candidate (advisory, not a network gate)

The current owner-hosted proposal requires an isolated **TCP8443 listener bound to the particular Tailscale interface**, with the external friend's network policy allowing only that endpoint. The read-only CLI reports `privateBind` and `privateBindBlockers` separately from `configured`:

- `tcp8443` checks that `listenPort` is the number `8443`, not a string or another port.
- `tailscaleIpv4Candidate` requires a syntactically valid, literal address in the shared-address `100.64.0.0/10` range. Wildcard (`0.0.0.0`, `::`), loopback, LAN, malformed IPv4 and another port cannot qualify as the **planned private address**.
- `candidate: true` means **syntax only**. It does not prove this address belongs to the host's assigned Tailscale interface, that a packet reached it, or that a firewall/ACL/Tailscale access grant prevents other users or services. For that reason `actualHostInterfaceVerified`, `friendNetworkPolicyVerified` and `friendOnlyReachabilityVerified` remain `false`; `deploymentAccepted` is always `false` in this tool.
- The local `configured: true` status may coexist with a failed private candidate, for example a loopback fixture in CI. Its exit code is still about **local config only**. Operators must check `privateBind.candidate` and then run the **separate owner-approved actual allow+deny network E2E**; they must never start a real service on the basis of the CLI exit code alone.

The static check intentionally does not alter the host, start a socket, enumerate network interfaces, write Tailscale policy, create a friend's credentials or collect real device data. Tailscale IPv6 or future VPN-free delivery requires a separately reviewed profile; this candidate check does not claim it is impossible or authorize a fallback to wildcard binding.

## Next product line after local readiness

1. Owner verifies exact real friend identity, existing owner-management hostnames, independent account provisioning/key ownership and planned private TCP8443/Tailscale access. No friend grant/policy write without a separate scoped approval. Preserve core Owner/Broker credentials outside the friend process.
2. After review and approval, separately activate one actual private HTTPS friend portal on its specified port with no public WAN exposure and no change to 8787/8790/8792/8796/8797. Validate normal browser CA/hostname verification, friend login, one-device invitation/confirmation, server restart and registration retention. Verify a different friend account cannot view, approve, control or revoke the first friend's device. Validate revocation and logout at every stage.
3. Perform physical, owner-consented Windows and Android remote session acceptance from iPhone Safari on a different cellular connection. Collect actual frame counters, input effects, ACK, stop/revoke, reconnect, NAT/relay behavior and traffic cap evidence. A VM success, TAP ACK without target effect, and successful HTTPS alone are insufficient.
4. Verify officially signed Windows MSI and Android APK, license notices, clean friend-PC/phone install, upgrade/repair/uninstall with identity preservation, revocation and support instructions. Test supported OS versions; explicitly report Android 9–13 limitations and fresh MediaProjection consent after lock/reboot. Stress 40 devices only with real bounded capacity instrumentation.
5. Publish only when all required evidence, independent review and explicit Human Gates are satisfied. Avoid multiple duplicate PRs; make scoped corrections to Draft #1832.

## State and safety

As of 2026-10-24 the repo PR #1832 is Draft/unmerged. CI on previous head was successful, but **real friend-only service activation, permanent TURN/expiry renewal, separate-network iPhone acceptance, and production package signatures are not proven**. The existing Tailscale stage-1 (owner-only) state is not equivalent to friend access. The earlier no-VPN public product goal and the currently owner-approved Tailscale friend service are distinct delivery scopes. Do not silently claim original public no-VPN requirements complete from the private Tailscale candidate.

Any new operating credentials, Tailscale friend sharing/grants, firewall openings, paid relay, signing, core service restart or public distribution must be reviewed and explicitly approved under the existing Human Gate. No shared Compass Goal/WorkState overwrite, no live activation in this change.
