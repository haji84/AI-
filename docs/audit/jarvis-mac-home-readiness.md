# Mac home Coordinator readiness — 2026-09-17

## Decision

**CONDITIONAL FEASIBILITY / NOT READY FOR CUTOVER.** The Mac is remotely reachable through its existing GitHub runner and appears to have adequate resources for a coordinator candidate. It is not presently an operational replacement for the Windows fleet. No 100-device throughput or low-latency claim is made.

Owner scope: investigate all prerequisites while away from home, without changing existing enrollment. Parent #681, audit #863, PR #864. No production deployment, host restart, network/credential changes, secret transfer or device commands were performed. Diagnostic workflow writes only normal runner job logs; no repository checkout or dependency installation.

## Measured inventory

Three bounded read-only jobs ran on the physical MacBook; final evidence: [run 35205781413](https://github.com/haji84/AI-/actions/runs/35205781413), commit `69a59955c21978ac216d77630b6b121248d94d13`, 09:33 UTC / 18:33 JST. Sanitized output: `docs/evidence/863-mac-readiness.json`.

| Check | Result and consequence |
| --- | --- |
| Remote execution | PASS: existing MacBook runner online and executes diagnostic; no local Mac interaction needed for this inventory |
| Hardware | Apple M1 Pro 8 cores, 16 GiB memory, about 157 GiB free disk; load around 1.1–1.4. Memory-pressure query reported 69% free; `os.freemem` alone must not be interpreted as memory exhaustion |
| OS/runtime | macOS 26.6.2, ARM64, Node 24.21.0; pnpm and ffmpeg paths present. Package/build compatibility not proved by executable existence |
| Power | AC power, battery 100%. Current sleep assertions prevent system/idle sleep; caffeinate exists. Saved AC/battery `sleep=1`, so permanent unattended behavior depends on assertions and is not verified across reboot |
| Private network | FAIL readiness: Tailscale installed/running but `NeedsLogin`, self offline, zero peers |
| Home LAN | Mac en0 192.168.0.107/24. Windows now Wi-Fi 192.168.100.49, tailnet 100.71.220.44. Mac TCP probe to legacy 192.168.0.169:8792 times out |
| Existing Windows ingress | Still listens on 192.168.0.169:8792 although current Wi-Fi is elsewhere. Android cached endpoint cannot follow the physical laptop automatically |
| Mac resident services | Existing Broker 8787 health PASS; 8790 is **jarvis-direct-commander-v5**, not evidence of the requested Remote Gateway. It listens on all IPv4 interfaces. Port 3000 unavailable |
| Build/startup | Resident source commit 14f0651; no `.next/BUILD_ID`. System ai.jarvis.remote-host is `spawn scheduled` without PID. Existing user LaunchAgents have RunAtLoad/KeepAlive; their presence is not reboot acceptance |
| Independent state | Mac persisted registry 1, identities 1, task records 141 (not classified as pending); Windows current registry 38, task records 0. Both stores must be preserved; do not overwrite Mac history with Windows DB or silently merge authority |
| Windows connectivity | At 09:33:46Z all 38 entries have stale heartbeats; newest 2026-09-16T23:06:07Z. Stored ready does not mean online |
| Existing exposure | Mac cloudflared processes and legacy broker/commander tunnel LaunchAgents active; resident scripts use quick-tunnel `--url`. Public reachability/auth not tested. This conflicts with the desired private-only architecture and needs controlled retirement after dependency inventory, not reuse |
| Host protections | FileVault ON and firewall ON; retain protections |
| iPhone | Port 8788 probe failed; bridge can use dynamic ports, so absence of iPhone registration cannot be inferred. Existing Keychain/bridge-state continuity remains a separate prerequisite |

## Required preparation, in dependency order

1. Authenticate Mac Tailscale into the existing owner tailnet; verify owner access rules, private reachability, stable service naming and no Funnel. Account login/network permissions are a Human Gate; no auth keys or passwords in chat/logs.
2. Prepare a shadow release without binding occupied ports or enabling dispatch. Build the current UI/runtime; verify owner auth and the actual Remote Gateway. Avoid running legacy public-tunnel startup helpers.
3. Back up both host states consistently, including registry/key metadata, histories, evidence, invitation sidecars and config. Windows DPAPI needs secure re-protection, not file copying. Preserve existing TLS/private credentials without rotation or plaintext archives. Pending grants/nonces/mailboxes require explicit continuity/drain handling; see compatibility audit.
4. Design legacy endpoint ownership at home. Current APK trusts 192.168.0.169 and its certificate. Reserve/verify address ownership with DHCP/router configuration before any alias or route change; prevent collision when ZBook returns. Retain known-good fallback. No re-enrollment or per-device URL entry.
5. Resolve old/new service port conflicts and legacy public-tunnel dependencies. Shadow must remain isolated; only one primary leases tasks. Keep both existing histories and prove rollback includes writes after switch.
6. Establish persistent startup/sleep policy and a recovery path. Do not reboot while owner is away until a recovery route is demonstrated. Existing runner may itself require user login after reboot.
7. Canary one already-enrolled Android, then existing iPhone: unchanged ID/credentials, signed task/result/verifier, screen/tap/text, network loss/reconnect and no duplicate work. Extend gradually only after PASS.
8. Verify owner phone on cellular, external ZBook/Mac, home fleet continuation with ZBook absent, return without IP conflict, backup restore, rollback and capacity. Full power loss/reboot needs a separately controlled physical test.

## What read-only inspection cannot certify

- Router DHCP ownership, Wi-Fi isolation/band/congestion/AP capacity and 100 simultaneous clients.
- End-to-end cellular latency, tailnet direct vs relay transport, sustained video bitrate, 1/2/4-view performance, loss/reconnect. TCP reachability and available ffmpeg are not screen-streaming proof.
- Android permissions, API26–29 screen-capture consent, lock/wake and signer-matched update preservation on every device. Pending Android8/updater/wake draft work is not deployed by this audit.
- ZBook/Mac moving to another network and rejoining as the same Worker; this needs software beyond the current fixed endpoint.
- Reboot/AC-loss, FileVault unlock, post-login service behavior, durable queues and restoration under failure. These were deliberately not induced on the unattended Mac.
- Fully autonomous work without Work/Codex reasoning handoff: a coordinator hosts execution/state, not a replacement paid model provider.

## Recovery platform constraints

Tailscale's [macOS variant comparison](https://tailscale.com/docs/concepts/macos-variants) says GUI variants do not run before login; the CLI daemon variant can. Do not promise Windows-style `--unattended` on this Mac app. Changing variant/service installation is a separate reviewed configuration action.

Apple documents [FileVault unlock over SSH on Apple silicon/macOS 26+](https://support.apple.com/guide/security/managing-filevault-sec8447f5049/web) when Remote Login and networking are available. This Mac meets the model/OS category, but its pre-login route and Remote Login were not proved. Tailscale after-login connectivity alone does not prove remote disk unlock; do not disable FileVault to work around it.

## Travel decision

Mac can be investigated and prepared remotely through the runner, but the present configuration is **NO-GO as a drop-in home Coordinator**. First external dependency is Mac tailnet authentication. Then an isolated build, identity-preserving state/endpoint migration and real existing-device canary are required. No promise of travel readiness until those pass. GitHub job success certifies only that this read-only inventory ran.

Rollback of this audit: revert its branch files; live host/device settings were not changed. Next bounded action: prepare private Mac authentication and shadow deployment plan, with explicit approvals for credential/network/service changes and no registration interruption.
