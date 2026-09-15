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

The installer configures the task so it may start and keep running on laptop battery, but it deliberately does not invent or change a Windows credential/principal. An `AtStartup` trigger by itself is not proof that the task can run before interactive logon.

The readiness checker therefore requires all of the following before `windows-startup-task` can PASS:

- task state is Ready or Running
- trigger is a boot/AtStartup trigger
- a concrete task principal exists
- the logon mode is explicitly noninteractive and network-capable (`ServiceAccount`, `Password`, or legacy `InteractiveTokenOrPassword`)
- `StartWhenAvailable` is enabled
- starting on battery is allowed
- switching to battery does not stop the task

An existing task that is AtStartup but still uses `InteractiveToken` must fail closed. `S4U` also fails closed for this readiness check because Microsoft documents that S4U has no access to network or encrypted files, while JARVIS is a networked service. Choosing or changing the noninteractive principal is an explicit Windows/admin configuration action and is not silently performed by the repository installer.

The checker separately verifies that the Tailscale Windows service is running with automatic start.

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
- macOS `autorestart=1`, or Windows unattended task + Tailscale automatic startup readiness

Hardware/firmware items that cannot be verified generically are emitted as explicit warnings, not silently marked PASS.

## Physical acceptance

Never claim automatic outage recovery until all applicable observations exist:

1. remote phone on cellular reaches the private JARVIS URL
2. an Android task is issued remotely and returns a verified result
3. router/Internet interruption recovers without re-enrollment
4. host OS reboot restores Tailscale + JARVIS without manual app launch or interactive user logon
5. for long-outage recovery, a real AC-loss/restore test proves the host powers on automatically
6. live screen control remains a separate evidence gate
