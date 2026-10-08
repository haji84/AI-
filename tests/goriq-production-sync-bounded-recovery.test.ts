import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("production runtime recovery escalates distinct strategies until convergence or real Human Gate", async () => {
  const source = await readFile(new URL("../.github/workflows/goriq-jarvis-production-sync.yml", import.meta.url), "utf8");
  assert.equal(source.includes("for strategy in restart canonical-reinstall retire-legacy-owner zero-touch stale-process-reset"), true);
  assert.equal(source.includes("RUNTIME_RECOVERY completed strategy="), true);
  assert.equal(source.includes("RUNTIME_RECOVERY strategy_failed="), true);
  assert.equal(source.includes("exhausted_safe_strategies HUMAN_GATE_REQUIRED"), true);
  assert.equal(source.includes("runtimeRevision===process.argv[2]"), true);
  assert.equal(source.includes("retiring legacy broker owner"), true);
  assert.equal(source.includes("pkill -f 'scripts/jarvis-broker.ts'"), true);
  assert.equal(source.includes("second_kickstart_failed"), false);
});


test("production tunnel recovery emits bounded non-secret diagnostics before failing", async () => {
  const source = await readFile(new URL("../.github/workflows/goriq-jarvis-production-sync.yml", import.meta.url), "utf8");
  assert.equal(source.includes("TUNNEL_RECOVERY_DIAGNOSTICS"), true);
  assert.equal(source.includes('com.aicompany.jarvis-broker-tunnel'), true);
  assert.equal(source.includes('broker-tunnel.log'), true);
  assert.equal(source.includes('broker-tunnel-service.err.log'), true);
  assert.equal(source.includes('zero-touch-launch.err.log'), true);
});
