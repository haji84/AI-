import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolve } from "node:path";

test("data-only baseline recovery acceptance and refusal tests", () => {
  const executable = process.platform === "win32" ? "python" : "python3";
  const result = spawnSync(executable, ["-B", "-m", "unittest", "-v", "test_baseline_bundle.py"], {
    cwd: resolve(import.meta.dirname, "../tools/baseline_recovery"),
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
