import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const watchdogPath = "scripts/gai-macbook-watchdog.sh";
const installerPath = "scripts/install-macbook-persistence.sh";

test("Mac watchdog and installer remain valid bash", () => {
  for (const path of [watchdogPath, installerPath]) {
    const result = spawnSync("/bin/bash", ["-n", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  }
});

test("Mac watchdog protects active jobs and requires repeated idle failures", () => {
  const watchdog = readFileSync(watchdogPath, "utf8");

  assert.match(watchdog, /RUNNER_FAILURE_THRESHOLD=3/);
  assert.match(watchdog, /Runner\.Worker is active; refusing to recycle/);
  assert.match(watchdog, /runnerProtectedByActiveJob/);
  assert.match(watchdog, /runner_listener_pids/);
  assert.match(watchdog, /run-helper\\\.sh/);
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
