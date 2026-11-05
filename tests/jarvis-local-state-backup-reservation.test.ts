import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { JarvisControlPlane, JarvisSqliteStateStore } from "../src/jarvis/index.ts";
import { LocalStateBackups } from "../src/jarvis/local-state-backups.ts";

// A contender can briefly inspect this empty coordinator before reserving its
// writer slot. That read must not make both managed writers lose an upgrade.
test("managed backup reserves one native writer alongside a read-only coordinator inspection", { skip: process.platform === "win32", timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "backup-reservation-public-"));
  const paths = { brokerPath: join(directory, "broker.sqlite"), compassPath: join(directory, "compass.sqlite") };
  let inspection: DatabaseSync | undefined;
  let reserved: DatabaseSync | undefined;
  try {
    const broker = new JarvisSqliteStateStore(paths.brokerPath);
    try { broker.save(new JarvisControlPlane().snapshot()); } finally { broker.close(); }
    const compass = new CompassStore(paths.compassPath);
    try { compass.setGoal({ title: "Public reservation fixture", successCriteria: ["preserve the configured stores"] }); } finally { compass.close(); }
    const sourceBytes = await Promise.all([readFile(paths.brokerPath), readFile(paths.compassPath)]);
    await new LocalStateBackups(paths).create();
    const root = paths.brokerPath + ".state-backups", control = join(root, ".operation.sqlite"), before = await lstat(control);
    inspection = new DatabaseSync(control, { readOnly: true });
    inspection.exec("BEGIN; SELECT name FROM sqlite_schema");
    assert.deepEqual(inspection.prepare("SELECT name FROM sqlite_schema").all(), [], "coordination inspection sees no application schema");

    await assert.doesNotReject(new LocalStateBackups(paths).create(), "a read-only coordination inspection must not strand the managed writer");
    reserved = new DatabaseSync(control);
    reserved.exec("PRAGMA busy_timeout=0; PRAGMA journal_mode=MEMORY; BEGIN IMMEDIATE");
    await assert.rejects(new LocalStateBackups(paths).create(), { code: "operation_busy" }, "a second native writer remains excluded");
    reserved.close(); reserved = undefined;
    assert.equal((await new LocalStateBackups(paths).create()).status, "ready", "closing the writer reservation releases admission while inspection remains open");

    const after = await lstat(control);
    assert.equal(after.ino, before.ino); assert.equal(after.size, 0); assert.equal(after.mode & 0o777, 0o600);
    assert.equal(after.nlink, 1); assert.equal(after.uid, before.uid);
    const names = await readdir(root);
    assert.equal(names.length, 4, "three generations and the original coordination inode only");
    assert.ok(names.every(name => name === ".operation.sqlite" || /^[a-f0-9-]{36}$/.test(name)), "no journal or other coordination sidecar is created");
    assert.deepEqual(await Promise.all([readFile(paths.brokerPath), readFile(paths.compassPath)]), sourceBytes);
  } finally {
    reserved?.close(); inspection?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
