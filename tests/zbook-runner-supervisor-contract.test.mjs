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
});
