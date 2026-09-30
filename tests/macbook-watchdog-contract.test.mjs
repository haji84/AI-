import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const watchdogPath = "scripts/gai-macbook-watchdog.sh";
const installerPath = "scripts/install-macbook-persistence.sh";
const supervisorPath = "scripts/gai-macbook-runner-supervisor.sh";

test("Mac watchdog and installer remain valid bash", () => {
  for (const path of [watchdogPath, installerPath, supervisorPath]) {
    const result = spawnSync("/bin/bash", ["-n", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  }
});

test("Mac watchdog protects active jobs and requires repeated idle failures", () => {
  const watchdog = readFileSync(watchdogPath, "utf8");

  assert.match(watchdog, /RUNNER_FAILURE_THRESHOLD="\$\{GAI_RUNNER_FAILURE_THRESHOLD:-2\}"/);
  assert.match(watchdog, /Runner\.Worker is active; refusing to recycle/);
  assert.match(watchdog, /runnerProtectedByActiveJob/);
  assert.match(watchdog, /active-job-or-established-tcp-or-recent-diag/);
  assert.match(watchdog, /Deferring recycle until the failure threshold is reached/);
  assert.match(watchdog, /Watchdog invocation skipped because another watchdog instance is still active/);
  assert.match(watchdog, /\/opt\/homebrew\/bin\/ollama/);
  assert.match(watchdog, /\/usr\/local\/bin\/ollama/);
  assert.match(watchdog, /resolve_ollama_exe/);
});

test("Mac installer waits for launchd watchdog instead of launching a second copy", () => {
  const installer = readFileSync(installerPath, "utf8");

  assert.match(installer, /launchctl kickstart -k "gui\/\$\(id -u\)\/com\.gai\.worker-watchdog"/);
  assert.match(installer, /Mac watchdog did not publish fresh status after launchd restart/);
  assert.doesNotMatch(installer, /\/bin\/bash "\$PERSISTED_WATCHDOG"/);
  assert.match(installer, /\/opt\/homebrew\/bin:\/usr\/local\/bin/);
});

test("Mac persistence has a runner-independent KeepAlive supervisor", () => {
  const installer = readFileSync(installerPath, "utf8");
  const supervisor = readFileSync(supervisorPath, "utf8");

  assert.match(installer, /com\.gai\.runner-supervisor/);
  assert.match(installer, /<key>KeepAlive<\/key>/);
  assert.match(installer, /GAI_SUPERVISOR_INTERVAL_SECONDS/);
  assert.match(supervisor, /while true/);
  assert.match(supervisor, /GAI_RUNNER_FAILURE_THRESHOLD=2/);
  assert.match(supervisor, /sleep "\$INTERVAL"/);
});

test("Mac persistence self-update uses a bounded maintenance hold", () => {
  const watchdog = readFileSync(watchdogPath, "utf8");
  const installer = readFileSync(installerPath, "utf8");

  assert.match(installer, /MAINTENANCE_HOLD_FILE=.*macbook-maintenance-hold\.epoch/);
  assert.match(installer, /GAI_MAINTENANCE_HOLD_SECONDS:-180/);
  assert.match(installer, /MAINTENANCE_HOLD_SECONDS < 30 \|\| MAINTENANCE_HOLD_SECONDS > 900/);
  assert.match(installer, /maintenance_hold_until=.*date \+%s/);
  assert.match(watchdog, /maintenance_hold_active=true/);
  assert.match(watchdog, /skipping runner recycle/);
  assert.match(watchdog, /maintenanceHoldActive/);
  assert.match(watchdog, /maintenanceHoldUntil/);
  assert.match(watchdog, /rm -f "\$MAINTENANCE_HOLD_FILE"/);
});

test("Mac watchdog limits stale diagnostic fallback for disconnected idle listeners", () => {
  const watchdog = readFileSync(watchdogPath, "utf8");
  assert.match(watchdog, /RUNNER_DIAG_GRACE_SECONDS="\$\{GAI_RUNNER_DIAG_GRACE_SECONDS:-120\}"/);
  assert.match(watchdog, /now - newest_mtime < RUNNER_DIAG_GRACE_SECONDS/);
  assert.doesNotMatch(watchdog, /now - newest_mtime < 600/);
});


test("Mac watchdog preserves one Listener during bounded broker session conflict", () => {
  const watchdog = readFileSync(watchdogPath, "utf8");
  assert.match(watchdog, /GAI_RUNNER_SESSION_CONFLICT_GRACE_SECONDS:-600/);
  assert.match(watchdog, /runner_log_has_active_session_conflict/);
  assert.match(watchdog, /TaskAgentSessionConflictException/);
  assert.match(watchdog, /runner_session_conflict_grace_active/);
  assert.match(watchdog, /deferring recycle for up to/);
  assert.match(watchdog, /runnerSessionConflictGrace/);
  assert.match(watchdog, /session-conflict-grace/);
});


test("Mac persistence does not restart launchd while a Runner.Worker is active", () => {
  const installer = readFileSync(installerPath, "utf8");
  assert.match(installer, /active_runner_worker=false/);
  assert.match(installer, /pgrep -f 'Runner\.Worker'/);
  assert.match(installer, /if \[\[ "\$active_runner_worker" != true \]\]; then/);
  assert.match(installer, /updated watchdog files without restarting launchd/);
  assert.match(installer, /updated supervisor files without restarting launchd/);
  assert.match(installer, /launchdReconcileDeferred/);
  assert.match(installer, /activeRunnerWorkerDuringInstall/);
});
