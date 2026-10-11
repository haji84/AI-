import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.match(result.stderr, /autonomy already locked/);
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

test("owner metadata is written before Compass initialization and removed on failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-owner-metadata-"));
  try {
    const dbPath = join(dir, "compass.db");
    const lockPath = dbPath + ".autonomy-lock";
    // An invalid database forces startup to fail after the lock is acquired.
    const result = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--resume-only"], {
      env: { ...process.env, COMPASS_DB_PATH: dbPath },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(lockPath), false);
    assert.doesNotMatch(result.stderr, /autonomy already locked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SIGKILL leaves the owner lock for reconciliation and blocks another runner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-sigkill-lock-"));
  const dbPath = join(dir, "compass.db");
  const lockPath = dbPath + ".autonomy-lock";
  const holder = spawn(process.execPath, ["-e", `
    const fs = require("node:fs");
    fs.mkdirSync(process.argv[1]);
    fs.writeFileSync(process.argv[1] + "/owner.json", JSON.stringify({
      host: require("node:os").hostname(), pid: process.pid, startedAt: new Date().toISOString()
    }));
    process.stdout.write("READY\\n");
    setTimeout(() => {}, 30000);
  `, lockPath], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("holder timeout")), 5000);
      holder.stdout.once("data", data => {
        clearTimeout(timeout);
        if (String(data).includes("READY")) resolveReady();
        else reject(new Error("holder not ready"));
      });
      holder.once("error", reject);
    });
    holder.kill("SIGKILL");
    await new Promise<void>(resolveExit => holder.once("exit", () => resolveExit()));
    assert.equal(existsSync(lockPath), true);
    const retry = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--resume-only"], {
      env: { ...process.env, COMPASS_DB_PATH: dbPath }, encoding: "utf8", timeout: 10000,
    });
    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /autonomy already locked/);
  } finally {
    holder.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a foreign-owned lock is never removed or overwritten by a competing invocation", () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-foreign-lock-"));
  try {
    const dbPath = join(dir, "compass.db");
    const lockPath = dbPath + ".autonomy-lock";
    mkdirSync(lockPath);
    const ownerPath = join(lockPath, "owner.json");
    const owner = JSON.stringify({
      host: "another-trusted-node", pid: 12345, startedAt: "2026-10-11T00:00:00.000Z",
      runId: "existing-owner-token",
    });
    writeFileSync(ownerPath, owner);
    const result = spawnSync(process.execPath, [resolve("scripts/autonomy-run.ts"), "--resume-only"], {
      env: { ...process.env, COMPASS_DB_PATH: dbPath },
      encoding: "utf8", timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /autonomy already locked/);
    assert.equal(readFileSync(ownerPath, "utf8"), owner);
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
