import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/goriq-windows-bootstrap.ps1");

test("Windows bootstrap keeps gh optional and does not install it", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /Get-Command -Name 'gh'/);
  assert.match(source, /not required for this bootstrap/i);
  assert.doesNotMatch(source, /winget\s+install/i);
  assert.doesNotMatch(source, /gh\s+auth\s+login/i);
});

test("Windows bootstrap parses and can diagnose a repo hint on Windows", async (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell parser/runtime verification requires Windows.");
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "goriq-bootstrap-"));
  try {
    await mkdir(path.join(tempRoot, "scripts"), { recursive: true });
    await writeFile(path.join(tempRoot, "AGENTS.md"), "# test\n");
    await writeFile(path.join(tempRoot, "PROJECT_STATE.md"), "# test\n");
    await writeFile(
      path.join(tempRoot, "scripts", "configure-groq-free-secret-windows.ps1"),
      "Write-Host 'stub'\n",
    );

    const shell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";

    const parseCommand = [
      "$tokens = $null",
      "$errors = $null",
      "[System.Management.Automation.Language.Parser]::ParseFile($env:GORIQ_TEST_SCRIPT, [ref]$tokens, [ref]$errors) | Out-Null",
      "if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }",
    ].join("; ");

    const parse = spawnSync(
      shell,
      ["-NoProfile", "-NonInteractive", "-Command", parseCommand],
      {
        encoding: "utf8",
        env: { ...process.env, GORIQ_TEST_SCRIPT: scriptPath },
      },
    );
    assert.equal(parse.status, 0, parse.stderr || parse.stdout);

    const run = spawnSync(
      shell,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Task",
        "Diagnose",
        "-RepoHint",
        tempRoot,
      ],
      { encoding: "utf8" },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /Repository:/);
    assert.match(run.stdout, /Diagnosis completed/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
