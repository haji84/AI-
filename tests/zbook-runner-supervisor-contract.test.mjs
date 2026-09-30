import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ZBook persistence includes a runner-independent one-minute supervisor", () => {
  const installer = readFileSync("scripts/install-zbook-persistence.ps1", "utf8");
  const watchdog = readFileSync("scripts/gai-zbook-watchdog.ps1", "utf8");

  assert.match(installer, /GAI-ZBook-Runner-Supervisor/);
  assert.match(installer, /\/SC MINUTE \/MO 1/);
  assert.match(installer, /localSupervisorIntervalSeconds = 60/);
  assert.ok(watchdog.includes("$runnerFailureThreshold = if ($env:GAI_RUNNER_FAILURE_THRESHOLD -match '^\\d+$') { [int]$env:GAI_RUNNER_FAILURE_THRESHOLD } else { 2 }"));
  assert.equal((watchdog.match(/function Write-GaiLog/g) ?? []).length, 1);
  assert.equal((watchdog.match(/function Start-GitHubRunner/g) ?? []).length, 1);
  assert.doesNotMatch(watchdog, /^\) \{ \[int\]\$env:GAI_RUNNER_FAILURE_THRESHOLD \} else \{ 2 \}$/m);
  assert.match(watchdog, /GAI_RUNNER_SESSION_CONFLICT_GRACE_MINUTES/);
  assert.match(watchdog, /function Test-RunnerSessionConflictGrace/);
  assert.match(watchdog, /TaskAgentSessionConflictException/);
  assert.match(watchdog, /runnerSessionConflictGrace/);
  assert.match(watchdog, /deferring recycle for up to/);
});


test("ZBook broker conflict cooldown survives Listener exit and outranks TCP health", () => {
  const watchdog = readFileSync("scripts/gai-zbook-watchdog.ps1", "utf8");
  assert.match(watchdog, /zbook-runner-session-conflict\.epoch/);
  assert.match(watchdog, /function Test-LatestRunnerSessionConflict/);
  assert.match(watchdog, /\$since -gt 0 -and \(\$now - \$since\) -lt \(\$runnerSessionConflictGraceMinutes \* 60\)/);

  const connectionStart = watchdog.indexOf("function Test-RunnerConnection");
  const conflictCheck = watchdog.indexOf("Test-LatestRunnerSessionConflict", connectionStart);
  const tcpProbe = watchdog.indexOf("Get-NetTCPConnection", connectionStart);
  assert.ok(connectionStart >= 0 && conflictCheck > connectionStart && tcpProbe > conflictCheck);

  assert.match(watchdog, /Remove-Item -Path \$runnerSessionConflictStatePath -Force -ErrorAction SilentlyContinue/);
});
