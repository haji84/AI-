import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// RFC 8032 public test vectors; no private keys or generated credentials.
const publicKey = (hex) => `-----BEGIN PUBLIC KEY-----\n${Buffer.from("302a300506032b6570032100" + hex, "hex").toString("base64")}\n-----END PUBLIC KEY-----\n`;
const KEY = publicKey("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
const OTHER_KEY = publicKey("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c");
const AT = "2026-11-03T18:00:00.000Z";
const LATER = "2026-11-03T18:01:00.000Z";
const SCHEMA = `
CREATE TABLE jarvis_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
CREATE TABLE jarvis_worker_identity (node_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
CREATE TABLE jarvis_worker_nonce (node_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (node_id, nonce)) STRICT;
CREATE INDEX jarvis_worker_nonce_expires_at ON jarvis_worker_nonce (expires_at);`;
let implementation;
try { implementation = await import("./owner-code-fleet-preservation.mjs"); }
catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
function api() {
  assert.equal(typeof implementation?.captureFleetSnapshot, "function", "fleet preservation implementation is missing");
  return implementation;
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "fleet-public-fixture-"));
  const path = join(root, "public-fleet.db");
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
  db.exec(SCHEMA);
  // Only the fixture writer checkpoints, before seeding. The observer never does.
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const fleet = Array.from({ length: 38 }, (_, index) => ({
    id: `PRIVATE-SENTINEL-node-${index}`, label: `Public fake Android ${index}`, kind: "android", status: "ready",
    capabilities: ["device-status"], policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
    telemetry: { checkedAt: AT, batteryPercent: 90 }, enrollment: "full", fleetNumber: index + 1, group: "public-fixture", lastSeenAt: AT,
  }));
  const state = {
    generatedAt: AT, fleet,
    tasks: [{ id: "PRIVATE-SENTINEL-task", idempotencyKey: "PRIVATE-SENTINEL-command", type: "device-status", payload: { privateSentinel: "PRIVATE-SENTINEL-payload", nested: { preserve: [1, 2] } }, status: "queued", requiredCapabilities: ["device-status"], priority: "normal", requiresOnline: false, targetNodeId: fleet[0].id, attempts: 0, maxAttempts: 3, createdAt: AT, updatedAt: AT }],
    activeTakeovers: [],
    audit: [{ id: "PRIVATE-SENTINEL-audit", at: AT, actor: "owner", action: "task.queued", target: "PRIVATE-SENTINEL-task", detail: { retained: "PRIVATE-SENTINEL-history" } }],
    stats: { registered: 38, ready: 38, offline: 0, needsHuman: 0, queued: 1, running: 0, completed: 0, failed: 0 },
  };
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO jarvis_state VALUES(1,?,?)").run(JSON.stringify(state), AT);
  const identities = fleet.map((node) => ({ nodeId: node.id, publicKeyPem: KEY, enrolledAt: AT, algorithm: "ed25519" }));
  identities.push({ nodeId: "PRIVATE-SENTINEL-revoked", publicKeyPem: KEY, enrolledAt: "2026-10-01T00:00:00.000Z", revokedAt: "2026-10-02T00:00:00.000Z" });
  for (const identity of identities) db.prepare("INSERT INTO jarvis_worker_identity VALUES(?,?,?)").run(identity.nodeId, JSON.stringify(identity), AT);
  db.prepare("INSERT INTO jarvis_worker_nonce VALUES(?,?,?)").run(fleet[0].id, "PRIVATE-SENTINEL-nonce", Date.now() + 3_600_000);
  db.exec("COMMIT");
  const options = {
    schemaProfile: "jarvis-control-plane-sqlite-v1",
    databaseBinding: { path, configSha256: "a".repeat(64), taskSha256: "b".repeat(64), releaseRevision: "c".repeat(40) },
    cohortAuthority: { kind: "approved-active-capture", approvalSha256: "d".repeat(64), expectedCount: 38 },
  };
  return { root, path, db, state, identities, options,
    save() { db.prepare("UPDATE jarvis_state SET payload=?,updated_at=? WHERE id=1").run(JSON.stringify(state), state.generatedAt); },
    identity(index, patch) { Object.assign(identities[index], patch); db.prepare("UPDATE jarvis_worker_identity SET payload=? WHERE node_id=?").run(JSON.stringify(identities[index]), identities[index].nodeId); },
  };
}
function capture(f) { return api().captureFleetSnapshot(f.path, f.options); }
function compare(f, change) {
  const before = capture(f);
  change();
  return api().compareFleetSnapshots(before, capture(f));
}
function fixedError(action, code) {
  assert.throws(action, (error) => error.code === code && error.message === code && !error.cause && !/PRIVATE-SENTINEL|BEGIN PUBLIC KEY|public-fleet\.db/.test(String(error.stack)));
}

