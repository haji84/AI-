import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("production sync self-heals to one canonical Mac runtime owner until convergence", async () => {
  const source = await readFile(new URL("../.github/workflows/goriq-jarvis-production-sync.yml", import.meta.url), "utf8");
  assert.equal(source.includes("com.aicompany.jarvis-runtime"), true);
  assert.equal(source.includes("com.aicompany.jarvis-broker"), true);
  assert.equal(source.includes("for strategy in restart canonical-reinstall retire-legacy-owner zero-touch stale-process-reset"), true);
  assert.equal(source.includes("legacy-runtime-migration.txt"), true);
  assert.equal(source.includes("RUNTIME_RECOVERY completed strategy="), true);
  assert.equal(source.includes("exhausted_safe_strategies HUMAN_GATE_REQUIRED"), true);
  assert.equal(source.includes("jarvis-mac-install-launchagent.sh"), true);
  assert.equal(source.includes("runtimeRevision===process.argv[2]"), true);
});
