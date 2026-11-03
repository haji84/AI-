import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { inspectBrokerDatabase } from "../scripts/goriq-broker-db-inventory.mjs";

test("inventory counts PC enrollment coverage without exposing identities or modifying DB", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-inventory-"));
  const path = join(dir, "state.db");
  try {
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE jarvis_state(id INTEGER, payload TEXT, updated_at TEXT); CREATE TABLE jarvis_worker_identity(node_id TEXT PRIMARY KEY, payload TEXT);");
    const fleet = [
      { id: "private-mac-marker", kind: "macos" }, { id: "win", kind: "windows" },
      { id: "linux", kind: "linux" }, { id: "wrong", kind: "windows" },
      { id: "broken", kind: "macos" }, { id: "android", kind: "android" },
      { id: "revoked", kind: "linux" }, { id: "curve", kind: "macos" },
    ];
    db.prepare("INSERT INTO jarvis_state VALUES(1, ?, ?)").run(JSON.stringify({ fleet }), "2026-10-01T10:00:00Z");
    const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
    const insert = db.prepare("INSERT INTO jarvis_worker_identity VALUES(?, ?)");
    const identity = nodeId => ({ nodeId, publicKeyPem: key, enrolledAt: "2026-10-01T10:00:00Z" });
    insert.run("private-mac-marker", JSON.stringify(identity("private-mac-marker")));
    insert.run("win", JSON.stringify({ ...identity("win"), publicKeyPem: ec, algorithm: "ecdsa-p256-sha256" }));
    insert.run("wrong", JSON.stringify(identity("other-node")));
    insert.run("broken", "malformed private payload");
    insert.run("revoked", JSON.stringify({ ...identity("revoked"), revokedAt: "2026-10-01T10:01:00Z" }));
    insert.run("curve", JSON.stringify({ ...identity("curve"), publicKeyPem: ec, algorithm: "ed25519" }));
    db.close();
    const before = readFileSync(path);
    const report = inspectBrokerDatabase("fixture", path);
    assert.deepEqual(report.fleetKinds, { android: 1, ios: 0, windows: 2, macos: 3, linux: 2, cloud: 0, unknown: 0 });
    assert.equal(report.registeredPcCount, 7);
    assert.equal(report.pcWithActiveIdentityCount, 2);
    assert.equal(report.pcIdentityCoverage, "available");
    assert.equal(report.error, null);
    const output = JSON.stringify(report);
    for (const privateValue of [path, key, ec, "private-mac-marker", "malformed private payload"]) assert.equal(output.includes(privateValue), false);
    assert.deepEqual(readFileSync(path), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unsupported identity schema is visibly unavailable", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-schema-"));
  try {
    const path = join(dir, "state.db");
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE jarvis_state(id INTEGER, payload TEXT, updated_at TEXT); CREATE TABLE jarvis_worker_identity(id TEXT);");
    db.prepare("INSERT INTO jarvis_state VALUES(1, ?, ?)").run(JSON.stringify({ fleet: [{ id: "mac", kind: "macos" }] }), "2026-10-01T10:00:00Z");
    db.close();
    const report = inspectBrokerDatabase("fixture", path);
    assert.equal(report.registeredPcCount, 1);
    assert.equal(report.pcWithActiveIdentityCount, null);
    assert.equal(report.pcIdentityCoverage, "unavailable");
    assert.equal(report.error, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
