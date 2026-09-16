# #786: Windows native startup repair

Observed 2026-09-17 JST. Parent #681. Owner instruction: `なら根本を修正して`.

## Root cause

- Task Scheduler started the owner PowerShell process in session 0, then exited `0xFFFD0000` before the launcher ran. Earlier direct Node launch with an AppData working directory failed `0x8007010B`.
- ETW file-I/O showed the task looking for the apparent AppData launcher while the actual file was under the Codex package's `LocalCache/Local` tree. Both views from Codex had the same SHA256.
- A same-owner unpackaged Windows probe confirmed: apparent launcher absent; new `%USERPROFILE%/JARVIS/production/launch-current.ps1` present. This excludes Windows-password failure as the remaining root cause.

## Applied operational repair

- Copied the already deployed, CI-passing release `90a111b47a0f5ff8920d1d8dc0d32d563c43f229` outside AppData into the owner-profile JARVIS directory, with owner+SYSTEM filesystem ACLs. No source-code edits were applied to the release.
- Copied protected TLS material unchanged and retained old encrypted config. Updated release/state paths in DPAPI config while preserving all credential values.
- Stopped only the identified temporary host; copied the quiescent Broker database with WAL/SHM and teaching/audit data. Source copies remain available.
- An action-only `schtasks /Change` required password entry and was not completed. Task action, principal and stored credential remained unchanged. A native same-owner helper created the missing compatibility launcher at that existing action path; it delegates to the protected physical installation.
- At 00:35:36 JST the existing Windows task started successfully. Four Node services run in Windows session 0, independent of the Codex tool process tree. Task result `267009` (`0x41301`) means running, not an error.

## Verification

- Task Running; dashboard `127.0.0.1:3000`, Broker `127.0.0.1:8787`, Gateway `127.0.0.1:8790`, Worker HTTPS `192.168.0.169:8792` listening.
- Loopback owner login HTTP 200, authenticated Fleet Console HTTP 200; invalid login HTTP 401 with no cookie. Secure/HttpOnly/SameSite=Strict preserved. Credentials were never printed or sent to an external hostname.
- Broker reports registered=2, ready=2, offline=0; enrollment window remains closed. No re-enrollment.
- Regression: 941/941 tests pass on Windows, including real DPAPI roundtrip and new native-path rejection/precedence tests. The initial full run lacked Git Bash in PATH and failed the shell-syntax test; rerunning with the installed Git Bash resolved the environment prerequisite without changing tests.
- ESLint for changed JS and TypeScript check pass. Build/CI recorded in the follow-up PR.

## Remaining limits

The Tailscale blocker below was observed during the initial repair and was resolved by the later approved operation recorded under **Tailscale recovery follow-up**. Physical reboot/AC-loss/crash acceptance remains outstanding.

- Tailscale service is Running/Auto but backend reports `NoState`, WantRunning=true, LoggedOut=false and no tailnet interface. Private DNS does not resolve. This is a separate current blocker to external access; no remote/cellular PASS is claimed.
- The automated approval reviewer refused elevated Tailscale restart pending specific owner approval. A single service restart is proposed; no logout, state deletion, key rotation, Funnel or firewall changes.
- A Broker crash injection was denied by Windows process permissions; the Broker was not stopped. No physical crash-recovery PASS is claimed from that attempt.
- Actual Windows reboot, AC-loss recovery and subsequent cellular access remain unverified. The code/repository changes do not make those requirements VERIFIED.

## Rollback / next action

Keep the native installation and original encrypted/config/database copies. Before rollback, quiesce the named task, preserve newer durable state and explicitly select the correct release/config pairing. Do not restore stale DB contents over newer enrollments or recordings. No automatic deletion or credential rotation.

Complete owner-approved Tailscale restart and verify the existing private URL, then coordinate a real Windows reboot. Future updates/installations must use OS-visible native paths and verify actual startup rather than task registration alone.

## Tailscale recovery follow-up (2026-09-17 01:10 JST)

- Owner granted standing approval: `Tailscaleも常時承認しといて`. Scope: this ZBook's routine Tailscale diagnostics, existing connection recovery, service start/restart and Windows elevation required for those actions, until revoked. No repeated operational approval is needed within that scope. Windows UAC consent remains an OS requirement.
- The approved elevated service restart completed but backend remained `NoState`. The existing selected connection profile was still present, with no Tailscale tray process running.
- Owner separately approved the persistent setting: `無人常駐モードを承認する`. `tailscale set --unattended=true` returned exit0. Subsequently backend became `Running`, health was empty, the existing tailnet address returned, and private Serve resumed `/ -> http://127.0.0.1:3000`. No login/credential rotation or new account was needed.
- Fresh verification at `2026-09-16T16:10:42.176Z`: `https://haji.tail93987e.ts.net/jarvis` returned HTTP200. Authentication was tested exclusively on localhost: valid login/UI200, invalid login401, cookie protections retained. Broker registered=2, ready=2, offline=0, enrollment closed; native Windows task still Running.
- The verification helper now explicitly fails unless the measured private URL response is200. Its record update also checks the measured result before writing success. An earlier unconditional record-update proposal was rejected by automatic review and never executed.
- Protected local records: `production/tailscale-standing-approval.json`, `production/tailscale-recovery.json`, `production/native-verification.json`, `production/physical-root-status.json` under the native owner-profile installation. No secrets are included in repository evidence.

Standing approval does not authorize public ingress/Funnel, firewall or tailnet ACL changes, new account credentials, billing, state deletion or security weakening. The explicit unattended-mode approval authorizes that setting only. No actual Windows reboot, AC-loss recovery, process-crash recovery or fresh external-phone cellular acceptance is claimed. Next: coordinate physical reboot and subsequent private remote acceptance while preserving existing device identities and credentials.
