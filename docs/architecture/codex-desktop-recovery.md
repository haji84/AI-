# Codex desktop recovery on ZBook (#869)

Owner approved implementation and local installation on 2026-09-18, then requested silent monitoring and an explicit Work-triggered close/relaunch operation. Scope is desktop-process recovery/restart, not AI task resubmission. The watcher is independent of Codex and makes no model/API calls.

## Operation

`Codex Desktop Recovery` runs a compiled Windows GUI launcher at user logon and every minute, using the existing signed-in user's Interactive token and Limited run level. The launcher starts PowerShell with `UseShellExecute=false`, `CreateNoWindow=true`, and redirected stdout/stderr; it never allocates a command window. Checks have a 45-second scheduler limit (40-second launcher child limit), IgnoreNew scheduling and an exclusive file lock. Normal checks never stop an existing process or change other service tasks.

The packaged desktop parent is recognized by its OpenAI.Codex publisher/package path, current session and absence of Electron `--type` child arguments. The internal CLI is excluded. Unknown process metadata fails closed. Windows' stable `OpenAI.Codex_2p2nqsd0c76g0!App` activation identity avoids pinning an installed package version.

Each missing-process recovery consumes a persisted attempt before requesting activation. At most three attempts are allowed until the same desktop process remains present across checks for five minutes, or the owner explicitly resumes. This also bounds quick crash/relaunch loops. A fourth missing check records `blocked` and returns exit 2. Other errors return 1. A launched process is verified on the following scheduled check; activation alone is not reported as recovery success.

## Installation and owner controls

Run Windows PowerShell as the signed-in owner:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/install-codex-recovery.ps1
```

Files/state/logs live in `%USERPROFILE%\CodexRecovery`. Do not install into AppData: the packaged Codex host redirects AppData writes to its MSIX LocalCache, which Task Scheduler cannot see at the original path. This was observed during acceptance and matches the existing #786 native-startup finding.

Double-click `Pause recovery.cmd`, `Resume recovery.cmd`, or `Status recovery.cmd` in that folder. These manually invoked controls may show a command window; periodic monitoring does not. Resume also resets the retry budget. To intentionally quit Codex without it reopening, pause first. Permanent rollback is to disable **Codex Desktop Recovery** and **Codex Desktop Restart** in Task Scheduler; retain files/logs for diagnosis. No other task needs changing.

`-RepairExistingTask` updates the existing installation with retained payload/task backups under `install-<id>/previous`. It validates issue identity, same-owner Interactive/Limited runtime and restart trigger/timeout settings, disables only these tasks during the copy, and takes the recovery lock. Failure restores previous payload/control files and task actions, re-enables previously enabled tasks, and disables newly registered tasks. Newly created inactive artifacts are retained for diagnosis. Staging and backup folders are intentionally not automatically deleted.

## Explicit restart from connected Work

The local `codex-desktop-restart` skill is stored in `skills/codex-desktop-restart` and installed under `%USERPROFILE%\.codex\skills\codex-desktop-restart`. On an explicit instruction such as `Codexを再起動して`, a Work/Codex session with local ZBook execution submits `Start-ScheduledTask -TaskName 'Codex Desktop Restart'`. There is no new network listener or cloud-only Work bridge.

The **Codex Desktop Restart** task has no automatic triggers. It shares the exclusive lock, validates installed activation capability, waits five seconds for dispatch acknowledgement, requests a graceful close, waits up to ten seconds, and if necessary terminates only the same verified desktop parent after rechecking PID/creation time/path/session. It never targets all `ChatGPT.exe`/`codex.exe` processes. It then requests activation once and observes a replacement process for up to twenty checks. A replacement opened manually during shutdown is preserved without a duplicate launch. Multiple parents or unknown identity fail closed. The pause preference remains unchanged. The task runs independently of the requesting Codex process with a 120-second scheduler limit and 100-second launcher limit.

`restart-status.json` contains a per-run request ID and durable result, separate from minute-monitor status. Only a changed request ID with a fresh `restarted` result proves a completed request; scheduler acceptance means requested, not completed. Do not dispatch another request while Restart is Running. Save needed handoff before dispatch because the Work/Codex connection may disconnect.

## Verification (2026-09-18)

- `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/codex-recovery.tests.ps1`: 20 assertions PASS, covering missing/healthy/paused states, three-attempt persistence, five-minute identity-bound reset, child/CLI/session filtering, real runner state/log writes and simulated activation dispatch.
- Real Windows Scheduler after relocation: `LastTaskResult=0`, `State=Ready`, `RunLevel=Limited`, `LogonType=Interactive`, repetition `PT1M`, working directory `C:\Users\qq113\CodexRecovery`.
- Autonomous minute checks logged `healthy` at 10:12:52Z and 10:13:52Z, detecting one desktop parent and zero attempts.
- Real Pause -> paused check -> Resume -> scheduled healthy check PASS at 10:14:12Z–10:14:14Z. Monitoring was left enabled.
- Read-only code review found no substantive problem for this installation; installed executable is under `C:\Program Files\WindowsApps`.

### Silent/restart follow-up verification

- Four Windows PowerShell test scripts PASS: existing 20 recovery assertions, 11 restart transitions (graceful/forced/bounded/failed/ambiguous/concurrent-manual replacement), real runner with OS adapters stubbed (pause preference, fresh success/error status, PID reuse rejection), native launcher behavior.
- Native launcher test verifies PE subsystem Windows GUI, actual child `GetConsoleWindow() == 0`, stdout/stderr capture, child exit-code propagation and invalid-action rejection. A sandboxed repeat was denied by application control; the approved ordinary-user test passed without modifying security policy.
- Installed GUI launcher now backs both task actions. At 2026-09-18 21:13:40 JST the monitoring task returned 0 and recorded healthy desktop parent count 1. The Restart task is Ready, has zero triggers, and has not been run against the live app (267011 means not yet run).
- Skill forward tests distinguish explicit restart, setup-only requests, and cloud-only Work lacking local PC execution. The bundled Python validator could not run because PyYAML is absent; frontmatter/name/UI metadata were checked separately and behavior was independently reviewed.

## Evidence limits

The active Codex session was not terminated. Actual live close/relaunch, crash/relaunch, reboot/logon and interrupted-work resumption were not physically tested. Activation dispatch and desktop lifecycle adapters were simulated in restart integration tests. The watcher detects process exit; it does not prove UI responsiveness. Explicit restart can stop a hung parent, but this was not tested against the live app. Sleep/logoff suspends interactive checks; subsequent logon/resume allows checks again. Intentional exit also reopens the app unless paused first. The desktop path matcher currently targets this machine's C-drive WindowsApps installation, not arbitrary package volumes. Retry limits stop relaunches, not the lightweight scheduled status checks.
