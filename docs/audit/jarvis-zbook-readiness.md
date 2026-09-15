# JARVIS ZBook readiness repair (#683 / #686)

Parent #681, after P0 PR #682 merged at `687701002b81ceb5bdec01a552ce28403fbaf27a` and process/readiness repair PR #684 merged at `1e364e1bb82c487474487b3ef26003c5af6ed119`.

## Observed defects and correction

- On Windows/Node 24.19.0, direct `spawn('pnpm.cmd')` threw EINVAL. Supervisor now invokes the installed Next entrypoint through the Node executable with separate arguments and loopback binding. The executable path, including spaces, is tested by actually launching Next `--version`.
- A spawn error formerly only logged; it now enters bounded exponential backoff. Error plus exit cannot schedule duplicate retries. Pending retries keep the supervisor alive, stop cancels timers, a stable 60-second run resets failure count, and 20 consecutive failures terminate the stack with a nonzero exit for the external supervisor to handle.
- Spaced/host-map/foreground Funnel permissions were missed by substring checks. Structured Serve JSON is now inspected recursively. Invalid/failed status is unknown and cannot pass readiness. Expected HTTPS 443 must route to the loopback dashboard and expected DNS host.
- The recovery checker no longer prints private-ingress PASS when Tailscale is absent. Read-only local observation returns FAIL and exit 2.
- Preflight now requires matching HTTP 200 JSON health from dashboard, Broker and Gateway, rejects redirects/wrong service/auth failures, and emits SOFTWARE_READY only. This is not cellular/physical acceptance.

## #686 unattended Windows readiness hardening

The next audit found that an `AtStartup` trigger alone did not prove that the ZBook task could execute before interactive logon, and the existing installer inherited the default Windows task battery restrictions.

The bounded software change now:

- records the Scheduled Task principal, logon type, `StartWhenAvailable`, `DisallowStartIfOnBatteries`, and `StopIfGoingOnBatteries` in `pnpm jarvis:power:check`
- rejects `InteractiveToken` because it requires an already logged-on user
- rejects `S4U` for JARVIS readiness because Microsoft documents that S4U has no network/encrypted-file access and JARVIS is a networked service
- accepts only explicit network-capable unattended logon modes (`ServiceAccount`, `Password`, or legacy `InteractiveTokenOrPassword`) plus a concrete UserId
- requires `StartWhenAvailable=true`
- requires starting and continuing on battery to be allowed
- changes future installer-created tasks to allow start/continuation on battery
- deliberately does not choose/change the Windows principal or credential in repository code; applying a noninteractive principal remains an explicit admin/Human Gate and must be physically verified

This change can make readiness fail more often, by design. It removes a false-positive path rather than claiming the ZBook is already unattended-ready.

## Source basis

[Official Serve command documentation](https://tailscale.com/docs/reference/tailscale-cli/serve) documents `status --json`. [Tailscale ServeConfig](https://github.com/tailscale/tailscale/blob/main/ipn/serve.go) defines AllowFunnel as a host/port boolean map and checks foreground configurations as well. Microsoft Task Scheduler documentation states that `InteractiveToken` requires an existing interactive session and that S4U stores no password but has no network or encrypted-file access. Sources inspected 2026-09-16 JST. No Funnel configuration was enabled or changed during this work.

## Verification and remaining gates

For PR #684, 13 focused tests and the full 683-test suite passed, including direct Next process launch, lifecycle failures, malformed/private/public ingress and health identity. Lint and production build passed. Successful null/empty Serve config is unconfigured (eligible for first-time setup, never READY); malformed/error objects fail closed. No Windows service installation, account login, permission change, reboot or AC test was performed.

For #686, the isolated Node recovery predicate suite passes locally in this automation environment. Repository-wide CI remains the authoritative code/build check and physical readiness remains unverified until the ZBook task is explicitly configured and observed after reboot/power/network recovery.

P1/P2 remain PARTIAL. Required physical evidence still includes cellular ingress, a real remote Android task/result, reconnect after network loss, pre-logon reboot recovery and AC-loss recovery where hardware permits. Firmware/BIOS AC-restore remains a separate physical gate.

Next: complete PR/CI for #686, then continue software work independent of the physical gate, beginning with P3 Remote Assist/session/live-view safety and capability surfaces. Requirement rows must remain conservative until their required evidence classes pass.

Risk LOW/MEDIUM: fail-closed diagnostics and battery-safe future task settings only. No access grant, principal/credential mutation, new public endpoint, security relaxation, deployment, or physical PASS claim. Rollback by reverting the relevant PR; no state schema change.
