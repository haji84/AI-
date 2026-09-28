import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { inspectBrokerDatabase } from "../scripts/goriq-broker-db-inventory.mjs";

test("broker DB inventory reports counts without exposing fleet identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-db-inventory-"));
  const dbPath = join(root, "jarvis.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE jarvis_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE jarvis_worker_identity (node_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const snapshot = {
    generatedAt: "2026-09-28T00:00:00.000Z",
    fleet: [
      {id:"secret-node-a",kind:"android"},
      {id:"secret-node-b",kind:"android"}
    ],
    tasks: []
  };
  db.prepare("INSERT INTO jarvis_state(id,payload,updated_at) VALUES(1,?,?)").run(JSON.stringify(snapshot), snapshot.generatedAt);
  db.prepare("INSERT INTO jarvis_worker_identity(node_id,payload,updated_at) VALUES(?,?,?)")
    .run("secret-node-a", JSON.stringify({nodeId:"secret-node-a"}), snapshot.generatedAt);
  db.prepare("INSERT INTO jarvis_worker_identity(node_id,payload,updated_at) VALUES(?,?,?)")
    .run("secret-node-b", JSON.stringify({nodeId:"secret-node-b"}), snapshot.generatedAt);
  db.close();

  const result = inspectBrokerDatabase("fixture", dbPath);
  assert.equal(result.exists, true);
  assert.equal(result.fleetCount, 2);
  assert.equal(result.workerIdentityCount, 2);
  assert.equal(result.snapshotUpdatedAt, snapshot.generatedAt);
  assert.match(result.sha256 ?? "", /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-node-a"), false);
  assert.equal(serialized.includes(dbPath), false);
});

test("broker DB inventory reports a missing candidate without leaking its path", () => {
  const secretPath = "/tmp/private-user-name/does-not-exist.db";
  const result = inspectBrokerDatabase("missing-fixture", secretPath);
  assert.deepEqual(result, {
    label:"missing-fixture",
    exists:false,
    bytes:0,
    fleetCount:null,
    workerIdentityCount:null,
    snapshotUpdatedAt:null,
    sha256:null,
    error:null,
  });
  assert.equal(JSON.stringify(result).includes("private-user-name"), false);
});
