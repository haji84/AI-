import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/goriq-chatgpt-bridge-health-check.mjs", import.meta.url);

function runHealth(health, minimumUpdatedAt) {
  const root = mkdtempSync(join(tmpdir(), "goriq-bridge-health-"));
  const path = join(root, "health.json");
  try {
    writeFileSync(path, JSON.stringify(health), "utf8");
    return spawnSync(process.execPath, [script.pathname, path, String(minimumUpdatedAt)], {
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("fresh idle bridge is accepted", () => {
  const minimum = Date.parse("2026-09-28T17:00:00Z");
  const result = runHealth({
    status: "idle",
    pid: 1234,
    updatedAt: "2026-09-28T17:00:05Z",
  }, minimum);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"status": "idle"/);
});

test("stale or stopping bridge is rejected", () => {
  const minimum = Date.parse("2026-09-28T17:00:00Z");
  assert.notEqual(runHealth({
    status: "idle",
    pid: 1234,
    updatedAt: "2026-09-28T16:59:59Z",
  }, minimum).status, 0);
  assert.notEqual(runHealth({
    status: "stopping",
    pid: 1234,
    updatedAt: "2026-09-28T17:00:05Z",
  }, minimum).status, 0);
});

test("login-required bridge is not repair-ready", () => {
  const minimum = Date.parse("2026-09-28T17:00:00Z");
  const result = runHealth({
    status: "waiting_for_chatgpt_login",
    pid: 1234,
    updatedAt: "2026-09-28T17:00:05Z",
  }, minimum);
  assert.notEqual(result.status, 0);
});
