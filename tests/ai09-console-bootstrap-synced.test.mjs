import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const env = Object.fromEntries(Object.entries(process.env).filter(
  ([name]) => process.platform !== "win32" || name.toLowerCase() !== "psmodulepath",
));
const available = spawnSync(powershell, ["-NoProfile", "-Command", "exit 0"], {
  env, timeout: 15000,
}).status === 0;

test("AI-09 startup rendezvous and observation refusal fixtures", {
  skip: !available && process.platform !== "win32",
}, () => {
  const result = spawnSync(powershell, [
    "-NoProfile", "-NonInteractive", "-File",
    path.join(root, "tests/ai09-console-bootstrap-synced.test.ps1"),
    "-HelperPath", path.join(root, "scripts/ai09-console-bootstrap-synced.ps1"),
  ], { env, encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = result.stdout.match(/SYNC_FIXTURE_PASS=(\d+); PARSE_ERRORS=0/);
  assert.ok(summary && Number(summary[1]) >= 24, "All refusal fixtures must run");
  assert.match(result.stdout, /REAL_VM_INPUTS=0/);
});
