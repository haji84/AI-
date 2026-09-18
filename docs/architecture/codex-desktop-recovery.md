# Codex desktop recovery on ZBook (#869)

Owner approved implementation and local installation on 2026-09-18. Scope is desktop-process recovery, not AI task resubmission. The watcher is independent of Codex and makes no model/API calls.

## Operation

`Codex Desktop Recovery` runs Windows PowerShell at user logon and every minute, using the existing signed-in user's Interactive token and Limited run level. Checks have a 45-second execution limit, IgnoreNew scheduling and an exclusive file lock. It never stops an existing process or changes other service tasks.

The packaged desktop parent is recognized by its OpenAI.Codex publisher/package path, current session and absence of Electron `--type` child arguments. The internal CLI is excluded. Unknown process metadata fails closed. Windows' stable `OpenAI.Codex_2p2nqsd0c76g0!App` activation identity avoids pinning an installed package version.

Each missing-process recovery consumes a persisted attempt before requesting activation. At most three attempts are allowed until the same desktop process remains present across checks for five minutes, or the owner explicitly resumes. This also bounds quick crash/relaunch loops. A fourth missing check records `blocked` and returns exit 2. Other errors return 1. A launched process is verified on the following scheduled check; activation alone is not reported as recovery success.

## Installation and owner controls

Run Windows PowerShell as the signed-in owner:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/install-codex-recovery.ps1
```

Files/state/logs live in `%USERPROFILE%\CodexRecovery`. Do not install into AppData: the packaged Codex host redirects AppData writes to its MSIX LocalCache, which Task Scheduler cannot see at the original path. This was observed during acceptance and matches the existing #786 native-startup finding.

Double-click `Pause recovery.cmd`, `Resume recovery.cmd`, or `Status recovery.cmd` in that folder. Resume also resets the retry budget. To intentionally quit Codex without it reopening, pause first. Permanent rollback is to disable the **Codex Desktop Recovery** task in Task Scheduler; retain files/logs for diagnosis. No other task needs changing. The repair switch updates only this issue's existing task action to a fresh install folder; it refuses unrelated tasks or file overwrites.

## Verification (2026-09-18)

- `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/codex-recovery.tests.ps1`: 20 assertions PASS, covering missing/healthy/paused states, three-attempt persistence, five-minute identity-bound reset, child/CLI/session filtering, real runner state/log writes and simulated activation dispatch.
- Real Windows Scheduler after relocation: `LastTaskResult=0`, `State=Ready`, `RunLevel=Limited`, `LogonType=Interactive`, repetition `PT1M`, working directory `C:\Users\qq113\CodexRecovery`.
- Autonomous minute checks logged `healthy` at 10:12:52Z and 10:13:52Z, detecting one desktop parent and zero attempts.
- Real Pause -> paused check -> Resume -> scheduled healthy check PASS at 10:14:12Z–10:14:14Z. Monitoring was left enabled.
- Read-only code review found no substantive problem for this installation; installed executable is under `C:\Program Files\WindowsApps`.

## Evidence limits

The active Codex session was not terminated. Actual crash/relaunch, reboot/logon and interrupted-work resumption were not physically tested. Activation dispatch was simulated in integration tests. The watcher detects process exit; it does not prove UI responsiveness or repair a hung-but-present app. Sleep/logoff suspends interactive checks; subsequent logon/resume allows checks again. Intentional exit also reopens the app unless paused first. The desktop path matcher currently targets this machine's C-drive WindowsApps installation, not arbitrary package volumes. Retry limits stop relaunches, not the lightweight scheduled status checks.
