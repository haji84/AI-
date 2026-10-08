import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CLI recognizes only paired host outcome configuration and rejects conflicting or incomplete scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-host-config-"));
  const base = { ...process.env, JARVIS_COMPASS_DB_PATH: join(root, "compass.db"), GORIQ_LOCAL_WORK_MANIFEST: "", GORIQ_LOCAL_OUTCOMES: "", GORIQ_LOCAL_DATA_ROOT: "" };
  const run = (env: Record<string,string | undefined>) => spawnSync(process.execPath, ["scripts/goriq-cognitive-run.ts", "status"], { windowsHide: true, encoding: "utf8", env: { ...base, ...env }, timeout: 5000 });
  try {
    const configured = run({ GORIQ_LOCAL_OUTCOMES: join(root, "outcomes.json"), GORIQ_LOCAL_DATA_ROOT: root });
    assert.equal(configured.status, 0, configured.stderr);
    assert.equal(JSON.parse(configured.stdout).localActionsConfigured, true);
    for (const env of [
      { GORIQ_LOCAL_OUTCOMES: "outcomes.json" },
      { GORIQ_LOCAL_DATA_ROOT: root },
      { GORIQ_LOCAL_WORK_MANIFEST: "old.json", GORIQ_LOCAL_OUTCOMES: "outcomes.json", GORIQ_LOCAL_DATA_ROOT: root },
    ]) { const invalid = run(env); assert.notEqual(invalid.status, 0, "invalid host scope must fail closed"); }
    assert.equal(JSON.parse(run({}).stdout).localActionsConfigured, false);
    const legacy = run({ GORIQ_LOCAL_WORK_MANIFEST: "old.json", GORIQ_LOCAL_DATA_ROOT: root });
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.equal(JSON.parse(legacy.stdout).localActionsConfigured, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
