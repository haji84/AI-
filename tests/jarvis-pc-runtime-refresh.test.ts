import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import { CompassStore } from "../src/compass/store.ts";
import { inspectPcRuntimeState, preparePcRuntimeConfiguration } from "../src/jarvis/pc-runtime-refresh.ts";
const now = new Date("2026-10-01T12:00:00Z");
const approval = { version: 1 as const, issue: 1662, goalIssue: 1219, approvedAt: "2026-10-01T11:18:17Z", expiresAt: "2026-10-02T11:18:17Z",
  targets: [{ nodeId: "zbook", platform: "windows" as const }], roles: ["Executor" as const] };
test("runtime pointer change preserves all existing credentials and rejects stale or expired scope", () => {
  const current = { version: 1 as const, commit: "a".repeat(40), releaseRoot: "C:\\Users\\fixture\\JARVIS\\releases\\" + "a".repeat(40), environment: { JARVIS_OWNER_TOKEN: "private-fixture", JARVIS_DB_PATH: "old-private-path" } };
  const input = { current, previousRevision: current.commit, revision: "b".repeat(40), releaseRoot: "C:\\Users\\fixture\\JARVIS\\releases\\" + "b".repeat(40), approval, now };
  const next = preparePcRuntimeConfiguration(input);
  assert.deepEqual(next.environment, current.environment);
  assert.equal(current.commit, "a".repeat(40));
  assert.equal(next.commit, "b".repeat(40));
  assert.throws(() => preparePcRuntimeConfiguration({ ...input, previousRevision: "c".repeat(40) }), /REJECTED/);
  assert.throws(() => preparePcRuntimeConfiguration({ ...input, releaseRoot: "C:\\Users\\fixture\\AppData\\release" }), /REJECTED/);
  assert.throws(() => preparePcRuntimeConfiguration({ ...input, now: new Date("2026-10-02T11:18:17Z") }), /APPROVAL/);
});
test("strict read-only runtime inspection rejects missing production schema and never creates it", () => {
  const root = mkdtempSync(join(tmpdir(), "pc-runtime-inspect-"));
  const broker = join(root, "broker.sqlite"), compass = join(root, "compass.sqlite");
  try {
    const old = new DatabaseSync(broker); old.exec("CREATE TABLE jarvis_state(id INTEGER PRIMARY KEY,payload TEXT,updated_at TEXT); CREATE TABLE jarvis_worker_identity(node_id TEXT PRIMARY KEY,payload TEXT,updated_at TEXT)"); old.close();
    assert.throws(() => inspectPcRuntimeState({ brokerPath: broker, compassPath: compass }), /SCHEMA/);
    const check = new DatabaseSync(broker, { readOnly: true });
    assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name='jarvis_worker_nonce'").get(), undefined); check.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("inspection preserves fleet, identity and work records and rejects active execution", () => {
  const root = mkdtempSync(join(tmpdir(), "pc-runtime-state-"));
  const brokerPath = join(root, "broker.sqlite"), compassPath = join(root, "compass.sqlite");
  try {
    const store = new JarvisSqliteStateStore(brokerPath);
    const snapshot = { generatedAt: now.toISOString(), fleet: [], tasks: [], activeTakeovers: [], audit: [], stats: { registered: 0, ready: 0, offline: 0, needsHuman: 0, queued: 0, running: 0, completed: 0, failed: 0 } };
    store.save(snapshot); store.close();
    const compass = new CompassStore(compassPath); compass.close();
    const before = inspectPcRuntimeState({ brokerPath, compassPath, expectedAndroidCount: 0 });
    assert.equal(before.metadata.androidCount, 0);
    assert.equal(before.metadata.schemaCompatible, true);
    const reopened = new JarvisSqliteStateStore(brokerPath); assert.deepEqual(reopened.load(), snapshot);
    const running = structuredClone(snapshot); Object.assign(running, { tasks: [{ id: "active", status: "running" }] }); reopened.save(running); reopened.close();
    assert.throws(() => inspectPcRuntimeState({ brokerPath, compassPath, expectedAndroidCount: 0 }), /QUIESCENCE/);
    const queued = new JarvisSqliteStateStore(brokerPath);
    Object.assign(running, { tasks: [{ id: "pending", status: "queued" }] }); queued.save(running); queued.close();
    assert.throws(() => inspectPcRuntimeState({ brokerPath, compassPath, expectedAndroidCount: 0 }), /QUIESCENCE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
