import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Single-SQLite-database execution authority. This is NOT a distributed
 * consensus service: all workers must transact against the same authoritative
 * database through a supported coordinator. Do not share SQLite via network FS.
 */
export class CompassExecutionLease {
  constructor(private readonly db: DatabaseSync) {
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

  /** Called only inside an existing BEGIN IMMEDIATE transaction. */
  assertCurrent(claim: { taskId: string; owner: string; epoch: number; token: string }, now = Date.now()): void {
    const current = this.db.prepare("SELECT * FROM compass_execution_lease WHERE task_id = ?")
      .get(claim.taskId) as { owner: string; epoch: number; token: string; expires_at: number } | undefined;
    if (!current || current.owner !== claim.owner || current.epoch !== claim.epoch ||
        current.token !== claim.token || current.expires_at <= now)
      throw new Error("COMPASS_LEASE_STALE_CLAIM");
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
