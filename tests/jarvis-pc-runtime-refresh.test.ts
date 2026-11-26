import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import { CompassStore } from "../src/compass/store.ts";
import { inspectPcRuntimeState, preparePcRuntimeConfiguration, validatePcRuntimeRefreshApproval } from "../src/jarvis/pc-runtime-refresh.ts";
const now = new Date("2026-10-01T12:00:00Z");
test("Windows read-only diagnostics accept only known read rights while apply rejects unidentified readers", { skip: process.platform !== "win32" }, () => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", join(process.cwd(), "tests/jarvis-pc-runtime-acl.test.ps1")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ACL predicate fixtures PASS: 14/);
});
const approval = { version: 1 as const, issue: 1662, goalIssue: 1219, operation: "zbook-runtime-refresh" as const, approvedAt: "2026-10-01T11:18:17Z", expiresAt: "2026-10-02T11:18:17Z",
  targets: [{ nodeId: "zbook" as const, platform: "windows" as const }],  };
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
    writeFileSync(brokerPath + ".pc-tasks.json", JSON.stringify({ version: 1, tasks: [{ id: "pc-active", status: "running" }] }));
    assert.throws(() => inspectPcRuntimeState({ brokerPath, compassPath, expectedAndroidCount: 0 }), /QUIESCENCE/);
    writeFileSync(brokerPath + ".pc-tasks.json", JSON.stringify({ version: 1, tasks: [{ id: "pc-done", status: "completed" }] }));
    assert.equal(inspectPcRuntimeState({ brokerPath, compassPath, expectedAndroidCount: 0 }).metadata.quiescent, true);
    const reopened = new JarvisSqliteStateStore(brokerPath); assert.deepEqual(reopened.load(), snapshot);
    const running = structuredClone(snapshot); Object.assign(running, { tasks: [{ id: "active", status: "running" }] }); reopened.save(running); reopened.close();
    assert.throws(() => inspectPcRuntimeState({ brokerPath, compassPath, expectedAndroidCount: 0 }), /QUIESCENCE/);
    const queued = new JarvisSqliteStateStore(brokerPath);
    Object.assign(running, { tasks: [{ id: "pending", status: "queued" }] }); queued.save(running); queued.close();
    assert.throws(() => inspectPcRuntimeState({ brokerPath, compassPath, expectedAndroidCount: 0 }), /QUIESCENCE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runtime approval rejects enrollment authority, another host and expired or oversized scopes", () => {
  assert.deepEqual(validatePcRuntimeRefreshApproval(approval, now), approval);
  for (const invalid of [
    { ...approval, operation: "pc-enrollment" },
    { ...approval, roles: ["Executor"] },
    { ...approval, targets: [{ nodeId: "macbook", platform: "macos" }] },
    { ...approval, targets: [...approval.targets, ...approval.targets] },
    { ...approval, expiresAt: "2026-10-04T11:18:17Z" },
    { ...approval, approvedAt: "2026-10-01T13:00:00Z" },
  ]) assert.throws(() => validatePcRuntimeRefreshApproval(invalid, now), /PC_RUNTIME_APPROVAL_REQUIRED/);
  assert.throws(() => validatePcRuntimeRefreshApproval(approval, new Date(approval.expiresAt)), /PC_RUNTIME_APPROVAL_REQUIRED/);
});

test("runtime approval honors only the exact renewed ZBook window beyond 24 hours", () => {
  const renewed = {
    ...approval,
    approvedAt: "2026-11-23T12:15:59.000Z",
    expiresAt: "2026-11-26T12:15:00.000Z",
  };
  const secondDay = new Date("2026-11-25T00:00:00Z");
  for (const allowedAt of [renewed.approvedAt, secondDay, "2026-11-26T12:14:59.999Z"]) {
    assert.deepEqual(validatePcRuntimeRefreshApproval(renewed, new Date(allowedAt)), renewed);
  }
  for (const refusedAt of ["2026-11-23T12:15:58.999Z", renewed.expiresAt, "2026-11-26T12:15:00.001Z"]) {
    assert.throws(() => validatePcRuntimeRefreshApproval(renewed, new Date(refusedAt)), /PC_RUNTIME_APPROVAL_REQUIRED/);
  }
  for (const invalid of [
    { ...renewed, approvedAt: "2026-11-23T12:15:58.999Z" },
    { ...renewed, expiresAt: "2026-11-26T12:15:00.001Z" },
    { ...renewed, expiresAt: "2026-11-26T12:15:00.0001Z" },
    { ...renewed, operation: "pc-enrollment" },
    { ...renewed, issue: 1787 },
    { ...renewed, goalIssue: 1662 },
    { ...renewed, targets: [{ nodeId: "zbook", platform: "macos" }] },
    { ...renewed, targets: [...renewed.targets, ...renewed.targets] },
    { ...renewed, roles: ["Executor"] },
  ]) assert.throws(() => validatePcRuntimeRefreshApproval(invalid, secondDay), /PC_RUNTIME_APPROVAL_REQUIRED/);
  assert.deepEqual(JSON.parse(readFileSync(new URL("../docs/authorizations/1662-zbook-runtime-refresh.json", import.meta.url), "utf8")), renewed);
});

test("PowerShell enforces the exact approval window and protects ADB during runtime stop", t => {
  const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const fixture = join(import.meta.dirname, "goriq-pc-runtime-approval.test.ps1");
  const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-File", fixture], { encoding: "utf8", timeout: 10_000 });
  const error = result.error as NodeJS.ErrnoException | undefined;
  if (process.platform !== "win32" && error?.code === "ENOENT") {
    t.skip("PowerShell is unavailable");
    return;
  }
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Runtime approval fixtures PASS/);
});