test("real WAL fleet snapshot preserves 38 devices, revoked history and opaque private data without checkpointing", (t) => {
  const f = fixture(t);
  const digest = () => createHash("sha256").update(readFileSync(f.path)).digest("hex");
  const mainBefore = digest();
  const walBefore = readFileSync(f.path + "-wal");
  const handle = capture(f);
  const summary = api().fleetSnapshotSummary(handle);
  assert.deepEqual({ fleet: summary.fleetCount, identities: summary.identityCount, revoked: summary.revokedIdentityCount, tasks: summary.taskCount, audit: summary.auditCount }, { fleet: 38, identities: 39, revoked: 1, tasks: 1, audit: 1 });
  assert.equal(Object.isFrozen(handle), true);
  assert.deepEqual(Reflect.ownKeys(handle), []);
  assert.equal(JSON.stringify(handle), "{}");
  assert.equal(digest(), mainBefore);
  assert.deepEqual(readFileSync(f.path + "-wal"), walBefore);
  const result = api().compareFleetSnapshots(handle, capture(f));
  assert.equal(result.status, "PASS");
  assert.equal(result.coverage.wholeR06, false);
  assert.equal(result.coverage.workerPrivateKeys, false);
  assert.equal(result.coverage.pcTaskSidecars, false);
  assert.equal(result.coverage.compassHistory, false);
  assert.doesNotMatch(JSON.stringify({ handle, summary, result }), /PRIVATE-SENTINEL|BEGIN PUBLIC KEY|[a-f0-9]{40}|public-fleet\.db/);
});

test("committed key change only in WAL is detected even when main database bytes are unchanged", (t) => {
  const f = fixture(t);
  const mainBefore = readFileSync(f.path);
  const result = compare(f, () => f.identity(0, { publicKeyPem: OTHER_KEY }));
  assert.deepEqual(readFileSync(f.path), mainBefore);
  assert.equal(result.status, "FAIL");
  assert.equal(result.keysPreserved, false);
});

