# JARVIS ZBook readiness repair (#683)

Parent #681, after P0 PR #682 merged at `687701002b81ceb5bdec01a552ce28403fbaf27a`.

## Observed defects and correction

- On Windows/Node 24.19.0, direct `spawn('pnpm.cmd')` threw EINVAL. Supervisor now invokes the installed Next entrypoint through the Node executable with separate arguments and loopback binding. The executable path, including spaces, is tested by actually launching Next `--version`.
- A spawn error formerly only logged; it now enters bounded exponential backoff. Error plus exit cannot schedule duplicate retries. Pending retries keep the supervisor alive, stop cancels timers, a stable 60-second run resets failure count, and 20 consecutive failures terminate the stack with a nonzero exit for the external supervisor to handle.
- Spaced/host-map/foreground Funnel permissions were missed by substring checks. Structured Serve JSON is now inspected recursively. Invalid/failed status is unknown and cannot pass readiness. Expected HTTPS 443 must route to the loopback dashboard and expected DNS host.
- The recovery checker no longer prints private-ingress PASS when Tailscale is absent. Read-only local observation returns FAIL and exit 2.
- Preflight now requires matching HTTP 200 JSON health from dashboard, Broker and Gateway, rejects redirects/wrong service/auth failures, and emits SOFTWARE_READY only. This is not cellular/physical acceptance.

## Source basis

[Official Serve command documentation](https://tailscale.com/docs/reference/tailscale-cli/serve) documents `status --json`. [Tailscale ServeConfig](https://github.com/tailscale/tailscale/blob/main/ipn/serve.go) defines AllowFunnel as a host/port boolean map and checks foreground configurations as well. Sources inspected 2026-09-16 JST. No Funnel configuration was enabled or changed during this work.

## Verification and remaining gates

13 focused tests and the full 683-test suite passed, including direct Next process launch, lifecycle failures, malformed/private/public ingress and health identity. Lint and production build passed. Successful null/empty Serve config is unconfigured (eligible for first-time setup, never READY); malformed/error objects fail closed. Local readiness remains FAIL: Tailscale command unavailable, startup task/service unavailable, firmware unknown. These are genuine unpassed conditions; no Windows service installation, account login, permission change, reboot or AC test was performed.

P0 PR CI #941 passed including health; merged-main workflow query returned no runs during this cycle. Main CI is therefore unverified, not silently assumed green. Deployment remains inactive.

Next: confirm full test/build/PR CI, then improve Windows unattended task readiness (noninteractive principal and battery policy) without installing it; prepare isolated startup/recovery verification. P3 remote session safety/live view remains independent software work. Requirement status remains PARTIAL until integration/physical evidence is complete.

Risk LOW/MEDIUM: local process lifecycle and fail-closed diagnostics, no access grants or new public endpoints. Rollback by reverting this PR; no state schema change. Automatic fix attempts for #683: 0 as of focused verification.
