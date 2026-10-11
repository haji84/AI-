import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("a concurrent autonomy invocation fails closed before opening Compass", () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-autonomy-lock-"));
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

test("lock release after a failed invocation permits a later attempt", () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-release-lock-"));
  try {
    const dbPath = join(dir, "compass.db");
    const lockPath = dbPath + ".autonomy-lock";
    const run = () => spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--resume-only"], {
      env: { ...process.env, COMPASS_DB_PATH: dbPath },
      encoding: "utf8",
      timeout: 10000,
    });
    const first = run();
    assert.notEqual(first.status, 0); // No Goal has been configured.
    assert.equal(existsSync(lockPath), false);
    const second = run();
    assert.notEqual(second.status, 0);
    assert.doesNotMatch(second.stderr, /autonomy already locked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("simultaneous processes cannot both acquire the same lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-parallel-lock-"));
  const lockPath = join(dir, "compass.db.autonomy-lock");
  const holder = spawn(process.execPath, ["-e", `
    const fs = require("node:fs");
    fs.mkdirSync(process.argv[1]);
    process.stdout.write("LOCKED\\n");
    setTimeout(() => {}, 30000);
  `, lockPath], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error("holder never acquired lock")), 5000);
      holder.stdout.once("data", data => {
        clearTimeout(timer);
        if (String(data).includes("LOCKED")) resolveReady();
        else reject(new Error("unexpected holder output"));
      });
      holder.once("error", reject);
      holder.once("exit", () => reject(new Error("holder exited before ready")));
    });
    const attempt = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--resume-only"], {
      env: { ...process.env, COMPASS_DB_PATH: join(dir, "compass.db") },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(attempt.status, 0);
    assert.match(attempt.stderr, /autonomy already locked/);
    assert.equal(existsSync(lockPath), true);
  } finally {
    holder.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
