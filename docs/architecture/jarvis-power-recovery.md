# JARVIS Power-Loss Recovery

## Objective
Recover the private remote-control path after Wi-Fi/Internet interruption, service crash, OS reboot, and as far as hardware allows, full AC power loss.

## Recovery layers

1. **Android Worker:** foreground polling service survives transient Broker/network failures; BOOT_COMPLETED and WorkManager fallback restore polling after Android restart.
2. **JARVIS host processes:** `jarvis:remote:host` supervises Dashboard, Broker, and Remote Gateway with bounded restart/backoff.
3. **Private ingress:** Tailscale Serve remains tailnet-only. Funnel/public ingress is refused.
4. **OS startup:** Windows uses the `JARVIS Remote Host` Scheduled Task in `-AtStartup` mode. macOS unattended boot uses the system LaunchDaemon installer below.
5. **AC restoration:** macOS can explicitly enable `pmset autorestart 1`. Windows/ZBook firmware behavior is vendor/BIOS dependent and cannot be safely changed generically by JARVIS.

## macOS unattended boot

The older LaunchAgent path is useful after user login, but it is not sufficient for an unattended reboot. For a host that must recover without login, use the explicit system installer:

```bash
sudo ./scripts/install-jarvis-remote-launchdaemon-macos.sh --apply "$(pwd)"
pnpm jarvis:power:check
```

The installer intentionally refuses to self-elevate. It installs `/Library/LaunchDaemons/ai.jarvis.remote-host.plist`, runs the JARVIS process as the normal owner account rather than root, and enables `pmset autorestart 1`.

## Windows / ZBook unattended boot

Run the existing installer from an explicitly elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-jarvis-remote-autostart-windows.ps1 -RepoRoot (Get-Location).Path -AtStartup
pnpm jarvis:power:check
```

The installer creates a task but does not by itself prove unattended boot. The read-only checker now requires an enabled boot trigger, the inspected owner's noninteractive Password logon, Limited run level, exact Node/host-script action and working directory, battery continuation, offline startup, bounded restart settings, and duplicate-instance prevention. A boot trigger alone, Interactive logon, or S4U is not sufficient. Tailscale must also be running with automatic start.

The current installer uses a PowerShell/pnpm action and does not configure all these conditions, so it will correctly remain unready. Do not respond by weakening the diagnostic or silently registering a more privileged account.

### One-time setup gate (prepared, not executed)

The owner or Windows administrator must review the existing `JARVIS Remote Host` task in Task Scheduler. When this gate is scheduled, use the normal owner identity with “Run whether user is logged on or not”, without highest privileges. Windows may require the owner password locally; never send it to JARVIS, chat, source control or logs. S4U is not a substitute for this network-dependent host.

Configure one action with the absolute Node executable, argument `"<repository>\scripts\jarvis-remote-host.mjs"`, and Start in `<repository>`. Enable the boot trigger, Start when available, restart every minute up to 20 times, no execution time limit and “Do not start a new instance”. Allow start/continuation on battery and do not require a network connection before startup. These are preparation instructions, not authorization to change credentials or task permissions automatically. Alternate service identities require separate review.

Run `pnpm jarvis:power:check` afterwards from that same owner account. A configuration pass still requires subsequent real reboot/network/power-loss evidence; it does not validate saved credentials, account rights, resource accessibility, battery duration or firmware behavior.

References: [Microsoft Scheduled Task principal](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal), [battery/restart settings](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset), [S4U network restriction](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_logon_type). Read-only collector: `scripts/inspect-jarvis-startup-windows.ps1`. The CLI reports safe diagnostic messages rather than dumping task arguments or credentials.

### Firmware gate

A complete battery drain or desktop AC loss may leave a Windows machine powered off even though Windows startup is configured correctly. `pnpm jarvis:power:check` reports this as a non-software firmware gate because generic code cannot safely set every vendor's BIOS/UEFI option.

For the selected always-on host, manually verify a firmware setting equivalent to:

- Restore on AC Power Loss
- After Power Loss: Power On / Last State
- AC Recovery

For an HP ZBook, the exact label varies by model/firmware. Do not claim this gate passed until a real power-loss test proves it.

## UPS behavior

A UPS is recommended but not required by the software architecture.

- Short outage: UPS or laptop battery keeps the host and, ideally, router/ONT alive, so no recovery cycle is needed.
- Longer outage: networking can disappear while JARVIS state remains durable; after power returns, saved Wi-Fi/Tailscale reconnect and the startup supervisor restores the stack.
- Full battery depletion: recovery additionally depends on the hardware AC-restore firmware gate above.

If possible, place the home router/ONT and the always-on JARVIS host on the same UPS. Keeping only the computer powered while the router is dead does not preserve remote access.

## Readiness command

```bash
pnpm jarvis:power:check
```

Required checks fail closed. The command verifies:

- production Next build exists
- Tailscale backend is connected
- Funnel/public ingress is not active
- platform startup registration is ready
- macOS `autorestart=1`, or Windows Tailscale automatic startup

Hardware/firmware items that cannot be verified generically are emitted as explicit warnings, not silently marked PASS.

## Physical acceptance

Never claim automatic outage recovery until all applicable observations exist:

1. remote phone on cellular reaches the private JARVIS URL
2. an Android task is issued remotely and returns a verified result
3. router/Internet interruption recovers without re-enrollment
4. host OS reboot restores Tailscale + JARVIS without manual app launch
5. for long-outage recovery, a real AC-loss/restore test proves the host powers on automatically
6. live screen control remains a separate evidence gate
