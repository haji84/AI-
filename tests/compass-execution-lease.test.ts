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

test("renewal extends the current lease but cannot revive stale ownership", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const leases = new CompassExecutionLease(db);
    const mac = leases.claim("goal", "mac", 100, 1000);
    const renewed = leases.renew(mac, 100, 1050);
    assert.equal(renewed.expiresAt, 1150);
    assert.equal(renewed.epoch, mac.epoch);
    assert.throws(() => leases.claim("goal", "zbook", 100, 1149), /ALREADY_HELD/);
    const zbook = leases.claim("goal", "zbook", 100, 1150);
    assert.equal(zbook.epoch, mac.epoch + 1);
    assert.throws(() => leases.renew(mac, 100, 1151), /STALE_CLAIM/);
    assert.throws(() => leases.renew(zbook, 100, 1250), /STALE_CLAIM/);
  } finally { db.close(); }
});

test("lease renewal rejects invalid TTL without extending authority", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const leases = new CompassExecutionLease(db);
    const mac = leases.claim("goal", "mac", 100, 1000);
    for (const ttl of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => leases.renew(mac, ttl, 1050), /INVALID_INPUT/);
    }
    const zbook = leases.claim("goal", "zbook", 100, 1100);
    assert.equal(zbook.epoch, mac.epoch + 1);
  } finally { db.close(); }
});

test("only the current owner can release and successor keeps fencing epoch", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const leases = new CompassExecutionLease(db);
    const mac = leases.claim("goal", "mac", 100, 1000);
    leases.release(mac, 1050);
    const zbook = leases.claim("goal", "zbook", 100, 1050);
    assert.equal(zbook.epoch, mac.epoch + 1);
    assert.throws(() => leases.release(mac, 1051), /STALE_CLAIM/);
    assert.throws(() => leases.claim("goal", "other", 100, 1051), /ALREADY_HELD/);
  } finally { db.close(); }
});

test("a second process connection reclaims an expired lease and fences the old owner", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "goriq-lease-recovery-"));
  const path = join(dir, "compass.db");
  const macDb = new DatabaseSync(path);
  const zbookDb = new DatabaseSync(path);
  try {
    macDb.exec("CREATE TABLE progress (value TEXT)");
    const macLease = new CompassExecutionLease(macDb);
    const zbookLease = new CompassExecutionLease(zbookDb);
    const old = macLease.claim("goal", "mac", 100, 1000);
    assert.throws(() => zbookLease.claim("goal", "zbook", 100, 1099), /ALREADY_HELD/);
    const current = zbookLease.claim("goal", "zbook", 100, 1100);
    assert.equal(current.epoch, old.epoch + 1);
    assert.throws(() => macLease.commit(old, () => macDb.exec("INSERT INTO progress VALUES ('old')"), 1101), /STALE_CLAIM/);
    zbookLease.commit(current, () => zbookDb.exec("INSERT INTO progress VALUES ('new')"), 1101);
    assert.deepEqual(macDb.prepare("SELECT value FROM progress").all().map(row => ({ value: row.value })), [{ value: "new" }]);
  } finally {
    zbookDb.close();
    macDb.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("released claim is fenced even if the old process remains alive", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE progress (value TEXT)");
    const leases = new CompassExecutionLease(db);
    const mac = leases.claim("goal", "mac", 1000, 1000);
    leases.release(mac, 1050);
    assert.throws(() => leases.commit(mac, () => db.exec("INSERT INTO progress VALUES ('stale')"), 1050), /STALE_CLAIM/);
    assert.throws(() => leases.renew(mac, 100, 1050), /STALE_CLAIM/);
    const zbook = leases.claim("goal", "zbook", 1000, 1050);
    leases.commit(zbook, () => db.exec("INSERT INTO progress VALUES ('valid')"), 1051);
    assert.deepEqual(db.prepare("SELECT value FROM progress").all().map(row => ({ value: row.value })), [{ value: "valid" }]);
  } finally { db.close(); }
});

test("external effect intent persists and blocks replay after lease takeover", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const leases = new CompassExecutionLease(db);
    const mac = leases.claim("goal", "mac", 100, 1000);
    leases.reserveEffect(mac, "external-action-1", 1001);
    assert.throws(() => leases.reserveEffect(mac, "external-action-1", 1002), /RECONCILIATION_REQUIRED/);
    const zbook = leases.claim("goal", "zbook", 100, 1100);
    assert.throws(() => leases.reserveEffect(zbook, "external-action-1", 1101), /RECONCILIATION_REQUIRED/);
    assert.throws(() => leases.reserveEffect(mac, "external-action-2", 1101), /STALE_CLAIM/);
    leases.reserveEffect(zbook, "external-action-2", 1101);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM compass_execution_effect").get()?.count, 2);
  } finally { db.close(); }
});

test("only the reserving owner can confirm an external effect", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const leases = new CompassExecutionLease(db);
    const mac = leases.claim("goal", "mac", 100, 1000);
    leases.reserveEffect(mac, "action-1", 1001);
    leases.confirmEffect(mac, "action-1", 1002);
    assert.equal(db.prepare("SELECT state FROM compass_execution_effect WHERE action_id = ?").get("action-1")?.state, "CONFIRMED");
    assert.throws(() => leases.confirmEffect(mac, "action-1", 1003), /RECONCILIATION_REQUIRED/);
    const zbook = leases.claim("goal", "zbook", 100, 1100);
    assert.throws(() => leases.confirmEffect(zbook, "action-1", 1101), /RECONCILIATION_REQUIRED/);
    assert.throws(() => leases.confirmEffect(mac, "action-1", 1101), /STALE_CLAIM/);
  } finally { db.close(); }
});
