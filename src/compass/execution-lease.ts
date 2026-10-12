import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Single-SQLite-database execution authority. This is NOT a distributed
 * consensus service: all workers must transact against the same authoritative
 * database through a supported coordinator. Do not share SQLite via network FS.
 */
export class CompassExecutionLease {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS compass_execution_lease (
      task_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK(epoch > 0),
      token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
  }

  claim(taskId: string, owner: string, ttlMs: number, now = Date.now()) {
    if (!taskId.trim() || !owner.trim() || !Number.isSafeInteger(ttlMs) || ttlMs <= 0)
      throw new Error("COMPASS_LEASE_INVALID_INPUT");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.db.prepare("SELECT * FROM compass_execution_lease WHERE task_id = ?")
        .get(taskId) as { owner: string; epoch: number; expires_at: number } | undefined;
      if (previous && previous.expires_at > now) throw new Error("COMPASS_LEASE_ALREADY_HELD");
      const epoch = (previous?.epoch ?? 0) + 1;
      const token = randomUUID();
      const expiresAt = now + ttlMs;
      this.db.prepare(`INSERT INTO compass_execution_lease(task_id, owner, epoch, token, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET owner=excluded.owner, epoch=excluded.epoch,
          token=excluded.token, expires_at=excluded.expires_at`)
        .run(taskId, owner, epoch, token, expiresAt);
      this.db.exec("COMMIT");
      return { taskId, owner, epoch, token, expiresAt };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Extend only the current owner's lease; never revive an expired claim. */
  renew(
    claim: { taskId: string; owner: string; epoch: number; token: string },
    ttlMs: number,
    now = Date.now(),
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(now) ||
        !Number.isSafeInteger(now + ttlMs)) throw new Error("COMPASS_LEASE_INVALID_INPUT");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertCurrent(claim, now);
      const expiresAt = now + ttlMs;
      this.db.prepare(`UPDATE compass_execution_lease SET expires_at = ?
        WHERE task_id = ? AND owner = ? AND epoch = ? AND token = ?`)
        .run(expiresAt, claim.taskId, claim.owner, claim.epoch, claim.token);
      this.db.exec("COMMIT");
      return { ...claim, expiresAt };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Release only a still-current lease, without resetting its fencing epoch. */
  release(claim: { taskId: string; owner: string; epoch: number; token: string }, now = Date.now()): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertCurrent(claim, now);
      this.db.prepare(`UPDATE compass_execution_lease SET expires_at = ?
        WHERE task_id = ? AND owner = ? AND epoch = ? AND token = ?`)
        .run(now, claim.taskId, claim.owner, claim.epoch, claim.token);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Called only inside an existing BEGIN IMMEDIATE transaction. */
  assertCurrent(claim: { taskId: string; owner: string; epoch: number; token: string }, now = Date.now()): void {
    const current = this.db.prepare("SELECT * FROM compass_execution_lease WHERE task_id = ?")
      .get(claim.taskId) as { owner: string; epoch: number; token: string; expires_at: number } | undefined;
    if (!current || current.owner !== claim.owner || current.epoch !== claim.epoch ||
        current.token !== claim.token || current.expires_at <= now)
      throw new Error("COMPASS_LEASE_STALE_CLAIM");
  }

  /** Reserve a single external action intent under the current fenced epoch.
   * A pending intent is never permission to repeat an unknown external effect.
   */
  reserveEffect(claim: { taskId: string; owner: string; epoch: number; token: string }, actionId: string, now = Date.now()): void {
    if (!actionId.trim()) throw new Error("COMPASS_EFFECT_INVALID_INPUT");
    this.commit(claim, () => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS compass_execution_effect (
        task_id TEXT NOT NULL, action_id TEXT NOT NULL, epoch INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('PENDING', 'CONFIRMED')),
        PRIMARY KEY(task_id, action_id)
      )`);
      const result = this.db.prepare(`INSERT OR IGNORE INTO compass_execution_effect(task_id, action_id, epoch, state)
        VALUES (?, ?, ?, 'PENDING')`).run(claim.taskId, actionId, claim.epoch);
      if (result.changes !== 1) throw new Error("COMPASS_EFFECT_ALREADY_RESERVED_RECONCILIATION_REQUIRED");
    }, now);
  }

  /** Record confirmed outcome only for the owner of the reserved effect.
   * Unknown outcomes remain PENDING and require reconciliation.
   */
  confirmEffect(claim: { taskId: string; owner: string; epoch: number; token: string }, actionId: string, now = Date.now()): void {
    if (!actionId.trim()) throw new Error("COMPASS_EFFECT_INVALID_INPUT");
    this.commit(claim, () => {
      const result = this.db.prepare(`UPDATE compass_execution_effect SET state = 'CONFIRMED'
        WHERE task_id = ? AND action_id = ? AND epoch = ? AND state = 'PENDING'`)
        .run(claim.taskId, actionId, claim.epoch);
      if (result.changes !== 1) throw new Error("COMPASS_EFFECT_CONFIRMATION_RECONCILIATION_REQUIRED");
    }, now);
  }

  /** Read the persisted effect status; a missing or pending result is not a retry permit. */
  effectStatus(taskId: string, actionId: string): "UNRECORDED" | "PENDING" | "CONFIRMED" {
    if (!taskId.trim() || !actionId.trim()) throw new Error("COMPASS_EFFECT_INVALID_INPUT");
    const table = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'compass_execution_effect'").get();
    if (!table) return "UNRECORDED";
    const row = this.db.prepare("SELECT state FROM compass_execution_effect WHERE task_id = ? AND action_id = ?")
      .get(taskId, actionId) as { state: "PENDING" | "CONFIRMED" } | undefined;
    return row?.state ?? "UNRECORDED";
  }

  /** Run only synchronous Compass database mutations in this transaction. */
  commit<T>(
    claim: { taskId: string; owner: string; epoch: number; token: string },
    mutation: () => T,
    now = Date.now(),
  ): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertCurrent(claim, now);
      const result = mutation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
