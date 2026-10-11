import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assessAutonomyLock } from "../src/orchestrator/autonomy-lock-assessment.ts";

test("live owner remains protected", () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-owner-live-"));
  try {
    mkdirSync(join(dir, "lock"));
    writeFileSync(join(dir, "lock", "owner.json"), JSON.stringify({ host: hostname(), pid: process.pid, startedAt: new Date().toISOString() }));
    assert.equal(assessAutonomyLock(join(dir, "lock")), "active_or_reused_pid");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("foreign owner cannot be reclaimed locally", () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-owner-foreign-"));
  try {
    mkdirSync(join(dir, "lock"));
    writeFileSync(join(dir, "lock", "owner.json"), JSON.stringify({ host: hostname() + "-other", pid: 1, startedAt: new Date().toISOString() }));
    assert.equal(assessAutonomyLock(join(dir, "lock")), "foreign_host");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing or corrupt metadata cannot authorize reclaim", () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-owner-corrupt-"));
  try {
    mkdirSync(join(dir, "lock"));
    assert.equal(assessAutonomyLock(join(dir, "lock")), "unknown");
    writeFileSync(join(dir, "lock", "owner.json"), "broken");
    assert.equal(assessAutonomyLock(join(dir, "lock")), "unknown");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
