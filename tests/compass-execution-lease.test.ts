import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CompassExecutionLease } from "../src/compass/execution-lease.ts";

test("expired owner cannot commit after new owner claims the task", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE progress (value TEXT)");
    const leases = new CompassExecutionLease(db);
    const first = leases.claim("goal", "mac", 100, 1000);
    assert.throws(() => leases.claim("goal", "zbook", 100, 1050), /ALREADY_HELD/);
    const second = leases.claim("goal", "zbook", 100, 1100);
    assert.equal(second.epoch, first.epoch + 1);
    assert.throws(() => leases.commit(first, () => db.exec("INSERT INTO progress VALUES ('stale')"), 1101), /STALE_CLAIM/);
    leases.commit(second, () => db.exec("INSERT INTO progress VALUES ('valid')"), 1101);
    assert.deepEqual(db.prepare("SELECT value FROM progress").all().map(row => ({ value: row.value })), [{ value: "valid" }]);
  } finally { db.close(); }
});

test("failed mutation rolls back without publishing progress", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE progress (value TEXT)");
    const leases = new CompassExecutionLease(db);
    const claim = leases.claim("goal", "worker", 100, 1000);
    assert.throws(() => leases.commit(claim, () => {
      db.exec("INSERT INTO progress VALUES ('partial')");
      throw new Error("failed");
    }, 1001), /failed/);
    assert.deepEqual(db.prepare("SELECT value FROM progress").all(), []);
  } finally { db.close(); }
});

test("simultaneous workers cannot both acquire the same live lease", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const leases = new CompassExecutionLease(db);
    const mac = leases.claim("goal", "mac", 1000, 1000);
    assert.throws(() => leases.claim("goal", "zbook", 1000, 1000), /ALREADY_HELD/);
    assert.throws(() => leases.claim("goal", "zbook", 1000, 1999), /ALREADY_HELD/);
    const zbook = leases.claim("goal", "zbook", 1000, 2000);
    assert.equal(zbook.epoch, mac.epoch + 1);
    assert.notEqual(zbook.token, mac.token);
    assert.throws(() => leases.commit(mac, () => db.exec("CREATE TABLE stale (id INTEGER)"), 2001), /STALE_CLAIM/);
  } finally { db.close(); }
});

test("expired lease cannot publish a result without a successor", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE progress (value TEXT)");
    const leases = new CompassExecutionLease(db);
    const claim = leases.claim("goal", "mac", 100, 1000);
    assert.throws(() => leases.commit(claim, () => db.exec("INSERT INTO progress VALUES ('expired')"), 1100), /STALE_CLAIM/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM progress").get()?.count, 0);
  } finally { db.close(); }
});
