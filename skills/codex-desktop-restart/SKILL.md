---
name: codex-desktop-restart
description: Restart the currently open Codex desktop on the connected ZBook when the owner explicitly asks Work or Codex to restart it, or inspect and pause its silent recovery watcher. Requires local Windows execution on that ZBook; does not connect cloud-only Work to a PC.
---

# Codex desktop restart

This ZBook has an independent Windows task named `Codex Desktop Restart`. It closes and relaunches the packaged Codex desktop in the signed-in session. The desktop may appear as `ChatGPT.exe`; `codex.exe` is an internal backend and must not be used as the restart target.

Use restart only for an explicit owner instruction such as `Codexを再起動して`. A request to install/configure restart, inspect status, or stop a task is not a request to restart now. The explicit restart instruction authorizes that single app restart; ordinary tool/OS approvals still apply. Keep automatic skill discovery enabled.

For restart, first confirm local Windows execution is connected to host `HAJI` and the existing task description begins `Issue #869:`. If the restart task is already Running, report that a restart is already in progress instead of submitting another one. If local execution is unavailable, report that limitation; this skill does not provide a network ingress or cloud-to-PC bridge.

Save any handoff already needed for the current work. Tell the user that the Codex connection may briefly disconnect, then submit exactly once:

```powershell
Start-ScheduledTask -TaskName 'Codex Desktop Restart'
```

Do not stop Codex inline or launch `codex-recovery.ps1 -Action Restart` inside the current agent process tree. The scheduler must own the restart so closing Codex does not cancel its relaunch. The task provides a short dispatch delay, graceful close, bounded force-stop of the same verified desktop parent if needed, and replacement-process verification. It preserves the watcher's pause preference and never resubmits AI tasks.

Record the prior `requestId` (if any) and dispatch time before submitting. Report `restart requested` after successful dispatch. Only report completion when a **fresh** `%USERPROFILE%\CodexRecovery\restart-status.json` has a changed `requestId`, `result: restarted`, and a `checkedAt` after this request. `status.json` is the general watchdog status and may be overwritten by later minute checks. Do not use a previous successful restart as evidence for a new request. If the session disconnects, read the persisted restart status after reconnection; do not automatically resubmit the request.

For inspection use `Get-ScheduledTaskInfo -TaskName 'Codex Desktop Restart'` and the two status files. A busy/failed/timeout run is not success. For owner-requested pause/resume use `%USERPROFILE%\CodexRecovery\codex-recovery.ps1 -Action Pause` or `-Action Resume`; Resume resets the retry budget. The normal monitoring task is `Codex Desktop Recovery`; it uses a GUI launcher and does not create a command window. This is desktop restart only, not Windows reboot or guaranteed continuation of interrupted work.
