import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";

test("ordinary ai09 key enrollment filesystem fixtures preserve state and refuse drift (not native activation)", { timeout: 60000 }, t => {
  const python = process.env.GORIQ_LOCAL_TDD_PYTHON ?? (process.platform === "win32" ? null : "python3");
  if (!python) return t.skip("explicit fixture Python required on Windows");
  const result = spawnSync(python, ["-I", "-B", "tests/ai09-owner-key-enroll.test.py"], {
    encoding: "utf8", timeout: 55000, maxBuffer: 1048576,
    env: { ...process.env, PYTHON_MANAGER_AUTOMATIC_INSTALL: "false", PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
});
