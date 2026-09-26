# JARVIS Remote Access

## Goal
Provide a private Internet-reachable control path from the owner's phone to the JARVIS dashboard and home-LAN fleet without router port forwarding or direct public exposure of Broker / Remote Gateway.

## Tomorrow-ready architecture

```text
Owner phone (Tailscale)
        |
        | encrypted tailnet
        v
Home host (Mac/Windows, Tailscale Serve)
        |
        +--> JARVIS dashboard 127.0.0.1:3000
        |       +--> Broker 127.0.0.1:8787
        |       +--> Remote Gateway 127.0.0.1:8790
        |
        +--> Home Wi-Fi Android fleet
```

Only the home host and the owner's remote-control device need Tailscale for this path. Android workers can remain on the home LAN and keep their existing Broker URL. Use Tailscale Serve only. Do not use Funnel.

## Recovery model
- Android Worker already keeps a foreground polling service alive across transient Broker/network failure.
- Android Worker restarts after BOOT_COMPLETED / MY_PACKAGE_REPLACED and retains WorkManager fallback polling.
- The home-host supervisor restarts Dashboard, Broker, and Remote Gateway after process failure with bounded exponential backoff.
- `tailscale serve --bg --yes 3000` stores the private Serve configuration in the Tailscale daemon, so ingress returns with Tailscale after host reboot.
- Saved Wi-Fi reconnect remains an OS responsibility. Once validated connectivity returns, Worker polling resumes automatically.
- Existing durable JARVIS state remains the source of truth; this remote path does not weaken Human Gates.

## Security boundary
- no router port-forwarding
- no public Tailscale Funnel
- Dashboard binds to loopback by default
- Broker and Remote Gateway remain behind the Dashboard owner-auth proxy for remote use
- signed Android worker requests and replay/nonce checks remain unchanged
- secrets stay in local environment / OS secret facilities and are never committed

### Native iPhone Owner recovery enrollment

The native Owner app can register another iPhone through a short-lived, single-use code displayed by an already trusted iPhone. This flow is separate from Tailscale transport and browser PIN login; it does not expose the Production Owner secret or weaken the private-ingress boundary. See [iPhone Owner recovery enrollment](./iphone-owner-recovery-enrollment.md).

The public issue, redeem, and cancel routes remain unavailable unless an operator explicitly sets `GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED=1`. Disabling the flag is the rollback switch: active recovery records are rejected while existing trusted devices remain registered.

## One-time operator setup
1. Install Tailscale on the selected always-on home host and the owner's remote phone; sign both into the same tailnet.
2. On the home host, keep the existing JARVIS secrets in `.env.local` or the OS environment. Never paste them into GitHub.
3. Build once: `pnpm install --frozen-lockfile && pnpm build`.
4. Run `pnpm jarvis:remote:preflight`.
5. Start the resilient stack with `pnpm jarvis:remote:host`.
6. Install the OS autostart helper for the chosen host. This is a local OS permission operation and may require Administrator/sudo approval.
7. From the remote phone, disable Wi-Fi, connect Tailscale, and open the private `https://<host>.<tailnet>.ts.net` address printed by preflight.

## Acceptance
Repository acceptance:
- bounded restart/backoff supervisor
- preflight verifies Tailscale connectivity and refuses public Funnel configuration
- CI tests cover restart planning and private-ingress policy
- existing JARVIS CI remains green

Physical acceptance, never claim without observation:
- remote phone on cellular reaches dashboard through tailnet
- one Android task issued remotely returns verified result
- router/network interruption recovers without re-enrollment
- host reboot restores the remote path
- live-screen control remains separately evidence-gated until demonstrated
