import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("a concurrent autonomy invocation fails closed before opening Compass", () => {
  const dir = mkdtempSync(join(tmpdir(), "gor iq-autonomy-lock-".replace(" ", "")));
  try {
    const dbPath = join(dir, "compass.db");
    const lockPath = dbPath + ".autonomy-lock";
    mkdirSync(lockPath);
    const result = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--resume-only"], {
      env: { ...process.env, COMPASS_DB_PATH: dbPath },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /autonomy already locked; reconcile previous run before retry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an orphaned lock fails closed instead of silently stealing ownership", () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-orphan-lock-"));
  try {
    const dbPath = join(dir, "compass.db");
    mkdirSync(dbPath + ".autonomy-lock");
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--resume-only"], {
        env: { ...process.env, COMPASS_DB_PATH: dbPath },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /autonomy already locked/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
