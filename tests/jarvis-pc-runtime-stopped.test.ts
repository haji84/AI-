import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
test("native refresh supports stopped offline baseline without false full-service acceptance", () => {
  const executable = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-File",
    join(process.cwd(), "tests/jarvis-pc-runtime-stopped.test.ps1")], {encoding:"utf8",timeout:30_000});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /Stopped baseline and degraded activation fixtures PASS/);
});
