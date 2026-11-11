import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { pathToFileURL } from "node:url";

// A bounded source-startup observation, not a benchmark acceptance gate.
// No tests, test outcomes, owner state or verifier receipts are cached.
test("G0 observes repeated real source imports with and without a fresh compile cache", { timeout: 45000 }, () => {
  const paths = [
    "src/compass/store.ts",
    "src/orchestrator/compass-goal-controller.ts",
    "src/orchestrator/resident-development-goal-host.ts",
    "src/orchestrator/tracked-repair-resident-runtime.ts",
  ];
  const sources = paths.map(path => ({ path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  const code = `await Promise.all(${JSON.stringify(paths.map(path => pathToFileURL(resolve(path)).href))}.map(path => import(path))); console.log("GORIQ_IMPORT_PROBE_OK");`;
  const cache = mkdtempSync(join(tmpdir(), "goriq-startup-probe-"));
  const observations = [];
  try {
    for (const mode of ["disabled", "fresh", "disabled", "warm", "disabled", "warm"]) {
      const env = { ...process.env, NODE_COMPILE_CACHE: cache };
      if (mode === "disabled") env.NODE_DISABLE_COMPILE_CACHE = "1";
      else delete env.NODE_DISABLE_COMPILE_CACHE;
      const started = performance.now();
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
        env, encoding: "utf8", timeout: 6000, maxBuffer: 65536, windowsHide: true,
      });
      const elapsedMs = performance.now() - started;
      observations.push({ mode, elapsedMs, status: child.status, signal: child.signal,
        errorCode: child.error?.code ?? null });
      assert.equal(child.error, undefined, "bounded source import must finish without an infrastructure error");
      assert.equal(child.status, 0, "source import must exit successfully");
      assert.equal(child.stdout.trim(), "GORIQ_IMPORT_PROBE_OK");
    }
    console.log(`GORIQ_COMPILE_STARTUP_PROBE ${JSON.stringify({
      version: 1, evidenceKind: "SOURCE_STARTUP_OBSERVATION_ONLY", acceptanceGranted: false,
      node: process.version, platform: process.platform, arch: process.arch,
      testResultsCached: false, sources, observations,
    })}`);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});