test("same-count replacement of an original device never passes cohort preservation", (t) => {
  const f = fixture(t);
  const result = compare(f, () => {
    const old = f.state.fleet[0].id;
    const replacement = "PRIVATE-SENTINEL-replacement";
    f.state.fleet[0].id = replacement; f.save();
    const identity = { ...f.identities[0], nodeId: replacement };
    f.db.prepare("DELETE FROM jarvis_worker_identity WHERE node_id=?").run(old);
    f.db.prepare("INSERT INTO jarvis_worker_identity VALUES(?,?,?)").run(replacement, JSON.stringify(identity), AT);
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.baselineCohortPreserved, false);
});

for (const [name, change, field] of [
  ["revoked identity deletion", (f) => f.db.prepare("DELETE FROM jarvis_worker_identity WHERE node_id=?").run(f.identities[38].nodeId), "identitiesPreserved"],
  ["enrollment history edit", (f) => f.identity(0, { enrolledAt: "2026-10-01T00:00:00.000Z" }), "workerLifecycleHistoryPreserved"],
  ["revocation history edit", (f) => f.identity(38, { revokedAt: "2026-10-03T00:00:00.000Z" }), "workerLifecycleHistoryPreserved"],
  ["audit payload edit", (f) => { f.state.audit[0].detail.retained = "changed"; f.save(); }, "auditRetainedHistoryPreserved"],
  ["audit deletion", (f) => { f.state.audit = []; f.save(); }, "auditRetainedHistoryPreserved"],
  ["task deletion", (f) => { f.state.tasks = []; f.state.stats.queued = 0; f.save(); }, "taskPayloadsPreserved"],
  ["nested task payload edit", (f) => { f.state.tasks[0].payload.nested.preserve[0] = 9; f.save(); }, "taskPayloadsPreserved"],
  ["task idempotency change", (f) => { f.state.tasks[0].idempotencyKey = "changed"; f.save(); }, "taskPayloadsPreserved"],
  ["fleet policy authority change", (f) => { f.state.fleet[0].policy.allowRemoteControl = true; f.save(); }, "fleetMetadataPreserved"],
  ["live replay nonce deletion", (f) => f.db.exec("DELETE FROM jarvis_worker_nonce"), "nonceProtectionPreserved"],
]) test(`${name} fails preservation without exposing rows`, (t) => {
  const f = fixture(t);
  const result = compare(f, () => change(f));
  assert.equal(result.status, "FAIL");
  assert.equal(result[field], false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SENTINEL|BEGIN PUBLIC KEY|public-fleet\.db/);
});

test("explicit heartbeat and lease fields may change while payload/history remain preserved", (t) => {
  const f = fixture(t);
  const result = compare(f, () => {
    f.state.generatedAt = LATER;
    Object.assign(f.state.fleet[0], { status: "busy", lastSeenAt: LATER, telemetry: { checkedAt: LATER, batteryPercent: 70 } });
    Object.assign(f.state.tasks[0], { status: "leased", assignedNodeId: f.state.fleet[0].id, leaseUntil: "2026-11-03T18:03:00.000Z", attempts: 1, updatedAt: LATER });
    Object.assign(f.state.stats, { ready: 37, queued: 0, running: 1 });
    f.state.audit.push({ id: "new-public-event", at: LATER, actor: "jarvis", action: "task.leased" });
    f.db.prepare("INSERT INTO jarvis_worker_nonce VALUES(?,?,?)").run(f.state.fleet[1].id, "new-public-nonce", Date.now() + 3_600_000);
    f.save();
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.operationalChanges.fleet, 1);
  assert.equal(result.operationalChanges.tasks, 1);
  assert.equal(result.operationalChanges.auditAppended, 1);
});

test("expired nonce cleanup is allowed and task attempts cannot reset", (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE jarvis_worker_nonce SET expires_at=?").run(Date.now() - 1000);
  assert.equal(compare(f, () => f.db.exec("DELETE FROM jarvis_worker_nonce")).status, "PASS");
  f.state.tasks[0].attempts = 2; f.save();
  assert.equal(compare(f, () => { f.state.tasks[0].attempts = 0; f.save(); }).status, "FAIL");
});

test("rolling 1000-event audit eviction is inconclusive rather than preservation", (t) => {
  const f = fixture(t);
  f.state.audit = Array.from({ length: 1000 }, (_, i) => ({ id: `audit-${i}`, at: AT, actor: "jarvis", action: "fixture" })); f.save();
  const result = compare(f, () => { f.state.audit.shift(); f.state.audit.push({ id: "audit-1000", at: LATER, actor: "jarvis", action: "fixture" }); f.save(); });
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.auditRetainedHistoryPreserved, false);
  assert.ok(result.reasonCodes.includes("FLEET_AUDIT_WINDOW_ROLLED"));
});

test("a read snapshot does not include uncommitted writes and later captures see commits", (t) => {
  const f = fixture(t);
  const before = capture(f);
  f.db.exec("BEGIN IMMEDIATE");
  f.identity(0, { publicKeyPem: OTHER_KEY });
  assert.equal(api().compareFleetSnapshots(before, capture(f)).status, "PASS");
  f.db.exec("COMMIT");
  assert.equal(api().compareFleetSnapshots(before, capture(f)).keysPreserved, false);
});

for (const [name, change, code] of [
  ["unknown table", (f) => f.db.exec("CREATE TABLE surprise(secret TEXT)"), "FLEET_SCHEMA_UNSUPPORTED"],
  ["unknown column", (f) => f.db.exec("ALTER TABLE jarvis_worker_identity ADD COLUMN secret TEXT"), "FLEET_SCHEMA_UNSUPPORTED"],
  ["unknown trigger", (f) => f.db.exec("CREATE TRIGGER surprise AFTER INSERT ON jarvis_worker_identity BEGIN SELECT 1; END"), "FLEET_SCHEMA_UNSUPPORTED"],
  ["unknown version", (f) => f.db.exec("PRAGMA user_version=42"), "FLEET_SCHEMA_UNSUPPORTED"],
  ["malformed JSON", (f) => f.db.prepare("UPDATE jarvis_state SET payload=?").run("PRIVATE-SENTINEL-broken"), "FLEET_PAYLOAD_INVALID"],
  ["duplicate JSON property", (f) => f.db.prepare("UPDATE jarvis_worker_identity SET payload=? WHERE node_id=?").run('{"nodeId":"a","nodeId":"b"}', f.identities[0].nodeId), "FLEET_PAYLOAD_INVALID"],
  ["unknown payload property", (f) => { f.state.unknownSecret = "PRIVATE-SENTINEL-unknown"; f.save(); }, "FLEET_PAYLOAD_INVALID"],
  ["duplicate device ID", (f) => { f.state.fleet[1].id = f.state.fleet[0].id; f.save(); }, "FLEET_PAYLOAD_INVALID"],
  ["invalid identity key", (f) => f.identity(0, { publicKeyPem: "PRIVATE-SENTINEL-invalid-pem" }), "FLEET_PAYLOAD_INVALID"],
  ["missing active identity", (f) => f.db.prepare("DELETE FROM jarvis_worker_identity WHERE node_id=?").run(f.identities[0].nodeId), "FLEET_COHORT_INVALID"],
  ["missing state row", (f) => f.db.exec("DELETE FROM jarvis_state"), "FLEET_PAYLOAD_INVALID"],
]) test(`${name} fails closed with a fixed private error`, (t) => {
  const f = fixture(t); change(f);
  fixedError(() => capture(f), code);
});

test("original cohort authority requires explicit count, receipt, active database binding and known profile", (t) => {
  const f = fixture(t);
  for (const options of [undefined, {}, { ...f.options, schemaProfile: "unknown" }, { ...f.options, cohortAuthority: undefined }, { ...f.options, cohortAuthority: { ...f.options.cohortAuthority, expectedCount: undefined } }, { ...f.options, databaseBinding: { ...f.options.databaseBinding, path: join(f.root, "another.db") } }]) {
    fixedError(() => api().captureFleetSnapshot(f.path, options), "FLEET_OPTIONS_INVALID");
  }
  fixedError(() => api().captureFleetSnapshot(f.path, { ...f.options, cohortAuthority: { ...f.options.cohortAuthority, expectedCount: 37 } }), "FLEET_COHORT_INVALID");
  const authority = { kind: "original-cohort-digest", approvalSha256: "d".repeat(64), expectedCount: 38, cohortSha256: createHash("sha256").update(JSON.stringify(f.state.fleet.map((n) => n.id).sort())).digest("hex") };
  assert.equal(api().fleetSnapshotSummary(api().captureFleetSnapshot(f.path, { ...f.options, cohortAuthority: authority })).cohortAuthorityVerified, true);
  fixedError(() => api().captureFleetSnapshot(f.path, { ...f.options, cohortAuthority: { ...authority, cohortSha256: "0".repeat(64) } }), "FLEET_COHORT_INVALID");
});

test("bound context changes, forged handles and symlink database paths fail closed", (t) => {
  const f = fixture(t);
  const before = capture(f);
  const after = api().captureFleetSnapshot(f.path, { ...f.options, databaseBinding: { ...f.options.databaseBinding, configSha256: "e".repeat(64) } });
  assert.equal(api().compareFleetSnapshots(before, after).databaseBindingMatched, false);
  assert.equal(api().compareFleetSnapshots(before, after).status, "FAIL");
  fixedError(() => api().fleetSnapshotSummary({}), "FLEET_HANDLE_INVALID");
  fixedError(() => api().compareFleetSnapshots(before, {}), "FLEET_HANDLE_INVALID");
  const alias = join(f.root, "alias.db");
  symlinkSync(f.path, alias);
  fixedError(() => api().captureFleetSnapshot(alias, { ...f.options, databaseBinding: { ...f.options.databaseBinding, path: alias } }), "FLEET_DATABASE_UNAVAILABLE");
  fixedError(() => api().captureFleetSnapshot(join(f.root, "missing.db"), { ...f.options, databaseBinding: { ...f.options.databaseBinding, path: join(f.root, "missing.db") } }), "FLEET_DATABASE_UNAVAILABLE");
});
