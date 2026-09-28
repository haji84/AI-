import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { scanZBookFleetDatabases } from "../scripts/goriq-zbook-fleet-sqlite-liveness.mjs";

function makeDb(path: string, input: { fleetCount: number; identityCount: number; lastSeenAt: string; updatedAt: string }) {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE jarvis_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT);");
    db.exec("CREATE TABLE jarvis_worker_identity (node_id TEXT PRIMARY KEY);");
    const fleet = Array.from({ length: input.fleetCount }, (_, index) => ({
      id: `node-${index}`,
      kind: "android",
      lastSeenAt: index === 0 ? input.lastSeenAt : "2020-01-01T00:00:00.000Z",
    }));
    db.prepare("INSERT INTO jarvis_state (id,payload,updated_at) VALUES (1,?,?,?)".replace("?,?,?","?,?")).run(JSON.stringify({ fleet }), input.updatedAt);
    const insert = db.prepare("INSERT INTO jarvis_worker_identity (node_id) VALUES (?)");
    for (let i = 0; i < input.identityCount; i++) insert.run(`node-${i}`);
  } finally {
    db.close();
  }
}

test("ZBook SQLite liveness finds preserved 38/38 fleet without exposing paths or identifiers", () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-zbook-scan-"));
  try {
    const dbPath = join(root, "production", "state", "jarvis.db");
    makeDb(dbPath, {
      fleetCount: 38,
      identityCount: 38,
      lastSeenAt: "2026-09-28T03:00:30.000Z",
      updatedAt: "2026-09-28T03:00:31.000Z",
    });
    const result = scanZBookFleetDatabases(root, {
      nowMs: Date.parse("2026-09-28T03:01:00.000Z"),
      freshnessMs: 60_000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.fleetCount, 38);
    assert.equal(result.workerIdentityCount, 38);
    assert.equal(result.androidRegistered, 38);
    assert.equal(result.androidFresh, 1);
    assert.equal(result.newestAndroidHeartbeatAgeMs, 30_000);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(dbPath), false);
    assert.equal(serialized.includes("node-0"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ZBook SQLite liveness ignores unrelated databases and fails closed when preserved fleet is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "goriq-zbook-scan-empty-"));
  try {
    makeDb(join(root, "other.db"), {
      fleetCount: 1,
      identityCount: 1,
      lastSeenAt: "2026-09-28T03:00:59.000Z",
      updatedAt: "2026-09-28T03:00:59.000Z",
    });
    const result = scanZBookFleetDatabases(root, {
      nowMs: Date.parse("2026-09-28T03:01:00.000Z"),
      freshnessMs: 60_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "preserved_fleet_db_not_found");
    assert.equal(result.fleetCount, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
