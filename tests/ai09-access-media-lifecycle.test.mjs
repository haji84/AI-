import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";

test("AI09 media prepare and collect lifecycle refuses unsafe transitions using fake native modules", { timeout: 60000 }, () => {
  const executable = process.platform === "win32" ? join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe") : "pwsh";
  const env = { ...process.env };
  delete env.PSModulePath;
  const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", resolve("tests/ai09-access-media-lifecycle.test.ps1")], {
    encoding: "utf8", windowsHide: true, timeout: 55000, maxBuffer: 262144, env,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /AI09_MEDIA_LIFECYCLE_FIXTURES_PASS.*SOURCE_ONLY/);
});
