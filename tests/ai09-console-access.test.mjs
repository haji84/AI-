import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";

test("AI09 per-VM console grant uses only fixture-native boundaries", () => {
  const executable = process.platform === "win32" ? join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe") : "pwsh";
  const env = { ...process.env }; delete env.PSModulePath;
  const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", resolve("tests/ai09-console-access.test.ps1")],
    { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 128 * 1024, env });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /AI09_CONSOLE_FIXTURES_PASS/);
});

test("AI09 console paths accept real owned Windows files beneath the OS drive", { skip: process.platform !== "win32" }, () => {
  const executable = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const env = { ...process.env }; delete env.PSModulePath;
  const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", resolve("tests/ai09-console-owner-path.test.ps1")],
    { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 128 * 1024, env });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /AI09_CONSOLE_REAL_OWNER_PATH_PASS/);
});
