import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";

test("Ubuntu access activation preserves state and refuses unapproved or drifting authority", { timeout: 60000 }, t => {
  const python = process.env.GORIQ_LOCAL_TDD_PYTHON ?? (process.platform === "win32" ? null : "python3");
  if (!python) return t.skip("explicit fixture Python required on Windows");
  const result = spawnSync(python, ["tests/ai09-access-guest.test.py"], {
    encoding: "utf8", timeout: 55000, maxBuffer: 1048576,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
});
